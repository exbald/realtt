"use client";

import { useMemo } from "react";
import { Clock, Languages } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";

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

interface TranscriptLayoutProps {
  segments: TranscriptSegment[];
  sourceLanguage: string | null;
  targetLanguage: string;
}

// Distinct colors for speaker identification
const SPEAKER_COLORS = [
  {
    bg: "bg-blue-100 dark:bg-blue-900/40",
    text: "text-blue-700 dark:text-blue-300",
    border: "border-blue-200 dark:border-blue-800",
    dot: "bg-blue-500",
  },
  {
    bg: "bg-green-100 dark:bg-green-900/40",
    text: "text-green-700 dark:text-green-300",
    border: "border-green-200 dark:border-green-800",
    dot: "bg-green-500",
  },
  {
    bg: "bg-purple-100 dark:bg-purple-900/40",
    text: "text-purple-700 dark:text-purple-300",
    border: "border-purple-200 dark:border-purple-800",
    dot: "bg-purple-500",
  },
  {
    bg: "bg-orange-100 dark:bg-orange-900/40",
    text: "text-orange-700 dark:text-orange-300",
    border: "border-orange-200 dark:border-orange-800",
    dot: "bg-orange-500",
  },
  {
    bg: "bg-pink-100 dark:bg-pink-900/40",
    text: "text-pink-700 dark:text-pink-300",
    border: "border-pink-200 dark:border-pink-800",
    dot: "bg-pink-500",
  },
  {
    bg: "bg-cyan-100 dark:bg-cyan-900/40",
    text: "text-cyan-700 dark:text-cyan-300",
    border: "border-cyan-200 dark:border-cyan-800",
    dot: "bg-cyan-500",
  },
];

function formatTime(seconds: number | null): string {
  if (seconds === null || seconds === undefined) return "--:--";
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}

function getSpeakerColor(
  speakerLabel: string,
  speakerMap: Map<string, number>
) {
  const index = speakerMap.get(speakerLabel) ?? 0;
  const safeIndex = index % SPEAKER_COLORS.length;
  return SPEAKER_COLORS[safeIndex]!;
}

export function TranscriptLayout({
  segments,
  sourceLanguage,
  targetLanguage,
}: TranscriptLayoutProps) {
  // Build a speaker-to-color-index map for consistent coloring
  const speakerMap = useMemo(() => {
    const map = new Map<string, number>();
    let idx = 0;
    for (const seg of segments) {
      if (!map.has(seg.speakerLabel)) {
        map.set(seg.speakerLabel, idx++);
      }
    }
    return map;
  }, [segments]);

  const sourceLabel = sourceLanguage && sourceLanguage !== "auto-detected"
    ? sourceLanguage
    : "Source";
  const targetLabel = targetLanguage || "Translation";

  if (!segments.length) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Transcript</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-muted-foreground text-center py-8">
            No transcript segments yet. Start recording to see transcription
            results.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2">
          <Languages className="h-5 w-5" />
          Transcript
        </CardTitle>
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Badge variant="outline" className="text-xs">
            {segments.length} segments
          </Badge>
          <span>•</span>
          <span>{speakerMap.size} speakers</span>
        </div>
      </CardHeader>
      <CardContent>
        {/* Column Headers */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
          <div className="flex items-center gap-2 px-3 py-2 rounded-md bg-muted/50">
            <Languages className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm font-semibold">
              Original ({sourceLabel})
            </span>
          </div>
          <div className="flex items-center gap-2 px-3 py-2 rounded-md bg-muted/50">
            <Languages className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm font-semibold">
              Translation ({targetLabel})
            </span>
          </div>
        </div>

        <Separator className="mb-4" />

        {/* Segment Rows */}
        <div className="space-y-0">
          {segments.map((segment, i) => {
            const color = getSpeakerColor(segment.speakerLabel, speakerMap);
            return (
              <div key={segment.id}>
                {i > 0 && <Separator className="my-3" />}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {/* Original Column */}
                  <div className="space-y-2">
                    <div className="flex items-center gap-2">
                      <span
                        className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-semibold ${color.bg} ${color.text} ${color.border}`}
                      >
                        <span
                          className={`h-2 w-2 rounded-full ${color.dot}`}
                        />
                        {segment.speakerLabel}
                      </span>
                      <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                        <Clock className="h-3 w-3" />
                        {formatTime(segment.startTime)} –{" "}
                        {formatTime(segment.endTime)}
                      </span>
                    </div>
                    <p className="text-sm leading-relaxed pl-1">
                      {segment.originalText}
                    </p>
                  </div>

                  {/* Translation Column */}
                  <div className="space-y-2">
                    <div className="flex items-center gap-2">
                      <span
                        className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-semibold ${color.bg} ${color.text} ${color.border}`}
                      >
                        <span
                          className={`h-2 w-2 rounded-full ${color.dot}`}
                        />
                        {segment.speakerLabel}
                      </span>
                      <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                        <Clock className="h-3 w-3" />
                        {formatTime(segment.startTime)} –{" "}
                        {formatTime(segment.endTime)}
                      </span>
                    </div>
                    <p className="text-sm leading-relaxed pl-1">
                      {segment.translatedText ? (
                        segment.translatedText
                      ) : (
                        <span className="italic text-muted-foreground">
                          Translation pending...
                        </span>
                      )}
                    </p>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
