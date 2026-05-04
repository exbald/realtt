"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useRouter, useParams } from "next/navigation";
import {
  ArrowLeft,
  Trash2,
  Download,
  Wifi,
  WifiOff,
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
import { useSocket, ConnectionState } from "@/hooks/use-socket";
import { useSession } from "@/lib/auth-client";

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

/** Deepgram service error state */
interface DeepgramError {
  title: string;
  message: string;
  canRetry: boolean;
  reconnecting: boolean;
  retryAttempt?: number;
  maxRetries?: number;
}

/** Per-segment translation error state */
interface TranslationError {
  segmentId: string;
  error: string;
}

function getConnectionStateDisplay(state: ConnectionState, transport: string | null) {
  switch (state) {
    case "connected":
      return {
        label: transport === "websocket" ? "WebSocket" : "Connected",
        icon: Wifi,
        color: "text-green-500",
        bgColor: "bg-green-50 dark:bg-green-950",
      };
    case "connecting":
      return {
        label: "Connecting...",
        icon: Loader2,
        color: "text-yellow-500",
        bgColor: "bg-yellow-50 dark:bg-yellow-950",
      };
    case "reconnecting":
      return {
        label: "Reconnecting...",
        icon: Loader2,
        color: "text-orange-500",
        bgColor: "bg-orange-50 dark:bg-orange-950",
      };
    case "disconnected":
    default:
      return {
        label: "Disconnected",
        icon: WifiOff,
        color: "text-red-500",
        bgColor: "bg-red-50 dark:bg-red-950",
      };
  }
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
 * Live segments replace database segments when they overlap (interim → final).
 * Final live segments take priority over database segments.
 */
function mergeSegments(
  dbSegments: TranscriptSegment[],
  liveSegments: TranscriptSegment[]
): TranscriptSegment[] {
  if (liveSegments.length === 0) return dbSegments;
  if (dbSegments.length === 0) return liveSegments;

  // Start with DB segments that aren't overridden by live segments
  const merged = dbSegments.filter((db) => {
    // If there's a final live segment for the same speaker/time, prefer live
    return !liveSegments.some(
      (live) =>
        live.isFinal &&
        live.speakerLabel === db.speakerLabel &&
        Math.abs(live.startTime - db.startTime) < 2
    );
  });

  // Add all live segments
  for (const live of liveSegments) {
    // Don't add live segments that duplicate DB segments
    if (!merged.some((m) => m.id === live.id)) {
      merged.push(live);
    }
  }

  // Sort by start time, then by createdAt
  merged.sort((a, b) => {
    if (a.startTime !== b.startTime) return a.startTime - b.startTime;
    return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
  });

  return merged;
}

export default function SessionDetailPage() {
  const { data: session, isPending } = useSession();
  const router = useRouter();
  const params = useParams();
  const sessionId = params.id as string;
  const [sessionData, setSessionData] = useState<TranscriptionSession | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showDisconnectWarning, setShowDisconnectWarning] = useState(false);

  // Recording state
  const [showStopDialog, setShowStopDialog] = useState(false);
  const [isStopping, setIsStopping] = useState(false);

  // Delete state
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  // Real-time transcript segments (interim + final from Deepgram)
  const [liveSegments, setLiveSegments] = useState<TranscriptSegment[]>([]);

  // Error states
  const [deepgramError, setDeepgramError] = useState<DeepgramError | null>(null);
  const [translationErrors, setTranslationErrors] = useState<Map<string, string>>(new Map());
  const [isRetryingDeepgram, setIsRetryingDeepgram] = useState(false);

  // Transcript layout ref for auto-scroll
  const transcriptRef = useRef<TranscriptLayoutHandle>(null);

  // Socket.io connection - auto-connects when sessionId is available
  const {
    connectionState,
    isConnected,
    socket,
    reconnectAttempts,
    transport,
    disconnect: disconnectSocket,
  } = useSocket({
    autoConnect: true,
    sessionId,
    onConnect: (sock) => {
      // eslint-disable-next-line no-console
      console.log(`[Session] Socket connected: ${sock.id}`);
      toast.success("Real-time connection established");
    },
    onDisconnect: (reason) => {
      // eslint-disable-next-line no-console
      console.log(`[Session] Socket disconnected: ${reason}`);
      if (reason === "io server disconnect" || reason === "io client disconnect") {
        // Intentional disconnect - no warning needed
        return;
      }
      setShowDisconnectWarning(true);
    },
    onReconnect: () => {
      // eslint-disable-next-line no-console
      console.log("[Session] Socket reconnected");
      toast.success("Connection restored");
      setShowDisconnectWarning(false);
    },
    onError: (err) => {
      console.error("[Session] Socket error:", err.message);
    },
  });

  // Listen for real-time transcript segments from Deepgram
  useEffect(() => {
    if (!socket) return;

    const handleTranscriptSegment = (segment: TranscriptSegment & { isFinal?: boolean }) => {
      setLiveSegments((prev) => {
        // For final segments, replace any matching interim segment
        if (segment.isFinal) {
          // Check if there's an interim segment with similar timing for same speaker
          const filtered = prev.filter(
            (s) =>
              !(
                s.speakerLabel === segment.speakerLabel &&
                !s.isFinal &&
                Math.abs(s.startTime - segment.startTime) < 2
              )
          );
          return [...filtered, { ...segment, createdAt: segment.createdAt || new Date().toISOString() }];
        }

        // For interim segments, replace existing interim for same speaker/time range
        const filtered = prev.filter(
          (s) =>
            !(
              s.speakerLabel === segment.speakerLabel &&
              !s.isFinal &&
              Math.abs(s.startTime - segment.startTime) < 2
            )
        );
        return [...filtered, { ...segment, createdAt: segment.createdAt || new Date().toISOString() }];
      });
    };

    // Listen for streaming translation chunks from OpenRouter
    const handleTranslationChunk = (data: { segmentId: string; translatedText: string; isDone: boolean }) => {
      setLiveSegments((prev) =>
        prev.map((seg) => {
          if (seg.id === data.segmentId) {
            return { ...seg, translatedText: data.translatedText };
          }
          return seg;
        })
      );

      // Also update sessionData segments if the segment is already saved in DB
      if (data.isDone) {
        setSessionData((prev) => {
          if (!prev) return prev;
          return {
            ...prev,
            segments: prev.segments.map((seg) => {
              if (seg.id === data.segmentId) {
                return { ...seg, translatedText: data.translatedText };
              }
              return seg;
            }),
          };
        });
        // Clear any previous error for this segment on success
        setTranslationErrors((prev) => {
          const next = new Map(prev);
          next.delete(data.segmentId);
          return next;
        });
      }
    };

    // Listen for translation errors
    const handleTranslationError = (data: TranslationError) => {
      setTranslationErrors((prev) => {
        const next = new Map(prev);
        next.set(data.segmentId, data.error);
        return next;
      });
    };

    // Listen for Deepgram service errors
    const handleDeepgramError = (data: DeepgramError & { sessionId?: string }) => {
      setDeepgramError({
        title: data.title,
        message: data.message,
        canRetry: data.canRetry,
        reconnecting: data.reconnecting,
        retryAttempt: data.retryAttempt,
        maxRetries: data.maxRetries,
      });
      setIsRetryingDeepgram(data.reconnecting);
    };

    // Listen for Deepgram reconnection success
    const handleDeepgramReconnected = () => {
      setDeepgramError(null);
      setIsRetryingDeepgram(false);
      toast.success("Transcription service reconnected");
    };

    socket.on("transcript-segment", handleTranscriptSegment);
    socket.on("translation-chunk", handleTranslationChunk);
    socket.on("translation-error", handleTranslationError);
    socket.on("deepgram-error", handleDeepgramError);
    socket.on("deepgram-reconnected", handleDeepgramReconnected);

    return () => {
      socket.off("transcript-segment", handleTranscriptSegment);
      socket.off("translation-chunk", handleTranslationChunk);
      socket.off("translation-error", handleTranslationError);
      socket.off("deepgram-error", handleDeepgramError);
      socket.off("deepgram-reconnected", handleDeepgramReconnected);
    };
  }, [socket]);

  // Audio streaming hook
  const {
    recordingState,
    chunksSent,
    duration: streamingDuration,
    audioLevel,
    isSupported: isMediaRecorderSupported,
    startRecording,
    pauseRecording,
    resumeRecording,
    stopRecording,
  } = useAudioStreaming({
    socket,
    isConnected,
    sessionId,
    targetLanguage: sessionData?.targetLanguage || "en",
    onStateChange: (state) => {
      // eslint-disable-next-line no-console
      console.log(`[Session] Recording state changed: ${state}`);
    },
    onError: (err) => {
      console.error("[Session] Recording error:", err.message);
      toast.error(`Recording error: ${err.message}`);
    },
  });

  useEffect(() => {
    if (!isPending && !session) {
      router.push("/");
    }
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
    try {
      // Update session status to "recording" in the database
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
      setSessionData((prev) => prev ? { ...prev, ...updated } : prev);

      // Start audio streaming
      await startRecording();
      toast.success("Recording started");
    } catch (err) {
      toast.error("Failed to start recording");
    }
  }, [sessionId, startRecording]);

  const handlePauseRecording = useCallback(async () => {
    pauseRecording();

    // Update session status to "paused" in the database
    try {
      const res = await fetch(`/api/sessions/${sessionId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "paused" }),
      });
      if (res.ok) {
        const updated = await res.json();
        setSessionData((prev) => prev ? { ...prev, ...updated } : prev);
      }
    } catch {
      // Database update failed but recording is still paused client-side
      console.error("[Session] Failed to update pause status in database");
    }

    toast.info("Recording paused");
  }, [pauseRecording, sessionId]);

  const handleResumeRecording = useCallback(async () => {
    resumeRecording();

    // Update session status back to "recording" in the database
    try {
      const res = await fetch(`/api/sessions/${sessionId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "recording" }),
      });
      if (res.ok) {
        const updated = await res.json();
        setSessionData((prev) => prev ? { ...prev, ...updated } : prev);
      }
    } catch {
      // Database update failed but recording is still resumed client-side
      console.error("[Session] Failed to update resume status in database");
    }

    toast.info("Recording resumed");
  }, [resumeRecording, sessionId]);

  // Retry Deepgram connection
  const handleRetryDeepgram = useCallback(() => {
    if (!socket || !isConnected) {
      toast.error("Cannot retry: not connected to server");
      return;
    }
    setIsRetryingDeepgram(true);
    setDeepgramError((prev) => prev ? { ...prev, reconnecting: true } : prev);
    socket.emit("retry-deepgram");
  }, [socket, isConnected]);

  // Dismiss Deepgram error
  const handleDismissDeepgramError = useCallback(() => {
    setDeepgramError(null);
  }, []);

  // Retry translation for a specific segment
  const handleRetryTranslation = useCallback((segmentId: string) => {
    if (!socket || !isConnected) return;
    // Find the segment text
    const mergedSegs = mergeSegments(sessionData?.segments || [], liveSegments);
    const segment = mergedSegs.find((s) => s.id === segmentId);
    if (!segment) return;

    // Clear the error for this segment
    setTranslationErrors((prev) => {
      const next = new Map(prev);
      next.delete(segmentId);
      return next;
    });

    socket.emit("retry-translation", {
      segmentId,
      originalText: segment.originalText,
      targetLanguage: sessionData?.targetLanguage || "en",
    });
  }, [socket, isConnected, sessionData, liveSegments]);

  const handleStopRecording = useCallback(async () => {
    setIsStopping(true);
    try {
      // Stop audio streaming
      await stopRecording();

      // Update session status to "completed" with duration
      const currentDuration = streamingDuration;
      const res = await fetch(`/api/sessions/${sessionId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          status: "completed",
          durationSeconds: currentDuration,
        }),
      });

      if (res.ok) {
        const updated = await res.json();
        setSessionData((prev) => prev ? { ...prev, ...updated } : prev);
        toast.success(`Recording stopped (${chunksSent} audio chunks sent)`);
        setShowStopDialog(false);
      } else {
        const err = await res.json();
        toast.error(err.error || "Failed to stop recording");
      }
    } catch {
      toast.error("Failed to stop recording");
    } finally {
      setIsStopping(false);
    }
  }, [sessionId, streamingDuration, stopRecording, chunksSent]);

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
      <div className="container max-w-4xl mx-auto py-8 px-4">
        <div className="flex items-center gap-4 mb-8">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => router.push("/dashboard")}
            className="flex items-center gap-2"
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

  const handleExport = () => {
    window.open(`/api/sessions/${sessionId}/export`, "_blank");
  };

  const handleDelete = async () => {
    setIsDeleting(true);
    try {
      const res = await fetch(`/api/sessions/${sessionId}`, {
        method: "DELETE",
      });
      if (res.ok) {
        disconnectSocket();
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

  const isRecording = recordingState === "recording";
  const isPaused = recordingState === "paused";
  const isActive = isRecording || isPaused;
  const connectionDisplay = getConnectionStateDisplay(connectionState, transport);
  const ConnectionIcon = connectionDisplay.icon;

  return (
    <div className="container max-w-6xl mx-auto py-8 px-4">
      <div className="flex items-center justify-between mb-8">
        <div className="flex items-center gap-4">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => router.push("/dashboard")}
            className="flex items-center gap-2"
          >
            <ArrowLeft className="h-4 w-4" />
            Back
          </Button>
          <h1 className="text-2xl sm:text-3xl font-bold">{sessionData.title}</h1>
        </div>
        <div className="flex gap-2">
          {/* Recording Controls */}
          {sessionData.status === "completed" && !isActive && (
            <Button
              variant="default"
              size="sm"
              onClick={handleStartRecording}
              disabled={!isConnected || !isMediaRecorderSupported}
              className="gap-2 bg-red-600 hover:bg-red-700 text-white"
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
                className="gap-2"
              >
                <Pause className="h-4 w-4" />
                Pause
              </Button>
              <Button
                variant="destructive"
                size="sm"
                onClick={() => setShowStopDialog(true)}
                className="gap-2"
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
                className="gap-2"
              >
                <Play className="h-4 w-4" />
                Resume
              </Button>
              <Button
                variant="destructive"
                size="sm"
                onClick={() => setShowStopDialog(true)}
                className="gap-2"
              >
                <Square className="h-4 w-4" />
                Stop
              </Button>
            </>
          )}
          <Button variant="outline" size="sm" onClick={handleExport}>
            <Download className="h-4 w-4 mr-2" />
            Export
          </Button>
          <Button variant="destructive" size="sm" onClick={() => setShowDeleteDialog(true)}>
            <Trash2 className="h-4 w-4 mr-2" />
            Delete
          </Button>
        </div>
      </div>

      {/* Recording Status Banner */}
      {isActive && (
        <Card className={`mb-6 ${isRecording ? "border-red-200 dark:border-red-800" : "border-yellow-200 dark:border-yellow-800"}`}>
          <CardContent className="py-3">
            <div className="flex items-center justify-between">
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
              </div>
              <div className="flex items-center gap-3">
                {/* Audio level bar */}
                <div className="hidden sm:flex items-center gap-1.5">
                  <span className="text-xs text-muted-foreground">Level</span>
                  <div className="flex items-center gap-[2px] h-4" role="meter" aria-label="Audio input level" aria-valuenow={Math.round(audioLevel * 100)} aria-valuemin={0} aria-valuemax={100}>
                    {Array.from({ length: 12 }).map((_, i) => {
                      const activeBars = Math.round(audioLevel * 12);
                      const filled = i < activeBars;
                      let barColor = "bg-green-500";
                      if (i >= 12 * 0.7) {
                        barColor = "bg-red-500";
                      } else if (i >= 12 * 0.5) {
                        barColor = "bg-yellow-500";
                      }
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
                {/* Chunk counter */}
                <span className="text-xs text-muted-foreground">
                  {chunksSent} chunks sent
                </span>
                {isRecording && (
                  <Button
                    variant="destructive"
                    size="sm"
                    onClick={() => setShowStopDialog(true)}
                    className="gap-2"
                  >
                    <Square className="h-4 w-4" />
                    Stop Recording
                  </Button>
                )}
                {isPaused && (
                  <Button
                    variant="default"
                    size="sm"
                    onClick={handleResumeRecording}
                    className="gap-2"
                  >
                    <Play className="h-4 w-4" />
                    Resume Recording
                  </Button>
                )}
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Connection Status Banner */}
      <Card className="mb-6">
        <CardContent className="py-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <ConnectionIcon
                className={`h-4 w-4 ${connectionDisplay.color} ${
                  connectionState === "connecting" || connectionState === "reconnecting"
                    ? "animate-spin"
                    : ""
                }`}
              />
              <span className={`text-sm font-medium ${connectionDisplay.color}`}>
                {connectionDisplay.label}
              </span>
              {isConnected && transport && (
                <Badge variant="outline" className="text-xs">
                  {transport}
                </Badge>
              )}
              {reconnectAttempts > 0 && connectionState === "reconnecting" && (
                <span className="text-xs text-muted-foreground">
                  (attempt {reconnectAttempts})
                </span>
              )}
            </div>
            <div className="flex items-center gap-2">
              <Badge
                variant={isActive ? "default" : "secondary"}
              >
                {isActive && isRecording && (
                  <Circle className="h-3 w-3 mr-1 fill-current" />
                )}
                {isActive && isPaused && (
                  <Pause className="h-3 w-3 mr-1" />
                )}
                {!isActive && sessionData.status}
                {isRecording && "Recording"}
                {isPaused && "Paused"}
              </Badge>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Disconnection Warning */}
      {showDisconnectWarning && (
        <Card className="mb-6 border-orange-300 dark:border-orange-700">
          <CardContent className="py-3">
            <div className="flex items-center gap-3">
              <AlertTriangle className="h-5 w-5 text-orange-500" />
              <div>
                <p className="text-sm font-medium">Connection Lost</p>
                <p className="text-xs text-muted-foreground">
                  Attempting to reconnect... Your session data is safe.
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Start Recording Banner for completed sessions */}
      {sessionData.status === "completed" && !isActive && (
        <Card className="mb-6 border-blue-200 dark:border-blue-800">
          <CardContent className="py-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <Mic className="h-5 w-5 text-blue-500" />
                <div>
                  <p className="text-sm font-medium">Session completed</p>
                  <p className="text-xs text-muted-foreground">
                    Click &quot;Record&quot; to start a new recording in this session
                  </p>
                </div>
              </div>
              <Button
                variant="default"
                size="sm"
                onClick={handleStartRecording}
                disabled={!isConnected || !isMediaRecorderSupported}
                className="gap-2 bg-red-600 hover:bg-red-700 text-white"
              >
                <Mic className="h-4 w-4" />
                Start Recording
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      <Card className="mb-6">
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
      />

      {/* Stop Recording Confirmation Dialog */}
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

      {/* Delete Session Confirmation Dialog */}
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
