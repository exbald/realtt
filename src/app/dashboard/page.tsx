"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Plus,
  Mic,
  Clock,
  Users,
  Globe,
  Play,
  Pause,
  CheckCircle2,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useSession } from "@/lib/auth-client";

interface TranscriptionSession {
  id: string;
  title: string;
  status: string;
  sourceLanguage: string;
  targetLanguage: string;
  durationSeconds: number;
  speakerCount: number;
  createdAt: string;
}

const LANGUAGE_NAMES: Record<string, string> = {
  en: "English",
  es: "Spanish",
  fr: "French",
  de: "German",
  it: "Italian",
  pt: "Portuguese",
  ja: "Japanese",
  ko: "Korean",
  zh: "Chinese",
  ar: "Arabic",
  ru: "Russian",
  hi: "Hindi",
  nl: "Dutch",
  sv: "Swedish",
  pl: "Polish",
  tr: "Turkish",
  auto: "Auto",
  "auto-detected": "Auto",
};

function getLangCode(lang: string): string {
  if (!lang) return "?";
  return lang.split("-")[0].toLowerCase();
}

function getLangDisplay(lang: string): string {
  const code = getLangCode(lang);
  return LANGUAGE_NAMES[code] || code.toUpperCase();
}

function formatDuration(seconds: number): string {
  if (!seconds || seconds === 0) return "0m 0s";
  const hrs = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;
  if (hrs > 0) return `${hrs}h ${mins}m`;
  if (mins > 0) return `${mins}m ${secs}s`;
  return `${secs}s`;
}

function formatDate(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return "Just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;

  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: date.getFullYear() !== now.getFullYear() ? "numeric" : undefined,
  });
}

function StatusBadge({ status }: { status: string }) {
  switch (status) {
    case "recording":
      return (
        <Badge className="bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400 border-red-200 dark:border-red-800">
          <Play className="h-3 w-3 mr-1" />
          Recording
        </Badge>
      );
    case "paused":
      return (
        <Badge className="bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400 border-yellow-200 dark:border-yellow-800">
          <Pause className="h-3 w-3 mr-1" />
          Paused
        </Badge>
      );
    case "completed":
      return (
        <Badge className="bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400 border-green-200 dark:border-green-800">
          <CheckCircle2 className="h-3 w-3 mr-1" />
          Completed
        </Badge>
      );
    default:
      return <Badge variant="secondary">{status}</Badge>;
  }
}

function SessionCardSkeleton() {
  return (
    <Card className="overflow-hidden">
      <CardHeader className="pb-3">
        <Skeleton className="h-5 w-3/4 mb-2" />
        <Skeleton className="h-3 w-1/3" />
      </CardHeader>
      <CardContent>
        <div className="flex flex-wrap gap-2 mb-3">
          <Skeleton className="h-5 w-16 rounded-full" />
          <Skeleton className="h-5 w-20 rounded-full" />
        </div>
        <div className="flex gap-4">
          <Skeleton className="h-4 w-16" />
          <Skeleton className="h-4 w-16" />
        </div>
      </CardContent>
    </Card>
  );
}

function EmptyState() {
  return (
    <Card className="border-dashed">
      <CardContent className="flex flex-col items-center justify-center py-16">
        <div className="rounded-full bg-muted p-4 mb-4">
          <Mic className="h-8 w-8 text-muted-foreground" />
        </div>
        <h3 className="text-lg font-semibold mb-2">No sessions yet</h3>
        <p className="text-muted-foreground text-center max-w-sm mb-6">
          Create your first transcription session to start capturing and
          translating audio in real-time.
        </p>
        <Button asChild>
          <Link href="/session/new">
            <Plus className="h-4 w-4 mr-2" />
            New Session
          </Link>
        </Button>
      </CardContent>
    </Card>
  );
}

export default function DashboardPage() {
  const { data: session, isPending } = useSession();
  const router = useRouter();
  const [sessions, setSessions] = useState<TranscriptionSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchSessions = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await fetch("/api/sessions");
      if (!res.ok) {
        if (res.status === 401) return;
        throw new Error("Failed to fetch sessions");
      }
      const data = await res.json();
      setSessions(Array.isArray(data) ? data : []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load sessions");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (session?.user?.id) {
      fetchSessions();
    }
  }, [session?.user?.id, fetchSessions]);

  if (isPending) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="animate-pulse text-muted-foreground">Loading...</div>
      </div>
    );
  }

  if (!session) {
    router.push("/login");
    return null;
  }

  const handleDelete = async (id: string, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!confirm("Delete this session? This cannot be undone.")) return;
    try {
      const res = await fetch(`/api/sessions/${id}`, { method: "DELETE" });
      if (res.ok) {
        toast.success("Session deleted");
        setSessions((prev) => prev.filter((s) => s.id !== id));
      } else {
        toast.error("Failed to delete session");
      }
    } catch {
      toast.error("Failed to delete session");
    }
  };

  return (
    <div className="container max-w-6xl mx-auto py-8 px-4">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-8">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Dashboard</h1>
          <p className="text-muted-foreground mt-1">
            Your transcription sessions
          </p>
        </div>
        <Button asChild size="lg">
          <Link href="/session/new">
            <Plus className="h-4 w-4 mr-2" />
            New Session
          </Link>
        </Button>
      </div>

      {/* Loading state */}
      {loading && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          <SessionCardSkeleton />
          <SessionCardSkeleton />
          <SessionCardSkeleton />
        </div>
      )}

      {/* Error state */}
      {error && !loading && (
        <Card className="border-destructive/50">
          <CardContent className="py-8 text-center">
            <p className="text-destructive mb-4">{error}</p>
            <Button variant="outline" onClick={fetchSessions}>
              Try Again
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Empty state */}
      {!loading && !error && sessions.length === 0 && <EmptyState />}

      {/* Session grid */}
      {!loading && !error && sessions.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {sessions.map((s) => (
            <Link key={s.id} href={`/session/${s.id}`} className="group">
              <Card className="h-full transition-all hover:shadow-md hover:border-primary/20 group-hover:border-primary/30 cursor-pointer relative">
                <CardHeader className="pb-3">
                  <div className="flex items-start justify-between gap-2">
                    <CardTitle className="text-base font-semibold line-clamp-1 leading-tight">
                      {s.title}
                    </CardTitle>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-destructive"
                      onClick={(e) => handleDelete(s.id, e)}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                  <CardDescription className="text-xs">
                    {formatDate(s.createdAt)}
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="flex flex-wrap gap-1.5 mb-3">
                    <StatusBadge status={s.status} />
                    <Badge variant="outline" className="text-xs font-normal">
                      <Globe className="h-3 w-3 mr-1" />
                      {getLangDisplay(s.sourceLanguage)} →{" "}
                      {getLangDisplay(s.targetLanguage)}
                    </Badge>
                  </div>
                  <div className="flex items-center gap-4 text-xs text-muted-foreground">
                    <span className="flex items-center gap-1">
                      <Clock className="h-3 w-3" />
                      {formatDuration(s.durationSeconds)}
                    </span>
                    <span className="flex items-center gap-1">
                      <Users className="h-3 w-3" />
                      {s.speakerCount}{" "}
                      {s.speakerCount === 1 ? "speaker" : "speakers"}
                    </span>
                  </div>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
