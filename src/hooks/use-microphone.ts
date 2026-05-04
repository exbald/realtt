"use client";

import { useState, useEffect, useCallback, useRef } from "react";

export interface AudioDevice {
  deviceId: string;
  label: string;
  kind: MediaDeviceKind;
}

export type MicrophonePermissionStatus = "prompt" | "granted" | "denied" | "unsupported";

export interface UseMicrophoneReturn {
  /** List of available audio input devices */
  devices: AudioDevice[];
  /** Currently selected device ID */
  selectedDeviceId: string | null;
  /** Set the selected device and re-initialize the stream */
  setSelectedDeviceId: (deviceId: string) => void;
  /** Current permission status */
  permissionStatus: MicrophonePermissionStatus;
  /** Whether we are currently requesting permission */
  isRequestingPermission: boolean;
  /** Audio level between 0 and 1 (updated in real-time) */
  audioLevel: number;
  /** Whether the microphone stream is active */
  isActive: boolean;
  /** Request microphone permission explicitly */
  requestPermission: () => Promise<void>;
  /** Error message for display */
  errorMessage: string | null;
  /** Start the audio level monitor */
  startPreview: () => Promise<void>;
  /** Stop the audio level monitor */
  stopPreview: () => void;
}

async function loadAudioDevices(): Promise<AudioDevice[]> {
  if (!navigator.mediaDevices?.enumerateDevices) {
    return [];
  }
  const allDevices = await navigator.mediaDevices.enumerateDevices();
  return allDevices
    .filter((d) => d.kind === "audioinput" && d.deviceId !== "")
    .map((d) => ({
      deviceId: d.deviceId,
      label: d.label || `Microphone (${d.deviceId.slice(0, 8)}...)`,
      kind: d.kind,
    }));
}

export function useMicrophone(savedDeviceId?: string | null): UseMicrophoneReturn {
  const [devices, setDevices] = useState<AudioDevice[]>([]);
  const [selectedDeviceId, setSelectedDeviceIdState] = useState<string | null>(savedDeviceId ?? null);
  const [permissionStatus, setPermissionStatus] = useState<MicrophonePermissionStatus>("prompt");
  const [isRequestingPermission, setIsRequestingPermission] = useState(false);
  const [audioLevel, setAudioLevel] = useState(0);
  const [isActive, setIsActive] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const streamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const isActiveRef = useRef(false);

  // Cleanup helper
  const cleanupStream = useCallback(() => {
    if (animationFrameRef.current !== null) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }
    if (sourceRef.current) {
      try { sourceRef.current.disconnect(); } catch { /* ignore */ }
      sourceRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    if (audioContextRef.current && audioContextRef.current.state !== "closed") {
      try { audioContextRef.current.close(); } catch { /* ignore */ }
      audioContextRef.current = null;
    }
    analyserRef.current = null;
    isActiveRef.current = false;
    setIsActive(false);
    setAudioLevel(0);
  }, []);

  // Start audio level monitoring
  const startAudioLevelMonitoring = useCallback((stream: MediaStream) => {
    const audioContext = new AudioContext();
    const analyser = audioContext.createAnalyser();
    analyser.fftSize = 256;
    analyser.smoothingTimeConstant = 0.8;

    const source = audioContext.createMediaStreamSource(stream);
    source.connect(analyser);

    audioContextRef.current = audioContext;
    analyserRef.current = analyser;
    sourceRef.current = source;

    const dataArray = new Uint8Array(analyser.frequencyBinCount);

    const updateLevel = () => {
      analyser.getByteFrequencyData(dataArray);
      let sum = 0;
      for (let i = 0; i < dataArray.length; i++) {
        const val = dataArray[i]!;
        sum += val * val;
      }
      const rms = Math.sqrt(sum / dataArray.length);
      const normalizedLevel = Math.min(1, rms / 128);
      setAudioLevel(normalizedLevel);
      animationFrameRef.current = requestAnimationFrame(updateLevel);
    };

    animationFrameRef.current = requestAnimationFrame(updateLevel);
  }, []);

  // Build getUserMedia constraints for the selected device
  const buildConstraints = useCallback((): MediaStreamConstraints => {
    return {
      audio: selectedDeviceId && selectedDeviceId !== "default"
        ? { deviceId: { exact: selectedDeviceId } }
        : true,
    };
  }, [selectedDeviceId]);

  // Handle permission errors
  const handlePermissionError = useCallback((err: unknown) => {
    const error = err as DOMException;
    if (error.name === "NotAllowedError" || error.name === "PermissionDeniedError") {
      setPermissionStatus("denied");
      setErrorMessage(
        "Microphone access was denied. Please allow microphone access in your browser settings to use transcription."
      );
    } else if (error.name === "NotFoundError") {
      setErrorMessage("No microphone device found. Please connect a microphone and try again.");
    } else if (error.name === "NotReadableError") {
      setErrorMessage("Your microphone is being used by another application. Please close other apps using the microphone and try again.");
    } else {
      setErrorMessage(`Could not access microphone: ${error.message || "Unknown error"}`);
    }
  }, []);

  // Request permission (without starting preview)
  const requestPermission = useCallback(async () => {
    if (!navigator.mediaDevices?.getUserMedia) {
      setPermissionStatus("unsupported");
      setErrorMessage("Your browser does not support microphone access. Please use a modern browser like Chrome, Firefox, or Edge.");
      return;
    }

    setIsRequestingPermission(true);
    setErrorMessage(null);

    try {
      const stream = await navigator.mediaDevices.getUserMedia(buildConstraints());
      // Stop immediately — we just needed permission
      stream.getTracks().forEach((track) => track.stop());
      setPermissionStatus("granted");

      // Re-enumerate to get device labels now that permission is granted
      const audioInputs = await loadAudioDevices();
      setDevices(audioInputs);
      if (audioInputs.length > 0 && !selectedDeviceId) {
        const defaultDevice = audioInputs.find((d) => d.deviceId === "default") ?? audioInputs[0]!;
        setSelectedDeviceIdState(defaultDevice.deviceId);
      }
    } catch (err: unknown) {
      handlePermissionError(err);
    } finally {
      setIsRequestingPermission(false);
    }
  }, [buildConstraints, selectedDeviceId, handlePermissionError]);

  // Start preview (open stream + monitor audio levels)
  const startPreview = useCallback(async () => {
    cleanupStream();

    if (!navigator.mediaDevices?.getUserMedia) {
      setPermissionStatus("unsupported");
      setErrorMessage("Your browser does not support microphone access.");
      return;
    }

    setErrorMessage(null);
    setIsRequestingPermission(true);

    try {
      const stream = await navigator.mediaDevices.getUserMedia(buildConstraints());
      streamRef.current = stream;
      setPermissionStatus("granted");
      isActiveRef.current = true;
      setIsActive(true);
      setIsRequestingPermission(false);

      // Re-enumerate to get device labels
      const audioInputs = await loadAudioDevices();
      setDevices(audioInputs);

      // Start monitoring audio levels
      startAudioLevelMonitoring(stream);
    } catch (err: unknown) {
      setIsRequestingPermission(false);
      handlePermissionError(err);
    }
  }, [buildConstraints, cleanupStream, startAudioLevelMonitoring, handlePermissionError]);

  // Stop preview
  const stopPreview = useCallback(() => {
    cleanupStream();
  }, [cleanupStream]);

  // Handle device change - auto-restart preview if active
  const setSelectedDeviceId = useCallback(
    (deviceId: string) => {
      const wasActive = isActiveRef.current;
      setSelectedDeviceIdState(deviceId);
      if (wasActive) {
        cleanupStream();
        // Re-acquire stream with new device constraints after state update
        // Use setTimeout to ensure selectedDeviceId state has been applied
        // and buildConstraints will use the new deviceId
        setTimeout(() => {
          // startPreview reads selectedDeviceId from closure which is stale
          // We need to pass constraints directly
          const acquireNewStream = async () => {
            try {
              const constraints: MediaStreamConstraints = {
                audio: deviceId && deviceId !== "default"
                  ? { deviceId: { exact: deviceId } }
                  : true,
              };
              const stream = await navigator.mediaDevices.getUserMedia(constraints);
              streamRef.current = stream;
              isActiveRef.current = true;
              setIsActive(true);
              const audioInputs = await loadAudioDevices();
              setDevices(audioInputs);
              startAudioLevelMonitoring(stream);
            } catch (err: unknown) {
              handlePermissionError(err);
            }
          };
          acquireNewStream();
        }, 0);
      }
    },
    [cleanupStream, startAudioLevelMonitoring, handlePermissionError]
  );

  // Initial setup: check permission + enumerate devices
  useEffect(() => {
    const init = async () => {
      // Check permission status
      try {
        if (navigator.mediaDevices && navigator.permissions) {
          const result = await navigator.permissions.query({ name: "microphone" as PermissionName });
          // Permission state is read-only, only set once + listen for changes
          if (result.state === "granted" || result.state === "denied" || result.state === "prompt") {
            setPermissionStatus(result.state as MicrophonePermissionStatus);
          }
          result.addEventListener("change", () => {
            const newState = result.state;
            if (newState === "granted" || newState === "denied" || newState === "prompt") {
              setPermissionStatus(newState as MicrophonePermissionStatus);
            }
          });
        }
      } catch {
        // permissions.query may not be supported for microphone in all browsers
      }

      // Enumerate devices
      if (!navigator.mediaDevices?.enumerateDevices) {
        setPermissionStatus("unsupported");
        setErrorMessage("Your browser does not support microphone access.");
        return;
      }

      try {
        const audioInputs = await loadAudioDevices();
        setDevices(audioInputs);

        // If we have labels, permission was already granted
        if (audioInputs.length > 0 && audioInputs[0]!.label) {
          setPermissionStatus("granted");
        }

        // Auto-select saved or default device
        if (savedDeviceId) {
          setSelectedDeviceIdState(savedDeviceId);
        } else if (audioInputs.length > 0) {
          const defaultDevice = audioInputs.find((d) => d.deviceId === "default") ?? audioInputs[0]!;
          setSelectedDeviceIdState(defaultDevice.deviceId);
        }
      } catch {
        setErrorMessage("Failed to enumerate audio devices.");
      }
    };

    init();
    // Only run once on mount and when savedDeviceId changes
  }, [savedDeviceId]);

  // Listen for device changes (e.g., plugging/unplugging a mic)
  useEffect(() => {
    if (!navigator.mediaDevices) return;

    const refreshDevices = async () => {
      try {
        const audioInputs = await loadAudioDevices();
        setDevices(audioInputs);
      } catch {
        // silently fail on device change refresh
      }
    };

    navigator.mediaDevices.addEventListener("devicechange", refreshDevices);
    return () => {
      navigator.mediaDevices.removeEventListener("devicechange", refreshDevices);
    };
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      cleanupStream();
    };
  }, [cleanupStream]);

  return {
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
  };
}
