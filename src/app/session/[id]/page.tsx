"use client";

import { useState, useEffect } from "react";
import { useRouter, useParams } from "next/navigation";
import {
  ArrowLeft,
  Trash2,
  Download,
  Wifi,
  WifiOff,
  Loader2,
  AlertTriangle,
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

export default function SessionDetailPage() {
  const { data: session, isPending } = useSession();
  const router = useRouter();
  const params = useParams();
  const sessionId = params.id as string;
  const [sessionData, setSessionData] = useState<TranscriptionSession | null>(
    null
  );
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showDisconnectWarning, setShowDisconnectWarning] = useState(false);

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

  // Cleanup socket on unmount (handled by useSocket hook, but also explicitly)
  useEffect(() => {
    return () => {
      // Socket cleanup is handled by useSocket's useEffect cleanup
      // This is just for explicit page-level awareness
    };
  }, []);

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
    if (!confirm("Are you sure you want to delete this session?")) return;
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
    }
  };

  const formatDuration = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}m ${secs}s`;
  };

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
          <Button variant="outline" size="sm" onClick={handleExport}>
            <Download className="h-4 w-4 mr-2" />
            Export
          </Button>
          <Button variant="destructive" size="sm" onClick={handleDelete}>
            <Trash2 className="h-4 w-4 mr-2" />
            Delete
          </Button>
        </div>
      </div>

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
                {formatDuration(sessionData.durationSeconds)}
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
    </div>
  );
}
