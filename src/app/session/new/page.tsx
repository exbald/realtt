"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Mic, Settings2 } from "lucide-react";
import { toast } from "sonner";
import { AudioLevelIndicator } from "@/components/audio-level-indicator";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useMicrophone } from "@/hooks/use-microphone";
import { useSession } from "@/lib/auth-client";

const LANGUAGES = [
  { value: "en", label: "English" },
  { value: "es", label: "Spanish" },
  { value: "fr", label: "French" },
  { value: "de", label: "German" },
  { value: "it", label: "Italian" },
  { value: "pt", label: "Portuguese" },
  { value: "zh", label: "Mandarin" },
  { value: "ja", label: "Japanese" },
  { value: "ko", label: "Korean" },
  { value: "ar", label: "Arabic" },
  { value: "ru", label: "Russian" },
  { value: "hi", label: "Hindi" },
];

export default function NewSessionPage() {
  const { data: session, isPending } = useSession();
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [targetLanguage, setTargetLanguage] = useState("en");
  const [creating, setCreating] = useState(false);
  const [savedMicId, setSavedMicId] = useState<string | null>(null);

  const {
    devices,
    selectedDeviceId,
    setSelectedDeviceId,
    permissionStatus,
    isRequestingPermission,
    audioLevel,
    isActive,
    requestPermission,
    errorMessage,
    startPreview,
    stopPreview,
  } = useMicrophone(savedMicId);

  useEffect(() => {
    if (!isPending && !session) {
      router.push("/");
    }
  }, [isPending, session, router]);

  // Load user's default target language and saved microphone
  useEffect(() => {
    if (session?.user?.id) {
      fetch("/api/settings")
        .then((res) => res.json())
        .then((data) => {
          if (data.defaultTargetLanguage) {
            setTargetLanguage(data.defaultTargetLanguage);
          }
          if (data.selectedMicrophoneId) {
            setSavedMicId(data.selectedMicrophoneId);
          }
        })
        .catch(() => {
          // Use defaults
        });
    }
  }, [session?.user?.id]);

  // Save selected microphone to settings when it changes
  const saveMicToSettings = useCallback(
    async (micId: string) => {
      try {
        await fetch("/api/settings", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ selectedMicrophoneId: micId }),
        });
      } catch {
        // Silently fail - not critical
      }
    },
    []
  );

  const handleDeviceChange = useCallback(
    (deviceId: string) => {
      setSelectedDeviceId(deviceId);
      saveMicToSettings(deviceId);
    },
    [setSelectedDeviceId, saveMicToSettings]
  );

  if (isPending || !session) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div>Loading...</div>
      </div>
    );
  }

  const handleCreate = async () => {
    if (!targetLanguage) {
      toast.error("Please select a target language");
      return;
    }
    // Stop preview before creating session
    if (isActive) {
      stopPreview();
    }
    setCreating(true);
    try {
      const res = await fetch("/api/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: title || "Untitled Session",
          targetLanguage,
        }),
      });
      if (res.ok) {
        const data = await res.json();
        toast.success("Session created");
        router.push(`/session/${data.id}`);
      } else {
        const err = await res.json();
        toast.error(err.error || "Failed to create session");
      }
    } catch {
      toast.error("Failed to create session");
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="container max-w-2xl mx-auto py-4 sm:py-8 px-4">
      <div className="flex items-center gap-3 mb-6 sm:mb-8">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => router.back()}
          className="flex items-center gap-2 min-h-[44px]"
        >
          <ArrowLeft className="h-4 w-4" />
          Back
        </Button>
        <h1 className="text-2xl sm:text-3xl font-bold">New Session</h1>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Mic className="h-5 w-5" />
            Start New Recording Session
          </CardTitle>
          <CardDescription>
            Configure your transcription session before recording
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Session Title */}
          <div className="space-y-2">
            <Label htmlFor="title">Session Title</Label>
            <Input
              id="title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Untitled Session"
            />
          </div>

          {/* Target Language */}
          <div className="space-y-2">
            <Label htmlFor="target-language">Target Language</Label>
            <Select value={targetLanguage} onValueChange={setTargetLanguage}>
              <SelectTrigger id="target-language">
                <SelectValue placeholder="Select language" />
              </SelectTrigger>
              <SelectContent>
                {LANGUAGES.map((lang) => (
                  <SelectItem key={lang.value} value={lang.value}>
                    {lang.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Microphone Selection */}
          <div className="space-y-2">
            <Label htmlFor="microphone-select" className="flex items-center gap-2">
              <Settings2 className="h-4 w-4" />
              Microphone
            </Label>
            <Select
              value={selectedDeviceId ?? ""}
              onValueChange={handleDeviceChange}
            >
              <SelectTrigger id="microphone-select">
                <SelectValue placeholder="Select microphone" />
              </SelectTrigger>
              <SelectContent>
                {devices.length === 0 ? (
                  <SelectItem value="no-devices" disabled>
                    No microphones detected
                  </SelectItem>
                ) : (
                  devices.map((device) => (
                    <SelectItem key={device.deviceId} value={device.deviceId}>
                      {device.label}
                    </SelectItem>
                  ))
                )}
              </SelectContent>
            </Select>
            {devices.length === 0 && permissionStatus === "prompt" && (
              <p className="text-xs text-muted-foreground">
                Click &quot;Test Microphone&quot; below to see available devices.
              </p>
            )}
          </div>

          {/* Audio Level Indicator & Permission Controls */}
          <AudioLevelIndicator
            audioLevel={audioLevel}
            isActive={isActive}
            permissionStatus={permissionStatus}
            errorMessage={errorMessage}
            isRequestingPermission={isRequestingPermission}
            onRequestPermission={requestPermission}
            onStartPreview={startPreview}
            onStopPreview={stopPreview}
          />

          {/* Create Session Button */}
          <div className="flex justify-end pt-4">
            <Button onClick={handleCreate} disabled={creating} size="lg" className="gap-2 min-h-[44px] w-full sm:w-auto">
              <Mic className="h-4 w-4" />
              {creating ? "Creating..." : "Start Recording"}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
