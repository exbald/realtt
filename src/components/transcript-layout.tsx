"use client";

import { useMemo, useEffect, forwardRef, useImperativeHandle, useRef, useState } from "react";
import { Clock, Languages, Loader2, ArrowDown } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
  /** Whether recording is currently active (enables auto-scroll) */
  isRecording?: boolean;
  /** Max height for the transcript area before scrolling (CSS value) */
  maxHeight?: string;
}

export interface TranscriptLayoutHandle {
  /** Scroll to bottom of transcript */
  scrollToBottom: () => void;
  /** Get the scroll container ref */
  getContainer: () => HTMLDivElement | null;
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

// Count only final segments for stats
function countFinalSegments(segments: TranscriptSegment[]): number {
  return segments.filter((s) => s.isFinal).length;
}

export const TranscriptLayout = forwardRef<TranscriptLayoutHandle, TranscriptLayoutProps>(
  function TranscriptLayout(
    { segments, sourceLanguage, targetLanguage, isRecording = false, maxHeight = "600px" },
    ref
  ) {
    // Scroll state
    const scrollContainerRef = useRef<HTMLDivElement | null>(null);
    const isAutoScrollingRef = useRef(false);
    const wasAtBottomRef = useRef(true);
    const [showScrollToBottom, setShowScrollToBottom] = useState(false);
    const [newItemsCount, setNewItemsCount] = useState(0);
    const prevSegmentCountRef = useRef(0);

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

    const finalCount = countFinalSegments(segments);
    const interimCount = segments.length - finalCount;

    // Check if user is near bottom
    const checkIsAtBottom = () => {
      const container = scrollContainerRef.current;
      if (!container) return true;
      const { scrollTop, scrollHeight, clientHeight } = container;
      return scrollHeight - scrollTop - clientHeight <= 80;
    };

    // Scroll to bottom function
    const scrollToBottom = () => {
      const container = scrollContainerRef.current;
      if (!container) return;
      isAutoScrollingRef.current = true;
      container.scrollTo({
        top: container.scrollHeight,
        behavior: "smooth",
      });
      setShowScrollToBottom(false);
      setNewItemsCount(0);
      wasAtBottomRef.current = true;
      setTimeout(() => {
        isAutoScrollingRef.current = false;
      }, 500);
    };

    // Expose imperative handle
    useImperativeHandle(ref, () => ({
      scrollToBottom,
      getContainer: () => scrollContainerRef.current,
    }));

    // Listen for scroll events
    useEffect(() => {
      const container = scrollContainerRef.current;
      if (!container) return;

      const handleScroll = () => {
        if (isAutoScrollingRef.current) return;

        const atBottom = checkIsAtBottom();
        if (atBottom) {
          wasAtBottomRef.current = true;
          setShowScrollToBottom(false);
          setNewItemsCount(0);
        } else if (wasAtBottomRef.current) {
          wasAtBottomRef.current = false;
        }
      };

      container.addEventListener("scroll", handleScroll, { passive: true });
      return () => container.removeEventListener("scroll", handleScroll);
    }, []);

    // Auto-scroll when segments change during recording
    useEffect(() => {
      const currentCount = segments.length;
      const prevCount = prevSegmentCountRef.current;

      if (currentCount > prevCount) {
        const newCount = currentCount - prevCount;
        if (wasAtBottomRef.current) {
          // Auto-scroll to bottom
          requestAnimationFrame(() => {
            scrollToBottom();
          });
        } else {
          // User is scrolled up - show indicator
          setNewItemsCount((prev) => prev + newCount);
          setShowScrollToBottom(true);
        }
      }

      // Also handle case where a segment transitions from interim to final
      // (count stays the same but content changes)
      if (currentCount === prevCount && currentCount > 0 && wasAtBottomRef.current) {
        requestAnimationFrame(() => {
          scrollToBottom();
        });
      }

      prevSegmentCountRef.current = currentCount;
    }, [segments]);

    // When recording stops, scroll to bottom to show final state
    useEffect(() => {
      if (!isRecording && segments.length > 0) {
        requestAnimationFrame(() => {
          scrollToBottom();
        });
      }
    }, [isRecording, segments.length]);

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
              {finalCount} final
            </Badge>
            {interimCount > 0 && (
              <Badge variant="outline" className="text-xs text-yellow-600 dark:text-yellow-400 border-yellow-300 dark:border-yellow-700">
                {interimCount} interim
              </Badge>
            )}
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

          {/* Scrollable Transcript Area */}
          <div className="relative">
            <div
              ref={scrollContainerRef}
              className="overflow-y-auto scroll-smooth"
              style={{ maxHeight }}
              data-testid="transcript-scroll-container"
            >
              <div className="space-y-0">
                {segments.map((segment, i) => {
                  const color = getSpeakerColor(segment.speakerLabel, speakerMap);
                  const isInterim = !segment.isFinal;
                  return (
                    <div
                      key={segment.id}
                      className={`transition-all duration-300 ease-in-out ${
                        isInterim
                          ? "opacity-50"
                          : "opacity-100"
                      }`}
                    >
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
                            {isInterim && (
                              <span className="inline-flex items-center gap-1 text-xs text-yellow-600 dark:text-yellow-400">
                                <span className="h-1.5 w-1.5 rounded-full bg-yellow-500 animate-pulse" />
                                interim
                              </span>
                            )}
                          </div>
                          <p className={`text-sm leading-relaxed pl-1 transition-all duration-300 ${
                            isInterim
                              ? "italic text-muted-foreground"
                              : "font-normal text-foreground"
                          }`}>
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
                              <span className={`transition-all duration-300 ${
                                isInterim ? "italic text-muted-foreground" : "text-foreground"
                              }`}>{segment.translatedText}</span>
                            ) : segment.isFinal ? (
                              <span className="italic text-muted-foreground flex items-center gap-1.5">
                                <Loader2 className="h-3 w-3 animate-spin" />
                                Translating...
                              </span>
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
            </div>

            {/* Scroll to Bottom Indicator */}
            {showScrollToBottom && (
              <div className="absolute bottom-2 left-1/2 -translate-x-1/2 z-10">
                <Button
                  size="sm"
                  variant="secondary"
                  className="shadow-lg rounded-full gap-1.5 text-xs px-3 py-1.5 h-auto bg-background/90 backdrop-blur-sm border"
                  onClick={scrollToBottom}
                  data-testid="scroll-to-bottom-button"
                >
                  <ArrowDown className="h-3.5 w-3.5" />
                  <span>New entries</span>
                  {newItemsCount > 0 && (
                    <Badge variant="default" className="ml-1 h-5 min-w-5 text-[10px] px-1.5 rounded-full">
                      {newItemsCount}
                    </Badge>
                  )}
                </Button>
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    );
  }
);

export default TranscriptLayout;
