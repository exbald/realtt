"use client";

import { useState, useEffect, useRef, useCallback } from "react";
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
} from "lucide-react";
import { toast } from "sonner";
import { TranscriptLayout } from "@/components/transcript-layout";
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
  const [elapsedSeconds, setElapsedSeconds] = useState(0);

  // Delete state
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startTimeRef = useRef<number>(0);

  // Socket.io connection - auto-connects when sessionId is available
  const {
    connectionState,
    isConnected,
    reconnectAttempts,
    transport,
    disconnect: disconnectSocket,
  } = useSocket({
    autoConnect: true,
    sessionId,
    onConnect: (socket) => {
      // eslint-disable-next-line no-console
      console.log(`[Session] Socket connected: ${socket.id}`);
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

  // Timer logic for recording sessions
  useEffect(() => {
    const isRecording = sessionData?.status === "recording";

    if (isRecording) {
      // Calculate elapsed time from session creation or stored duration
      if (elapsedSeconds === 0 && sessionData?.createdAt) {
        const created = new Date(sessionData.createdAt).getTime();
        const now = Date.now();
        const elapsed = Math.floor((now - created) / 1000);
        startTimeRef.current = now - elapsed * 1000;
        setElapsedSeconds(elapsed);
      } else if (startTimeRef.current === 0) {
        startTimeRef.current = Date.now() - elapsedSeconds * 1000;
      }

      timerRef.current = setInterval(() => {
        const now = Date.now();
        const elapsed = Math.floor((now - startTimeRef.current) / 1000);
        setElapsedSeconds(elapsed);
      }, 1000);
    }

    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [sessionData?.status, sessionData?.createdAt]);

  // Cleanup socket on unmount
  useEffect(() => {
    return () => {
      // Socket cleanup is handled by useSocket's useEffect cleanup
    };
  }, []);

  const handleStopRecording = useCallback(async () => {
    setIsStopping(true);
    try {
      const currentDuration = elapsedSeconds;
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
        // Stop the timer
        if (timerRef.current) {
          clearInterval(timerRef.current);
          timerRef.current = null;
        }
        toast.success("Recording stopped");
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
  }, [sessionId, elapsedSeconds]);

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

  const isRecording = sessionData.status === "recording";
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
          {isRecording && (
            <Button
              variant="destructive"
              size="sm"
              onClick={() => setShowStopDialog(true)}
              className="gap-2"
            >
              <Square className="h-4 w-4" />
              Stop
            </Button>
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
      {isRecording && (
        <Card className="mb-6 border-red-200 dark:border-red-800">
          <CardContent className="py-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <span className="relative flex h-3 w-3">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75" />
                  <span className="relative inline-flex rounded-full h-3 w-3 bg-red-500" />
                </span>
                <span className="text-sm font-semibold text-red-600 dark:text-red-400">
                  Recording
                </span>
                <span className="text-2xl font-mono font-bold tabular-nums">
                  {formatTimer(elapsedSeconds)}
                </span>
              </div>
              <Button
                variant="destructive"
                size="sm"
                onClick={() => setShowStopDialog(true)}
                className="gap-2"
              >
                <Square className="h-4 w-4" />
                Stop Recording
              </Button>
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
                variant={sessionData.status === "recording" ? "default" : "secondary"}
              >
                {isRecording && (
                  <Circle className="h-3 w-3 mr-1 fill-current" />
                )}
                {sessionData.status}
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

      <Card className="mb-6">
        <CardHeader>
          <CardTitle>Session Details</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div>
              <p className="text-sm text-muted-foreground">Status</p>
              <Badge
                variant={sessionData.status === "recording" ? "default" : "secondary"}
              >
                {isRecording && (
                  <Circle className="h-3 w-3 mr-1 fill-current" />
                )}
                {sessionData.status}
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
                {isRecording
                  ? formatTimer(elapsedSeconds)
                  : formatDuration(sessionData.durationSeconds)}
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      <TranscriptLayout
        segments={sessionData.segments || []}
        sourceLanguage={sessionData.sourceLanguage}
        targetLanguage={sessionData.targetLanguage}
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
              Recording duration: <span className="font-mono font-bold">{formatTimer(elapsedSeconds)}</span>
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
