"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useRouter, useParams } from "next/navigation";
import {
  ArrowLeft,
  Trash2,
  Download,
  Loader2,
  AlertTriangle,
  Square,
  Circle,
  Pause,
  Play,
  Mic,
  RefreshCw,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { TranscriptLayout, TranscriptLayoutHandle } from "@/components/transcript-layout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useAudioStreaming } from "@/hooks/use-audio-streaming";
import { useSession } from "@/lib/auth-client";
import type { DeepgramSegment } from "@/lib/transcription/browser-deepgram";

interface TranscriptSegment {
  id: string;
  speakerLabel: string;
  originalText: string;
  translatedText: string | null;
  startTime: number;
  endTime: number;
  isFinal: boolean;
  createdAt: string;
}

interface TranscriptionSession {
  id: string;
  title: string;
  status: string;
  sourceLanguage: string;
  targetLanguage: string;
  durationSeconds: number;
  speakerCount: number;
  createdAt: string;
  segments: TranscriptSegment[];
}

interface DeepgramError {
  title: string;
  message: string;
  canRetry: boolean;
}

function formatTimer(totalSeconds: number): string {
  const hours = Math.floor(totalSeconds / 3600);
  const mins = Math.floor((totalSeconds % 3600) / 60);
  const secs = totalSeconds % 60;
  if (hours > 0) {
    return `${hours}:${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
  }
  return `${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
}

/**
 * Merge database segments with live (real-time) segments.
 * Live segments replace database segments when they overlap.
 */
function mergeSegments(
  dbSegments: TranscriptSegment[],
  liveSegments: TranscriptSegment[]
): TranscriptSegment[] {
  if (liveSegments.length === 0) return dbSegments;
  if (dbSegments.length === 0) return liveSegments;

  const merged = dbSegments.filter((db) => {
    return !liveSegments.some(
      (live) =>
        live.isFinal &&
        live.speakerLabel === db.speakerLabel &&
        Math.abs(live.startTime - db.startTime) < 2
    );
  });

  for (const live of liveSegments) {
    if (!merged.some((m) => m.id === live.id)) merged.push(live);
  }

  merged.sort((a, b) => {
    if (a.startTime !== b.startTime) return a.startTime - b.startTime;
    return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
  });

  return merged;
}

function friendlyDeepgramError(message: string): DeepgramError {
  const lower = message.toLowerCase();
  if (lower.includes("401") || lower.includes("unauthorized") || lower.includes("invalid api key")) {
    return {
      title: "Authentication Error",
      message: "The transcription service rejected the temporary key. Please try again.",
      canRetry: true,
    };
  }
  if (lower.includes("429") || lower.includes("rate limit")) {
    return {
      title: "Rate Limited",
      message: "Too many requests to the transcription service. Please wait a moment and retry.",
      canRetry: true,
    };
  }
  if (lower.includes("payment") || lower.includes("quota") || lower.includes("insufficient")) {
    return {
      title: "Service Quota Exceeded",
      message: "The transcription service quota has been exceeded.",
      canRetry: false,
    };
  }
  if (lower.includes("not configured") || lower.includes("provision")) {
    return {
      title: "Not Configured",
      message: "Transcription is not configured on the server.",
      canRetry: false,
    };
  }
  if (lower.includes("network") || lower.includes("websocket") || lower.includes("closed")) {
    return {
      title: "Connection Lost",
      message: "Lost connection to the transcription service. Click Retry to reconnect.",
      canRetry: true,
    };
  }
  return {
    title: "Transcription Error",
    message: "An unexpected error occurred with the transcription service. Existing transcript data is preserved.",
    canRetry: true,
  };
}

/** Fire-and-forget POST to persist a finalized segment. */
async function persistSegment(sessionId: string, seg: DeepgramSegment): Promise<void> {
  try {
    await fetch(`/api/sessions/${sessionId}/segments`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: seg.id,
        speakerLabel: seg.speakerLabel,
        originalText: seg.originalText,
        startTime: seg.startTime,
        endTime: seg.endTime,
        isFinal: true,
      }),
    });
  } catch (err) {
    console.error("[Session] Failed to persist segment:", err);
  }
}

/**
 * Stream a translation for a finalized segment via /api/translate.
 * Calls onChunk with cumulative text as tokens arrive.
 */
async function streamTranslation(params: {
  sessionId: string;
  segmentId: string;
  originalText: string;
  targetLanguage: string;
  onChunk: (cumulative: string) => void;
}): Promise<{ ok: true; full: string } | { ok: false; error: string }> {
  try {
    const res = await fetch("/api/translate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sessionId: params.sessionId,
        segmentId: params.segmentId,
        originalText: params.originalText,
        targetLanguage: params.targetLanguage,
      }),
    });

    if (!res.ok || !res.body) {
      const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
      return { ok: false, error: err.error || `HTTP ${res.status}` };
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let full = "";
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      const chunk = decoder.decode(value, { stream: true });
      full += chunk;
      params.onChunk(full);
    }
    return { ok: true, full };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

export default function SessionDetailPage() {
  const { data: session, isPending } = useSession();
  const router = useRouter();
  const params = useParams();
  const sessionId = params.id as string;

  const [sessionData, setSessionData] = useState<TranscriptionSession | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [showStopDialog, setShowStopDialog] = useState(false);
  const [isStopping, setIsStopping] = useState(false);

  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  const [isExporting, setIsExporting] = useState(false);

  const [liveSegments, setLiveSegments] = useState<TranscriptSegment[]>([]);

  const [deepgramError, setDeepgramError] = useState<DeepgramError | null>(null);
  const [translationErrors, setTranslationErrors] = useState<Map<string, string>>(new Map());

  const transcriptRef = useRef<TranscriptLayoutHandle>(null);

  // Track segments we've already persisted/translated so we don't double up.
  const persistedRef = useRef<Set<string>>(new Set());
  const translatedRef = useRef<Set<string>>(new Set());

  const targetLanguage = sessionData?.targetLanguage || "en";

  // Trigger translation for a finalized segment (and persist it server-side first).
  const handleFinalSegment = useCallback(
    async (seg: DeepgramSegment) => {
      if (persistedRef.current.has(seg.id)) return;
      persistedRef.current.add(seg.id);

      await persistSegment(sessionId, seg);

      if (translatedRef.current.has(seg.id)) return;
      translatedRef.current.add(seg.id);

      const result = await streamTranslation({
        sessionId,
        segmentId: seg.id,
        originalText: seg.originalText,
        targetLanguage,
        onChunk: (cumulative) => {
          setLiveSegments((prev) =>
            prev.map((s) =>
              s.id === seg.id ? { ...s, translatedText: cumulative } : s
            )
          );
        },
      });

      if (!result.ok) {
        setTranslationErrors((prev) => {
          const next = new Map(prev);
          next.set(seg.id, result.error || "Translation failed");
          return next;
        });
      } else {
        setTranslationErrors((prev) => {
          const next = new Map(prev);
          next.delete(seg.id);
          return next;
        });
        setSessionData((prev) =>
          prev
            ? {
                ...prev,
                segments: prev.segments.map((s) =>
                  s.id === seg.id ? { ...s, translatedText: result.full } : s
                ),
              }
            : prev
        );
      }
    },
    [sessionId, targetLanguage]
  );

  const onSegment = useCallback(
    (seg: DeepgramSegment) => {
      const nowIso = new Date().toISOString();
      setLiveSegments((prev) => {
        // For final segments: replace any matching interim entry.
        if (seg.isFinal) {
          const filtered = prev.filter(
            (s) =>
              !(
                s.speakerLabel === seg.speakerLabel &&
                !s.isFinal &&
                Math.abs(s.startTime - seg.startTime) < 2
              )
          );
          return [
            ...filtered,
            {
              id: seg.id,
              speakerLabel: seg.speakerLabel,
              originalText: seg.originalText,
              translatedText: null,
              startTime: seg.startTime,
              endTime: seg.endTime,
              isFinal: true,
              createdAt: nowIso,
            },
          ];
        }

        // Interim: replace existing interim for same speaker/time range.
        const filtered = prev.filter(
          (s) =>
            !(
              s.speakerLabel === seg.speakerLabel &&
              !s.isFinal &&
              Math.abs(s.startTime - seg.startTime) < 2
            )
        );
        return [
          ...filtered,
          {
            id: seg.id,
            speakerLabel: seg.speakerLabel,
            originalText: seg.originalText,
            translatedText: null,
            startTime: seg.startTime,
            endTime: seg.endTime,
            isFinal: false,
            createdAt: nowIso,
          },
        ];
      });

      if (seg.isFinal) {
        handleFinalSegment(seg);
      }
    },
    [handleFinalSegment]
  );

  const onDeepgramClose = useCallback((code: number, reason: string) => {
    if (code === 1000) return;
    const err = friendlyDeepgramError(`closed ${code} ${reason}`);
    setDeepgramError(err);
  }, []);

  const onAudioError = useCallback((err: Error) => {
    console.error("[Session] Recording error:", err.message);
    const friendly = friendlyDeepgramError(err.message);
    setDeepgramError(friendly);
    toast.error(friendly.message);
  }, []);

  const {
    recordingState,
    chunksSent,
    duration: streamingDuration,
    audioLevel,
    isSupported: isMediaRecorderSupported,
    deepgramState,
    speakerCount,
    startRecording,
    pauseRecording,
    resumeRecording,
    stopRecording,
  } = useAudioStreaming({
    sessionId,
    targetLanguage,
    onSegment,
    onDeepgramClose,
    onError: onAudioError,
  });

  useEffect(() => {
    if (!isPending && !session) router.push("/");
  }, [isPending, session, router]);

  useEffect(() => {
    if (session?.user?.id && sessionId) {
      fetch(`/api/sessions/${sessionId}`)
        .then((res) => {
          if (!res.ok) throw new Error("Session not found");
          return res.json();
        })
        .then((data) => {
          setSessionData(data);
          setLoading(false);
        })
        .catch((err) => {
          setError(err.message);
          setLoading(false);
        });
    }
  }, [session?.user?.id, sessionId]);

  const handleStartRecording = useCallback(async () => {
    if (recordingState === "recording" || recordingState === "paused") {
      toast.info("Recording is already in progress");
      return;
    }

    try {
      const res = await fetch(`/api/sessions/${sessionId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "recording" }),
      });
      if (!res.ok) {
        const err = await res.json();
        toast.error(err.error || "Failed to start recording");
        return;
      }
      const updated = await res.json();
      setSessionData((prev) => (prev ? { ...prev, ...updated } : prev));
      setDeepgramError(null);
      await startRecording();
      toast.success("Recording started");
    } catch {
      toast.error("Failed to start recording");
    }
  }, [sessionId, startRecording, recordingState]);

  const handlePauseRecording = useCallback(async () => {
    pauseRecording();
    try {
      const res = await fetch(`/api/sessions/${sessionId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "paused" }),
      });
      if (res.ok) {
        const updated = await res.json();
        setSessionData((prev) => (prev ? { ...prev, ...updated } : prev));
      }
    } catch {
      console.error("[Session] Failed to update pause status in database");
    }
    toast.info("Recording paused");
  }, [pauseRecording, sessionId]);

  const handleResumeRecording = useCallback(async () => {
    resumeRecording();
    try {
      const res = await fetch(`/api/sessions/${sessionId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "recording" }),
      });
      if (res.ok) {
        const updated = await res.json();
        setSessionData((prev) => (prev ? { ...prev, ...updated } : prev));
      }
    } catch {
      console.error("[Session] Failed to update resume status in database");
    }
    toast.info("Recording resumed");
  }, [resumeRecording, sessionId]);

  const handleDismissDeepgramError = useCallback(() => {
    setDeepgramError(null);
  }, []);

  const handleRetryTranslation = useCallback(
    async (segmentId: string) => {
      const mergedSegs = mergeSegments(sessionData?.segments || [], liveSegments);
      const segment = mergedSegs.find((s) => s.id === segmentId);
      if (!segment) return;

      setTranslationErrors((prev) => {
        const next = new Map(prev);
        next.delete(segmentId);
        return next;
      });

      const result = await streamTranslation({
        sessionId,
        segmentId,
        originalText: segment.originalText,
        targetLanguage,
        onChunk: (cumulative) => {
          setLiveSegments((prev) =>
            prev.map((s) =>
              s.id === segmentId ? { ...s, translatedText: cumulative } : s
            )
          );
        },
      });

      if (!result.ok) {
        setTranslationErrors((prev) => {
          const next = new Map(prev);
          next.set(segmentId, result.error || "Translation failed");
          return next;
        });
      } else {
        setSessionData((prev) =>
          prev
            ? {
                ...prev,
                segments: prev.segments.map((s) =>
                  s.id === segmentId ? { ...s, translatedText: result.full } : s
                ),
              }
            : prev
        );
      }
    },
    [sessionId, sessionData, liveSegments, targetLanguage]
  );

  const handleStopRecording = useCallback(async () => {
    setIsStopping(true);
    try {
      await stopRecording();

      const currentDuration = streamingDuration;
      const totalDuration = (sessionData?.durationSeconds ?? 0) + currentDuration;
      const res = await fetch(`/api/sessions/${sessionId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          status: "completed",
          durationSeconds: totalDuration,
          speakerCount,
        }),
      });

      if (res.ok) {
        const updated = await res.json();
        setSessionData((prev) => (prev ? { ...prev, ...updated } : prev));
        toast.success(`Recording stopped (${chunksSent} audio chunks sent)`);
        setShowStopDialog(false);

        // Refresh segments from DB so persisted final ones replace live state.
        try {
          const fresh = await fetch(`/api/sessions/${sessionId}`).then((r) => r.json());
          setSessionData(fresh);
          setLiveSegments([]);
          persistedRef.current.clear();
          translatedRef.current.clear();
        } catch {
          /* ignore — in-memory state still shows the transcript */
        }
      } else {
        const err = await res.json();
        toast.error(err.error || "Failed to stop recording");
      }
    } catch {
      toast.error("Failed to stop recording");
    } finally {
      setIsStopping(false);
    }
  }, [sessionId, streamingDuration, stopRecording, chunksSent, sessionData, speakerCount]);

  if (isPending || !session) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div>Loading...</div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div>Loading session...</div>
      </div>
    );
  }

  if (error || !sessionData) {
    return (
      <div className="container max-w-4xl mx-auto py-4 sm:py-8 px-4">
        <div className="flex items-center gap-4 mb-6 sm:mb-8">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => router.push("/dashboard")}
            className="flex items-center gap-2 min-h-[44px]"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to Dashboard
          </Button>
        </div>
        <Card>
          <CardContent className="py-12 text-center">
            <p className="text-muted-foreground">{error || "Session not found"}</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const handleExport = async () => {
    setIsExporting(true);
    try {
      const res = await fetch(`/api/sessions/${sessionId}/export`);
      if (!res.ok) {
        toast.error("Failed to export transcript");
        return;
      }
      const blob = await res.blob();
      const contentDisposition = res.headers.get("Content-Disposition");
      let filename = `${sessionData.title.replace(/[^a-zA-Z0-9]+/g, "-").toLowerCase()}_${new Date().toISOString().split("T")[0]}.md`;
      if (contentDisposition) {
        const match = contentDisposition.match(/filename="?(.+?)"?(?:;|$)/);
        if (match?.[1]) filename = match[1];
      }
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      toast.success("Transcript exported as Markdown");
    } catch {
      toast.error("Failed to export transcript");
    } finally {
      setIsExporting(false);
    }
  };

  const isRecording = recordingState === "recording";
  const isPaused = recordingState === "paused";
  const isActive = isRecording || isPaused;

  const handleDelete = async () => {
    setIsDeleting(true);
    try {
      if (isActive) {
        try { await stopRecording(); } catch {
          console.error("[Session] Failed to stop recording before deletion");
        }
      }
      const res = await fetch(`/api/sessions/${sessionId}`, { method: "DELETE" });
      if (res.ok) {
        toast.success("Session deleted");
        router.push("/dashboard");
      } else {
        toast.error("Failed to delete session");
      }
    } catch {
      toast.error("Failed to delete session");
    } finally {
      setIsDeleting(false);
      setShowDeleteDialog(false);
    }
  };

  const formatDuration = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}m ${secs}s`;
  };

  const recordDisabled = !isMediaRecorderSupported;

  return (
    <div className="container max-w-6xl mx-auto py-4 sm:py-8 px-4">
      <div className="flex flex-col gap-4 mb-6 sm:mb-8">
        <div className="flex items-center gap-3 min-w-0">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => router.push("/dashboard")}
            aria-label="Back to dashboard"
            className="flex items-center gap-2 shrink-0 h-9 min-w-[44px] min-h-[44px] sm:min-w-0 sm:min-h-0"
          >
            <ArrowLeft className="h-4 w-4" />
            <span className="hidden sm:inline">Back</span>
          </Button>
          <h1 className="text-xl sm:text-2xl md:text-3xl font-bold truncate">{sessionData.title}</h1>
        </div>
        <div className="flex flex-wrap gap-2">
          {!isActive && (
            <Button
              variant="default"
              size="sm"
              onClick={handleStartRecording}
              disabled={recordDisabled}
              className="gap-2 bg-red-600 hover:bg-red-700 text-white min-h-[44px]"
            >
              <Mic className="h-4 w-4" />
              Record
            </Button>
          )}
          {isRecording && (
            <>
              <Button
                variant="outline"
                size="sm"
                onClick={handlePauseRecording}
                className="gap-2 min-h-[44px]"
              >
                <Pause className="h-4 w-4" />
                Pause
              </Button>
              <Button
                variant="destructive"
                size="sm"
                onClick={() => setShowStopDialog(true)}
                className="gap-2 min-h-[44px]"
              >
                <Square className="h-4 w-4" />
                Stop
              </Button>
            </>
          )}
          {isPaused && (
            <>
              <Button
                variant="default"
                size="sm"
                onClick={handleResumeRecording}
                className="gap-2 min-h-[44px]"
              >
                <Play className="h-4 w-4" />
                Resume
              </Button>
              <Button
                variant="destructive"
                size="sm"
                onClick={() => setShowStopDialog(true)}
                className="gap-2 min-h-[44px]"
              >
                <Square className="h-4 w-4" />
                Stop
              </Button>
            </>
          )}
          <Button variant="outline" size="sm" onClick={handleExport} disabled={isExporting} className="min-h-[44px]">
            {isExporting ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Exporting...
              </>
            ) : (
              <>
                <Download className="h-4 w-4 mr-2" />
                Export
              </>
            )}
          </Button>
          <Button variant="destructive" size="sm" onClick={() => setShowDeleteDialog(true)} className="min-h-[44px]">
            <Trash2 className="h-4 w-4 mr-2" />
            Delete
          </Button>
        </div>
      </div>

      {/* Recording Status Banner */}
      {isActive && (
        <Card className={`mb-4 sm:mb-6 ${isRecording ? "border-red-200 dark:border-red-800" : "border-yellow-200 dark:border-yellow-800"}`}>
          <CardContent className="py-3">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
              <div className="flex items-center gap-3">
                {isRecording && (
                  <span className="relative flex h-3 w-3">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75" />
                    <span className="relative inline-flex rounded-full h-3 w-3 bg-red-500" />
                  </span>
                )}
                {isPaused && (
                  <span className="relative flex h-3 w-3">
                    <span className="relative inline-flex rounded-full h-3 w-3 bg-yellow-500" />
                  </span>
                )}
                <span className={`text-sm font-semibold ${isRecording ? "text-red-600 dark:text-red-400" : "text-yellow-600 dark:text-yellow-400"}`}>
                  {isRecording ? "Recording" : "Paused"}
                </span>
                <span className="text-2xl font-mono font-bold tabular-nums">
                  {formatTimer(streamingDuration)}
                </span>
                {deepgramState === "connecting" && (
                  <Badge variant="outline" className="text-xs gap-1">
                    <Loader2 className="h-3 w-3 animate-spin" />
                    Connecting
                  </Badge>
                )}
                {deepgramState === "open" && (
                  <Badge variant="outline" className="text-xs">Live</Badge>
                )}
              </div>
              <div className="flex items-center gap-3 flex-wrap">
                <div className="hidden sm:flex items-center gap-1.5">
                  <span className="text-xs text-muted-foreground">Level</span>
                  <div className="flex items-center gap-[2px] h-4" role="meter" aria-label="Audio input level" aria-valuenow={Math.round(audioLevel * 100)} aria-valuemin={0} aria-valuemax={100}>
                    {Array.from({ length: 12 }).map((_, i) => {
                      const activeBars = Math.round(audioLevel * 12);
                      const filled = i < activeBars;
                      let barColor = "bg-green-500";
                      if (i >= 12 * 0.7) barColor = "bg-red-500";
                      else if (i >= 12 * 0.5) barColor = "bg-yellow-500";
                      return (
                        <div
                          key={i}
                          className={`w-1.5 rounded-sm transition-all duration-75 ${filled ? barColor : "bg-muted"}`}
                          style={{ minHeight: "4px" }}
                        />
                      );
                    })}
                  </div>
                </div>
                <span className="text-xs text-muted-foreground">
                  {chunksSent} chunks sent
                </span>
                {isRecording && (
                  <Button
                    variant="destructive"
                    size="sm"
                    onClick={() => setShowStopDialog(true)}
                    className="gap-2 min-h-[44px]"
                  >
                    <Square className="h-4 w-4" />
                    <span className="hidden sm:inline">Stop Recording</span>
                    <span className="sm:hidden">Stop</span>
                  </Button>
                )}
                {isPaused && (
                  <Button
                    variant="default"
                    size="sm"
                    onClick={handleResumeRecording}
                    className="gap-2 min-h-[44px]"
                  >
                    <Play className="h-4 w-4" />
                    <span className="hidden sm:inline">Resume Recording</span>
                    <span className="sm:hidden">Resume</span>
                  </Button>
                )}
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Deepgram Service Error Banner */}
      {deepgramError && (
        <Card className="mb-6 border-red-300 dark:border-red-700">
          <CardContent className="py-3">
            <div className="flex items-start gap-3">
              <AlertTriangle className="h-5 w-5 text-red-500 shrink-0 mt-0.5" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-red-700 dark:text-red-400">{deepgramError.title}</p>
                <p className="text-xs text-muted-foreground mt-0.5">{deepgramError.message}</p>
                <p className="text-xs text-muted-foreground mt-1">
                  Your existing transcript data is preserved.
                </p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {deepgramError.canRetry && !isActive && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleStartRecording}
                    className="gap-1.5 text-xs"
                  >
                    <RefreshCw className="h-3.5 w-3.5" />
                    Retry
                  </Button>
                )}
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleDismissDeepgramError}
                  aria-label="Dismiss error"
                  className="h-7 w-7 p-0"
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Start Recording Banner for non-active sessions */}
      {!isActive && (
        <Card className="mb-4 sm:mb-6 border-blue-200 dark:border-blue-800">
          <CardContent className="py-3">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
              <div className="flex items-center gap-3">
                <Mic className="h-5 w-5 text-blue-500 shrink-0" />
                <div>
                  <p className="text-sm font-medium">
                    {sessionData.status === "completed"
                      ? "Session completed"
                      : sessionData.status === "paused"
                        ? "Recording paused"
                        : "Ready to record"}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Click &quot;Record&quot; to start a new recording in this session
                  </p>
                </div>
              </div>
              <Button
                variant="default"
                size="sm"
                onClick={handleStartRecording}
                disabled={recordDisabled}
                className="gap-2 bg-red-600 hover:bg-red-700 text-white min-h-[44px] shrink-0"
              >
                <Mic className="h-4 w-4" />
                Start Recording
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      <Card className="mb-4 sm:mb-6">
        <CardHeader>
          <CardTitle>Session Details</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div>
              <p className="text-sm text-muted-foreground">Status</p>
              <Badge
                variant={isActive ? "default" : "secondary"}
              >
                {isRecording && (
                  <Circle className="h-3 w-3 mr-1 fill-current" />
                )}
                {isPaused && (
                  <Pause className="h-3 w-3 mr-1" />
                )}
                {isActive ? (isRecording ? "Recording" : "Paused") : sessionData.status}
              </Badge>
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Source Language</p>
              <p className="font-medium">{sessionData.sourceLanguage}</p>
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Target Language</p>
              <p className="font-medium">{sessionData.targetLanguage}</p>
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Duration</p>
              <p className="font-medium">
                {isActive
                  ? formatTimer(streamingDuration)
                  : formatDuration(sessionData.durationSeconds)}
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      <TranscriptLayout
        ref={transcriptRef}
        segments={mergeSegments(sessionData.segments || [], liveSegments)}
        sourceLanguage={sessionData.sourceLanguage}
        targetLanguage={sessionData.targetLanguage}
        isRecording={isRecording}
        translationErrors={translationErrors}
        onRetryTranslation={handleRetryTranslation}
      />

      <Dialog open={showStopDialog} onOpenChange={setShowStopDialog}>
        <DialogContent showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>Stop recording?</DialogTitle>
            <DialogDescription>
              Your transcript will be saved.
            </DialogDescription>
          </DialogHeader>
          <div className="py-2">
            <p className="text-sm text-muted-foreground">
              Recording duration: <span className="font-mono font-bold">{formatTimer(streamingDuration)}</span>
            </p>
            <p className="text-sm text-muted-foreground mt-1">
              Audio chunks sent: <span className="font-mono font-bold">{chunksSent}</span>
            </p>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setShowStopDialog(false)}
              disabled={isStopping}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleStopRecording}
              disabled={isStopping}
              className="gap-2"
            >
              {isStopping ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Stopping...
                </>
              ) : (
                <>
                  <Square className="h-4 w-4" />
                  Stop Recording
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <DialogContent showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>Delete this session?</DialogTitle>
            <DialogDescription>
              This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <div className="py-2">
            <div className="flex items-start gap-3 rounded-lg border border-destructive/50 bg-destructive/5 p-3">
              <AlertTriangle className="h-5 w-5 text-destructive shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-medium text-destructive">
                  All transcript data will be permanently deleted
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  This session and all {sessionData?.segments?.length ?? 0} transcript segment{(sessionData?.segments?.length ?? 0) === 1 ? "" : "s"} will be removed and cannot be recovered.
                </p>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setShowDeleteDialog(false)}
              disabled={isDeleting}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleDelete}
              disabled={isDeleting}
              className="gap-2"
            >
              {isDeleting ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Deleting...
                </>
              ) : (
                <>
                  <Trash2 className="h-4 w-4" />
                  Delete Session
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
