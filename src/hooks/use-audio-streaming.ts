"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import {
  BrowserDeepgramClient,
  DeepgramSegment,
  BrowserDeepgramState,
} from "@/lib/transcription/browser-deepgram";

export type RecordingState = "idle" | "recording" | "paused" | "stopping";

export interface UseAudioStreamingOptions {
  sessionId: string;
  targetLanguage: string;
  deviceId?: string | null;
  /** Called for each transcript segment from Deepgram (interim or final). */
  onSegment?: (segment: DeepgramSegment) => void;
  /** Called when an utterance ends (last_word_end timestamp). */
  onUtteranceEnd?: (lastWordEnd: number) => void;
  /** Called when Deepgram WebSocket state changes. */
  onDeepgramState?: (state: BrowserDeepgramState) => void;
  /** Called on Deepgram socket close. */
  onDeepgramClose?: (code: number, reason: string) => void;
  onChunkSent?: (chunkIndex: number) => void;
  onStateChange?: (state: RecordingState) => void;
  onError?: (error: Error) => void;
}

export interface UseAudioStreamingReturn {
  recordingState: RecordingState;
  chunksSent: number;
  duration: number;
  isSupported: boolean;
  audioLevel: number;
  deepgramState: BrowserDeepgramState;
  speakerCount: number;
  startRecording: () => Promise<void>;
  pauseRecording: () => void;
  resumeRecording: () => void;
  stopRecording: () => Promise<void>;
}

const CHUNK_TIMESLICE = 250;

export function useAudioStreaming({
  sessionId,
  targetLanguage,
  deviceId,
  onSegment,
  onUtteranceEnd,
  onDeepgramState,
  onDeepgramClose,
  onChunkSent,
  onStateChange,
  onError,
}: UseAudioStreamingOptions): UseAudioStreamingReturn {
  const [recordingState, setRecordingState] = useState<RecordingState>("idle");
  const [chunksSent, setChunksSent] = useState(0);
  const [duration, setDuration] = useState(0);
  const [audioLevel, setAudioLevel] = useState(0);
  const [deepgramState, setDeepgramState] = useState<BrowserDeepgramState>("idle");
  const [speakerCount, setSpeakerCount] = useState(0);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const deepgramRef = useRef<BrowserDeepgramClient | null>(null);
  const chunkIndexRef = useRef(0);
  const durationIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startTimeRef = useRef<number>(0);
  const pausedDurationRef = useRef<number>(0);
  const isStoppingRef = useRef(false);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);

  const isSupported =
    typeof window !== "undefined" && typeof MediaRecorder !== "undefined";

  // Keep latest callbacks in refs to avoid re-creating startRecording.
  const onSegmentRef = useRef(onSegment);
  const onUtteranceEndRef = useRef(onUtteranceEnd);
  const onDeepgramStateRef = useRef(onDeepgramState);
  const onDeepgramCloseRef = useRef(onDeepgramClose);
  const onChunkSentRef = useRef(onChunkSent);
  const onStateChangeRef = useRef(onStateChange);
  const onErrorRef = useRef(onError);

  useEffect(() => {
    onSegmentRef.current = onSegment;
    onUtteranceEndRef.current = onUtteranceEnd;
    onDeepgramStateRef.current = onDeepgramState;
    onDeepgramCloseRef.current = onDeepgramClose;
    onChunkSentRef.current = onChunkSent;
    onStateChangeRef.current = onStateChange;
    onErrorRef.current = onError;
  }, [
    onSegment,
    onUtteranceEnd,
    onDeepgramState,
    onDeepgramClose,
    onChunkSent,
    onStateChange,
    onError,
  ]);

  const cleanup = useCallback(() => {
    if (durationIntervalRef.current) {
      clearInterval(durationIntervalRef.current);
      durationIntervalRef.current = null;
    }

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

    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
      try { mediaRecorderRef.current.stop(); } catch { /* ignore */ }
    }
    mediaRecorderRef.current = null;

    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }

    if (deepgramRef.current) {
      deepgramRef.current.close().catch(() => { /* ignore */ });
      deepgramRef.current = null;
    }

    chunkIndexRef.current = 0;
    isStoppingRef.current = false;
  }, []);

  useEffect(() => {
    return () => { cleanup(); };
  }, [cleanup]);

  const startRecording = useCallback(async () => {
    if (!isSupported) {
      onErrorRef.current?.(new Error("MediaRecorder is not supported in this browser"));
      return;
    }
    if (recordingState !== "idle" && recordingState !== "paused") return;

    try {
      // 1. Acquire microphone
      const constraints: MediaStreamConstraints = {
        audio: deviceId && deviceId !== "default"
          ? { deviceId: { exact: deviceId } }
          : true,
      };
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      streamRef.current = stream;

      // 2. Open Deepgram connection
      setSpeakerCount(0);
      const deepgram = new BrowserDeepgramClient(
        {
          onSegment: (seg) => {
            setSpeakerCount(deepgramRef.current?.speakerCount ?? 0);
            onSegmentRef.current?.(seg);
          },
          onUtteranceEnd: (lastEnd) => onUtteranceEndRef.current?.(lastEnd),
          onStateChange: (state) => {
            setDeepgramState(state);
            onDeepgramStateRef.current?.(state);
          },
          onError: (err) => onErrorRef.current?.(err),
          onClose: (code, reason) => onDeepgramCloseRef.current?.(code, reason),
        },
        { language: "en" }
      );
      deepgramRef.current = deepgram;
      await deepgram.connect();

      // 3. Configure MediaRecorder
      const mimeTypes = [
        "audio/webm;codecs=opus",
        "audio/webm",
        "audio/ogg;codecs=opus",
        "audio/mp4",
      ];
      let selectedMimeType = "";
      for (const m of mimeTypes) {
        if (MediaRecorder.isTypeSupported(m)) { selectedMimeType = m; break; }
      }

      const opts: MediaRecorderOptions = { audioBitsPerSecond: 16000 };
      if (selectedMimeType) opts.mimeType = selectedMimeType;
      const mediaRecorder = new MediaRecorder(stream, opts);
      mediaRecorderRef.current = mediaRecorder;

      chunkIndexRef.current = 0;
      setChunksSent(0);
      setDuration(0);

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0 && !isStoppingRef.current) {
          chunkIndexRef.current += 1;
          const idx = chunkIndexRef.current;
          setChunksSent(idx);
          deepgramRef.current?.send(event.data);
          onChunkSentRef.current?.(idx);
        }
      };

      mediaRecorder.onerror = (event) => {
        const errorEvent = event as ErrorEvent;
        console.error("[AudioStreaming] MediaRecorder error:", errorEvent.error);
        onErrorRef.current?.(new Error(errorEvent.error?.message || "Recording error"));
        cleanup();
        setRecordingState("idle");
        onStateChangeRef.current?.("idle");
      };

      mediaRecorder.onstop = () => {
        if (durationIntervalRef.current) {
          clearInterval(durationIntervalRef.current);
          durationIntervalRef.current = null;
        }
      };

      mediaRecorder.start(CHUNK_TIMESLICE);

      // 4. Audio-level meter
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
          setAudioLevel(Math.min(1, rms / 128));
          animationFrameRef.current = requestAnimationFrame(updateLevel);
        };
        animationFrameRef.current = requestAnimationFrame(updateLevel);
      } catch {
        console.warn("[AudioStreaming] Could not start audio level monitoring");
      }

      // 5. Duration timer
      startTimeRef.current = Date.now();
      pausedDurationRef.current = 0;
      durationIntervalRef.current = setInterval(() => {
        const elapsed = Math.floor(
          (Date.now() - startTimeRef.current - pausedDurationRef.current) / 1000
        );
        setDuration(elapsed);
      }, 1000);

      setRecordingState("recording");
      onStateChangeRef.current?.("recording");
    } catch (err) {
      const error = err as Error;
      console.error("[AudioStreaming] Failed to start recording:", error);
      onErrorRef.current?.(error);
      cleanup();
    }
  // sessionId/targetLanguage included for potential future use; depending on them
  // is harmless because we don't pin a stale closure to state.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isSupported, deviceId, recordingState, cleanup, sessionId, targetLanguage]);

  const pauseRecording = useCallback(() => {
    if (recordingState !== "recording") return;

    if (mediaRecorderRef.current && mediaRecorderRef.current.state === "recording") {
      mediaRecorderRef.current.pause();
    }

    if (animationFrameRef.current !== null) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }
    setAudioLevel(0);

    if (durationIntervalRef.current) {
      clearInterval(durationIntervalRef.current);
      durationIntervalRef.current = null;
    }

    startTimeRef.current = Date.now() - startTimeRef.current;

    setRecordingState("paused");
    onStateChangeRef.current?.("paused");
  }, [recordingState]);

  const resumeRecording = useCallback(() => {
    if (recordingState !== "paused") return;

    if (mediaRecorderRef.current && mediaRecorderRef.current.state === "paused") {
      mediaRecorderRef.current.resume();
    }

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
        setAudioLevel(Math.min(1, rms / 128));
        animationFrameRef.current = requestAnimationFrame(updateLevel);
      };
      animationFrameRef.current = requestAnimationFrame(updateLevel);
    }

    const elapsedSoFar = startTimeRef.current;
    startTimeRef.current = Date.now() - elapsedSoFar;
    durationIntervalRef.current = setInterval(() => {
      const elapsed = Math.floor((Date.now() - startTimeRef.current) / 1000);
      setDuration(elapsed);
    }, 1000);

    setRecordingState("recording");
    onStateChangeRef.current?.("recording");
  }, [recordingState]);

  const stopRecording = useCallback(async () => {
    if (recordingState !== "recording" && recordingState !== "paused") return;

    isStoppingRef.current = true;
    setRecordingState("stopping");
    onStateChangeRef.current?.("stopping");

    if (mediaRecorderRef.current) {
      const s = mediaRecorderRef.current.state;
      if (s === "recording" || s === "paused") {
        try { mediaRecorderRef.current.stop(); } catch { /* ignore */ }
      }
    }

    // Close Deepgram cleanly so any final segments arrive.
    if (deepgramRef.current) {
      try { await deepgramRef.current.close(); } catch { /* ignore */ }
    }

    cleanup();
    setRecordingState("idle");
    onStateChangeRef.current?.("idle");
  }, [recordingState, cleanup]);

  return {
    recordingState,
    chunksSent,
    duration,
    isSupported,
    audioLevel,
    deepgramState,
    speakerCount,
    startRecording,
    pauseRecording,
    resumeRecording,
    stopRecording,
  };
}
