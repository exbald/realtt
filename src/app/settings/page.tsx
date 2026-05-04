"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Globe, Mic, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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

interface AudioDevice {
  deviceId: string;
  label: string;
}

async function loadAudioDevices(): Promise<AudioDevice[]> {
  if (!navigator.mediaDevices?.enumerateDevices) return [];
  try {
    const allDevices = await navigator.mediaDevices.enumerateDevices();
    return allDevices
      .filter((d) => d.kind === "audioinput")
      .map((d) => ({
        deviceId: d.deviceId,
        label: d.label || `Microphone (${d.deviceId.slice(0, 8)}...)`,
      }));
  } catch {
    return [];
  }
}

export default function SettingsPage() {
  const { data: session, isPending } = useSession();
  const router = useRouter();
  const [targetLanguage, setTargetLanguage] = useState("en");
  const [microphoneId, setMicrophoneId] = useState<string>("default");
  const [devices, setDevices] = useState<AudioDevice[]>([]);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const initialLoadDone = useRef(false);

  // Redirect if not authenticated
  useEffect(() => {
    if (!isPending && !session) {
      router.push("/");
    }
  }, [isPending, session, router]);

  // Load settings from API and enumerate devices on mount
  useEffect(() => {
    if (!session?.user?.id || initialLoadDone.current) return;
    initialLoadDone.current = true;

    Promise.all([
      fetch("/api/settings")
        .then((res) => res.json())
        .then((data) => {
          if (data.defaultTargetLanguage) {
            setTargetLanguage(data.defaultTargetLanguage);
          }
          if (data.selectedMicrophoneId) {
            setMicrophoneId(data.selectedMicrophoneId);
          }
        })
        .catch(() => {
          // Use defaults
        }),
      loadAudioDevices().then((audioInputs) => {
        setDevices(audioInputs);
      }),
    ]).finally(() => {
      setLoading(false);
    });
  }, [session?.user?.id]);

  // Listen for device changes (hot-plug/unplug)
  useEffect(() => {
    if (!navigator.mediaDevices) return;
    const handler = () => {
      loadAudioDevices().then((audioInputs) => {
        setDevices(audioInputs);
      });
    };
    navigator.mediaDevices.addEventListener("devicechange", handler);
    return () => navigator.mediaDevices.removeEventListener("devicechange", handler);
  }, []);

  // Refresh device list (requests permission first if needed)
  const handleRefreshDevices = async () => {
    setRefreshing(true);
    try {
      // Try to get permission so device labels become available
      if (navigator.mediaDevices?.getUserMedia) {
        try {
          const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
          stream.getTracks().forEach((t) => t.stop());
        } catch {
          // Permission denied - still enumerate what we can
        }
      }
      const audioInputs = await loadAudioDevices();
      setDevices(audioInputs);
      toast.success("Microphone list refreshed");
    } finally {
      setRefreshing(false);
    }
  };

  // Save settings to API
  const handleSave = async () => {
    // Client-side validation: ensure target language is selected
    if (!targetLanguage || targetLanguage.trim() === "") {
      toast.error("Please select a target language");
      return;
    }

    // Validate language is in the supported list
    const validCodes = LANGUAGES.map((l) => l.value);
    if (!validCodes.includes(targetLanguage)) {
      toast.error("Invalid language selected. Please choose from the list.");
      return;
    }

    setSaving(true);
    try {
      const body: { defaultTargetLanguage: string; selectedMicrophoneId?: string | null } = {
        defaultTargetLanguage: targetLanguage,
      };
      if (microphoneId && microphoneId !== "default") {
        body.selectedMicrophoneId = microphoneId;
      } else {
        body.selectedMicrophoneId = null;
      }

      const res = await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (res.ok) {
        toast.success("Settings saved");
      } else {
        const data = await res.json().catch(() => ({}));
        toast.error(data.error || "Failed to save settings");
      }
    } catch {
      toast.error("Failed to save settings");
    } finally {
      setSaving(false);
    }
  };

  if (isPending || !session || loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div>Loading...</div>
      </div>
    );
  }

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
        <h1 className="text-2xl sm:text-3xl font-bold">Settings</h1>
      </div>

      <div className="grid gap-6">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Globe className="h-5 w-5" />
              Translation Settings
            </CardTitle>
            <CardDescription>
              Configure your default translation preferences
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="target-language">Default Target Language</Label>
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
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Mic className="h-5 w-5" />
              Audio Settings
            </CardTitle>
            <CardDescription>
              Configure microphone and audio input preferences
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label htmlFor="microphone-select">Preferred Microphone</Label>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleRefreshDevices}
                  disabled={refreshing}
                  className="h-8 px-2"
                >
                  <RefreshCw className={`h-3.5 w-3.5 mr-1 ${refreshing ? "animate-spin" : ""}`} />
                  Refresh
                </Button>
              </div>
              <Select value={microphoneId} onValueChange={setMicrophoneId}>
                <SelectTrigger id="microphone-select">
                  <SelectValue placeholder="Select microphone" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="default">
                    System Default
                  </SelectItem>
                  {devices.map((device) => (
                    <SelectItem key={device.deviceId} value={device.deviceId}>
                      {device.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {devices.length === 0 && (
                <div className="flex items-start gap-2 rounded-md border border-muted bg-muted/50 p-3">
                  <Mic className="h-4 w-4 mt-0.5 text-muted-foreground shrink-0" />
                  <div className="text-sm">
                    <p className="font-medium text-foreground">No microphone detected</p>
                    <p className="text-muted-foreground text-xs mt-1">
                      Click &quot;Refresh&quot; to detect available microphones. You may need to grant microphone permission in your browser.
                    </p>
                  </div>
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        <div className="flex justify-end">
          <Button onClick={handleSave} disabled={saving} className="min-h-[44px] w-full sm:w-auto">
            {saving ? "Saving..." : "Save Settings"}
          </Button>
        </div>
      </div>
    </div>
  );
}
