"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { Socket } from "socket.io-client";

export type RecordingState = "idle" | "recording" | "paused" | "stopping";

export interface UseAudioStreamingOptions {
  /** Socket.io client instance */
  socket: Socket | null;
  /** Whether the socket is connected */
  isConnected: boolean;
  /** Session ID for the recording */
  sessionId: string;
  /** Target language for translation */
  targetLanguage: string;
  /** Microphone device ID to use */
  deviceId?: string | null;
  /** Called when a chunk is sent */
  onChunkSent?: (chunkIndex: number) => void;
  /** Called when recording state changes */
  onStateChange?: (state: RecordingState) => void;
  /** Called on error */
  onError?: (error: Error) => void;
}

export interface UseAudioStreamingReturn {
  /** Current recording state */
  recordingState: RecordingState;
  /** Number of chunks sent */
  chunksSent: number;
  /** Duration in seconds */
  duration: number;
  /** Whether the browser supports MediaRecorder */
  isSupported: boolean;
  /** Audio level between 0 and 1 (updated in real-time while recording) */
  audioLevel: number;
  /** Start recording */
  startRecording: () => Promise<void>;
  /** Pause recording */
  pauseRecording: () => void;
  /** Resume recording */
  resumeRecording: () => void;
  /** Stop recording */
  stopRecording: () => Promise<void>;
}

// Audio chunk interval in milliseconds (send chunks every 250ms)
const CHUNK_TIMESLICE = 250;

export function useAudioStreaming({
  socket,
  isConnected,
  sessionId,
  targetLanguage,
  deviceId,
  onChunkSent,
  onStateChange,
  onError,
}: UseAudioStreamingOptions): UseAudioStreamingReturn {
  const [recordingState, setRecordingState] = useState<RecordingState>("idle");
  const [chunksSent, setChunksSent] = useState(0);
  const [duration, setDuration] = useState(0);
  const [audioLevel, setAudioLevel] = useState(0);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunkIndexRef = useRef(0);
  const durationIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startTimeRef = useRef<number>(0);
  const pausedDurationRef = useRef<number>(0);
  const isStoppingRef = useRef(false);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);

  const isSupported = typeof window !== "undefined" && typeof MediaRecorder !== "undefined";

  // Clean up all resources
  const cleanup = useCallback(() => {
    // Clear duration timer
    if (durationIntervalRef.current) {
      clearInterval(durationIntervalRef.current);
      durationIntervalRef.current = null;
    }

    // Stop audio level monitoring
    if (animationFrameRef.current !== null) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }
    if (sourceRef.current) {
      try { sourceRef.current.disconnect(); } catch { /* ignore */ }
      sourceRef.current = null;
    }
    if (audioContextRef.current && audioContextRef.current.state !== "closed") {
      try { audioContextRef.current.close(); } catch { /* ignore */ }
      audioContextRef.current = null;
    }
    analyserRef.current = null;
    setAudioLevel(0);

    // Stop MediaRecorder
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
      try {
        mediaRecorderRef.current.stop();
      } catch {
        // Ignore if already stopped
      }
    }
    mediaRecorderRef.current = null;

    // Stop all audio tracks
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }

    chunkIndexRef.current = 0;
    isStoppingRef.current = false;
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      cleanup();
    };
  }, [cleanup]);

  const startRecording = useCallback(async () => {
    if (!isSupported) {
      onError?.(new Error("MediaRecorder is not supported in this browser"));
      return;
    }
    if (!socket || !isConnected) {
      onError?.(new Error("Socket is not connected"));
      return;
    }
    if (recordingState !== "idle" && recordingState !== "paused") {
      return;
    }

    try {
      // Get microphone stream with optional device constraint
      const constraints: MediaStreamConstraints = {
        audio: deviceId && deviceId !== "default"
          ? { deviceId: { exact: deviceId } }
          : true,
      };

      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      streamRef.current = stream;

      // Create MediaRecorder with audio/webm for efficient binary transfer
      // Fall back to whatever codec is supported
      const mimeTypes = [
        "audio/webm;codecs=opus",
        "audio/webm",
        "audio/ogg;codecs=opus",
        "audio/mp4",
      ];
      let selectedMimeType = "";
      for (const mimeType of mimeTypes) {
        if (MediaRecorder.isTypeSupported(mimeType)) {
          selectedMimeType = mimeType;
          break;
        }
      }

      const mediaRecorderOptions: MediaRecorderOptions = {};
      if (selectedMimeType) {
        mediaRecorderOptions.mimeType = selectedMimeType;
      }
      mediaRecorderOptions.audioBitsPerSecond = 16000; // 16kbps for speech - small chunks

      const mediaRecorder = new MediaRecorder(stream, mediaRecorderOptions);
      mediaRecorderRef.current = mediaRecorder;

      // Reset counters
      chunkIndexRef.current = 0;
      setChunksSent(0);
      setDuration(0);

      // Handle data available - this fires at each timeslice interval
      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0 && socket?.connected && !isStoppingRef.current) {
          chunkIndexRef.current += 1;
          const currentIndex = chunkIndexRef.current;
          setChunksSent(currentIndex);

          // Send audio chunk as binary data via Socket.io
          socket.emit("audio-chunk", event.data, (ack: { received: boolean; chunkIndex: number }) => {
            if (ack?.received) {
              onChunkSent?.(ack.chunkIndex);
            }
          });
        }
      };

      // Handle errors
      mediaRecorder.onerror = (event) => {
        const errorEvent = event as ErrorEvent;
        console.error("[AudioStreaming] MediaRecorder error:", errorEvent.error);
        onError?.(new Error(errorEvent.error?.message || "Recording error"));
        cleanup();
        setRecordingState("idle");
        onStateChange?.("idle");
      };

      // Handle recording stop
      mediaRecorder.onstop = () => {
        // Send final flush of any remaining data
        if (durationIntervalRef.current) {
          clearInterval(durationIntervalRef.current);
          durationIntervalRef.current = null;
        }
      };

      // Emit start-recording event to server
      socket.emit("start-recording", {
        sessionId,
        targetLanguage,
      });

      // Start recording with timeslice for consistent chunk rate
      mediaRecorder.start(CHUNK_TIMESLICE);

      // Start audio level monitoring via Web Audio API
      try {
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
      } catch {
        // Audio level monitoring is optional - recording continues without it
        console.warn("[AudioStreaming] Could not start audio level monitoring");
      }

      // Start duration timer
      startTimeRef.current = Date.now();
      pausedDurationRef.current = 0;
      durationIntervalRef.current = setInterval(() => {
        const elapsed = Math.floor((Date.now() - startTimeRef.current - pausedDurationRef.current) / 1000);
        setDuration(elapsed);
      }, 1000);

      setRecordingState("recording");
      onStateChange?.("recording");
    } catch (err) {
      const error = err as Error;
      console.error("[AudioStreaming] Failed to start recording:", error);
      onError?.(error);
      cleanup();
    }
  }, [isSupported, socket, isConnected, sessionId, targetLanguage, deviceId, recordingState, cleanup, onChunkSent, onStateChange, onError]);

  const pauseRecording = useCallback(() => {
    if (recordingState !== "recording" || !socket?.connected) return;

    // Pause MediaRecorder
    if (mediaRecorderRef.current && mediaRecorderRef.current.state === "recording") {
      mediaRecorderRef.current.pause();
    }

    // Pause audio level monitoring (keep last value displayed)
    if (animationFrameRef.current !== null) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }
    setAudioLevel(0); // Show zero level when paused

    // Pause duration timer
    if (durationIntervalRef.current) {
      clearInterval(durationIntervalRef.current);
      durationIntervalRef.current = null;
    }

    // Emit pause event
    socket.emit("pause-recording", { sessionId });

    // Track pause start time for duration calculation
    startTimeRef.current = Date.now() - startTimeRef.current; // Store elapsed ms temporarily

    setRecordingState("paused");
    onStateChange?.("paused");
  }, [recordingState, socket, sessionId, onStateChange]);

  const resumeRecording = useCallback(() => {
    if (recordingState !== "paused" || !socket?.connected) return;

    // Resume MediaRecorder
    if (mediaRecorderRef.current && mediaRecorderRef.current.state === "paused") {
      mediaRecorderRef.current.resume();
    }

    // Resume audio level monitoring
    if (analyserRef.current && audioContextRef.current && audioContextRef.current.state !== "closed") {
      const analyser = analyserRef.current;
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
    }

    // Resume duration timer
    const elapsedSoFar = startTimeRef.current; // We stored elapsed ms in pauseRecording
    startTimeRef.current = Date.now() - elapsedSoFar;
    durationIntervalRef.current = setInterval(() => {
      const elapsed = Math.floor((Date.now() - startTimeRef.current) / 1000);
      setDuration(elapsed);
    }, 1000);

    // Emit resume event
    socket.emit("resume-recording", { sessionId });

    setRecordingState("recording");
    onStateChange?.("recording");
  }, [recordingState, socket, sessionId, onStateChange]);

  const stopRecording = useCallback(async () => {
    if ((recordingState !== "recording" && recordingState !== "paused") || !socket?.connected) {
      return;
    }

    isStoppingRef.current = true;
    setRecordingState("stopping");
    onStateChange?.("stopping");

    // Stop MediaRecorder (this triggers ondataavailable for any remaining data, then onstop)
    if (mediaRecorderRef.current) {
      if (mediaRecorderRef.current.state === "recording" || mediaRecorderRef.current.state === "paused") {
        mediaRecorderRef.current.stop();
      }
    }

    // Emit stop event to server
    socket.emit("stop-recording", { sessionId });

    // Cleanup resources
    cleanup();

    // Final duration calculation
    const finalDuration = duration;
    setDuration(finalDuration);
    setRecordingState("idle");
    onStateChange?.("idle");

    return;
  }, [recordingState, socket, sessionId, duration, cleanup, onStateChange]);

  return {
    recordingState,
    chunksSent,
    duration,
    isSupported,
    audioLevel,
    startRecording,
    pauseRecording,
    resumeRecording,
    stopRecording,
  };
}
