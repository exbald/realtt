"use client";

import { Mic, MicOff, AlertTriangle, Loader2 } from "lucide-react";
import type { MicrophonePermissionStatus } from "@/hooks/use-microphone";
import { cn } from "@/lib/utils";

interface AudioLevelIndicatorProps {
  audioLevel: number;
  isActive: boolean;
  permissionStatus: MicrophonePermissionStatus;
  errorMessage: string | null;
  isRequestingPermission: boolean;
  onRequestPermission: () => void;
  onStartPreview: () => void;
  onStopPreview: () => void;
}

export function AudioLevelIndicator({
  audioLevel,
  isActive,
  permissionStatus,
  errorMessage,
  isRequestingPermission,
  onRequestPermission,
  onStartPreview,
  onStopPreview,
}: AudioLevelIndicatorProps) {
  // Bar segments for visual audio level
  const barCount = 20;
  const activeBars = Math.round(audioLevel * barCount);

  return (
    <div className="space-y-3">
      {/* Audio level bar */}
      {isActive && (
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <Mic className="h-4 w-4 text-green-500 shrink-0" />
            <span className="text-sm text-muted-foreground">Audio Level</span>
            {isActive && (
              <span className="inline-flex items-center gap-1 text-xs text-green-600">
                <span className="h-2 w-2 rounded-full bg-green-500 animate-pulse" />
                Live
              </span>
            )}
          </div>
          <div className="flex items-center gap-[2px] h-6" role="meter" aria-label="Audio input level" aria-valuenow={Math.round(audioLevel * 100)} aria-valuemin={0} aria-valuemax={100}>
            {Array.from({ length: barCount }).map((_, i) => {
              const filled = i < activeBars;
              // Color gradient: green -> yellow -> red
              let barColor = "bg-green-500";
              if (i >= barCount * 0.7) {
                barColor = "bg-red-500";
              } else if (i >= barCount * 0.5) {
                barColor = "bg-yellow-500";
              }

              return (
                <div
                  key={i}
                  className={cn(
                    "flex-1 rounded-sm transition-all duration-75",
                    filled ? barColor : "bg-muted"
                  )}
                  style={{ minHeight: "4px" }}
                />
              );
            })}
          </div>
        </div>
      )}

      {/* Permission and preview controls */}
      <div className="flex flex-wrap items-center gap-2">
        {permissionStatus === "denied" ? (
          <div className="flex items-start gap-2 p-3 rounded-md bg-destructive/10 border border-destructive/20 w-full">
            <AlertTriangle className="h-5 w-5 text-destructive shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-medium text-destructive">Microphone Access Denied</p>
              <p className="text-sm text-muted-foreground mt-1">
                {errorMessage || "Microphone access is required for transcription. Please allow microphone access in your browser settings and try again."}
              </p>
            </div>
          </div>
        ) : permissionStatus === "unsupported" ? (
          <div className="flex items-start gap-2 p-3 rounded-md bg-destructive/10 border border-destructive/20 w-full">
            <MicOff className="h-5 w-5 text-destructive shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-medium text-destructive">Microphone Not Supported</p>
              <p className="text-sm text-muted-foreground mt-1">
                Your browser does not support microphone access. Please use a modern browser like Chrome, Firefox, or Edge.
              </p>
            </div>
          </div>
        ) : permissionStatus === "prompt" && !isActive ? (
          <button
            type="button"
            onClick={async () => {
              await onRequestPermission();
              onStartPreview();
            }}
            disabled={isRequestingPermission}
            className="inline-flex items-center gap-2 rounded-md border border-input bg-background px-3 py-2 text-sm font-medium shadow-xs transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50"
          >
            {isRequestingPermission ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Mic className="h-4 w-4" />
            )}
            {isRequestingPermission ? "Requesting Access..." : "Test Microphone"}
          </button>
        ) : permissionStatus === "granted" && !isActive ? (
          <button
            type="button"
            onClick={onStartPreview}
            disabled={isRequestingPermission}
            className="inline-flex items-center gap-2 rounded-md border border-input bg-background px-3 py-2 text-sm font-medium shadow-xs transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50"
          >
            {isRequestingPermission ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Mic className="h-4 w-4" />
            )}
            {isRequestingPermission ? "Starting..." : "Test Microphone"}
          </button>
        ) : isActive ? (
          <button
            type="button"
            onClick={onStopPreview}
            className="inline-flex items-center gap-2 rounded-md border border-input bg-background px-3 py-2 text-sm font-medium shadow-xs transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          >
            <MicOff className="h-4 w-4" />
            Stop Test
          </button>
        ) : null}
      </div>
    </div>
  );
}
