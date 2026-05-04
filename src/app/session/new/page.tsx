"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Mic, Settings2, AlertCircle } from "lucide-react";
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

const MAX_TITLE_LENGTH = 200;

interface FormErrors {
  title?: string;
  targetLanguage?: string;
  microphone?: string;
}

export default function NewSessionPage() {
  const { data: session, isPending } = useSession();
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [targetLanguage, setTargetLanguage] = useState("");
  const [creating, setCreating] = useState(false);
  const [savedMicId, setSavedMicId] = useState<string | null>(null);
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const [submitted, setSubmitted] = useState(false);

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

  // Validate form fields - errors clear automatically when user corrects input
  const errors: FormErrors = useMemo(() => {
    const result: FormErrors = {};

    // Title validation
    if (title.length > MAX_TITLE_LENGTH) {
      result.title = `Title must be ${MAX_TITLE_LENGTH} characters or less (${title.length}/${MAX_TITLE_LENGTH})`;
    }

    // Target language validation
    if (!targetLanguage) {
      result.targetLanguage = "Please select a target language";
    }

    // Microphone validation - only show if user has already interacted
    // (permission denied or no devices after granting permission)
    if (permissionStatus === "denied") {
      result.microphone = "Microphone access denied. Please allow microphone access in your browser settings.";
    } else if (permissionStatus === "granted" && devices.length === 0) {
      result.microphone = "No microphone detected. Please connect a microphone and refresh.";
    }

    return result;
  }, [title, targetLanguage, permissionStatus, devices.length]);

  // Only show errors for fields that have been touched or form was submitted
  const visibleErrors: FormErrors = useMemo(() => {
    const result: FormErrors = {};
    if ((touched.title || submitted) && errors.title) {
      result.title = errors.title;
    }
    if ((touched.targetLanguage || submitted) && errors.targetLanguage) {
      result.targetLanguage = errors.targetLanguage;
    }
    // Microphone errors are always visible once permission state is known
    if (errors.microphone) {
      result.microphone = errors.microphone;
    }
    return result;
  }, [errors, touched, submitted]);

  const hasErrors = Object.keys(errors).length > 0;

  if (isPending || !session) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div>Loading...</div>
      </div>
    );
  }

  const handleTitleChange = (value: string) => {
    setTitle(value);
    // Error clears automatically via useMemo when title is corrected
  };

  const handleLanguageChange = (value: string) => {
    setTargetLanguage(value);
    setTouched((prev) => ({ ...prev, targetLanguage: true }));
    // Error clears automatically via useMemo when language is selected
  };

  const handleTitleBlur = () => {
    setTouched((prev) => ({ ...prev, title: true }));
  };

  const handleCreate = async () => {
    setSubmitted(true);

    // Check for validation errors before submitting
    if (!targetLanguage) {
      return;
    }

    if (title.length > MAX_TITLE_LENGTH) {
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
            <div className="flex items-center justify-between">
              <Label htmlFor="title">Session Title</Label>
              <span className="text-xs text-muted-foreground">
                {title.length}/{MAX_TITLE_LENGTH}
              </span>
            </div>
            <Input
              id="title"
              value={title}
              onChange={(e) => handleTitleChange(e.target.value)}
              onBlur={handleTitleBlur}
              placeholder="Untitled Session"
              aria-invalid={!!visibleErrors.title}
              aria-describedby={visibleErrors.title ? "title-error" : undefined}
              className={visibleErrors.title ? "border-destructive focus-visible:ring-destructive" : ""}
            />
            {visibleErrors.title && (
              <p id="title-error" className="text-sm text-destructive flex items-center gap-1.5">
                <AlertCircle className="h-3.5 w-3.5 shrink-0" />
                {visibleErrors.title}
              </p>
            )}
            {!title && !visibleErrors.title && (
              <p className="text-xs text-muted-foreground">
                Leave empty for &quot;Untitled Session&quot;
              </p>
            )}
          </div>

          {/* Target Language */}
          <div className="space-y-2">
            <Label htmlFor="target-language">Target Language</Label>
            <Select value={targetLanguage} onValueChange={handleLanguageChange}>
              <SelectTrigger
                id="target-language"
                aria-invalid={!!visibleErrors.targetLanguage}
                className={visibleErrors.targetLanguage ? "border-destructive focus:ring-destructive" : ""}
              >
                <SelectValue placeholder="Select a language" />
              </SelectTrigger>
              <SelectContent>
                {LANGUAGES.map((lang) => (
                  <SelectItem key={lang.value} value={lang.value}>
                    {lang.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {visibleErrors.targetLanguage && (
              <p id="language-error" className="text-sm text-destructive flex items-center gap-1.5">
                <AlertCircle className="h-3.5 w-3.5 shrink-0" />
                {visibleErrors.targetLanguage}
              </p>
            )}
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
              <SelectTrigger
                id="microphone-select"
                aria-invalid={!!visibleErrors.microphone}
                className={visibleErrors.microphone ? "border-destructive focus:ring-destructive" : ""}
              >
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
            {visibleErrors.microphone && (
              <p id="mic-error" className="text-sm text-destructive flex items-center gap-1.5">
                <AlertCircle className="h-3.5 w-3.5 shrink-0" />
                {visibleErrors.microphone}
              </p>
            )}
            {devices.length === 0 && permissionStatus === "prompt" && !visibleErrors.microphone && (
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
            <Button
              onClick={handleCreate}
              disabled={creating || (submitted && hasErrors)}
              size="lg"
              className="gap-2 min-h-[44px] w-full sm:w-auto"
            >
              <Mic className="h-4 w-4" />
              {creating ? "Creating..." : "Start Recording"}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
