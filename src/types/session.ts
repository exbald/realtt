/**
 * Core type definitions for Real Team Translation.
 *
 * These types describe the data models used throughout the application.
 * They correspond to the database schema defined in src/lib/schema.ts
 * and the API endpoints documented in app_spec.txt.
 */

// Supported target languages for translation
export const SUPPORTED_LANGUAGES = [
  { code: "en", name: "English" },
  { code: "es", name: "Spanish" },
  { code: "fr", name: "French" },
  { code: "de", name: "German" },
  { code: "pt", name: "Portuguese" },
  { code: "ar", name: "Arabic" },
  { code: "zh", name: "Mandarin" },
  { code: "ja", name: "Japanese" },
  { code: "ru", name: "Russian" },
  { code: "hi", name: "Hindi" },
  { code: "ko", name: "Korean" },
  { code: "it", name: "Italian" },
] as const;

export type LanguageCode = (typeof SUPPORTED_LANGUAGES)[number]["code"];

// Session status lifecycle: created -> recording -> paused -> recording -> completed
export type SessionStatus = "created" | "recording" | "paused" | "completed";

// Transcription session (maps to session table in DB)
export interface TranscriptionSession {
  id: string;
  userId: string;
  title: string;
  status: SessionStatus;
  sourceLanguage: string;
  targetLanguage: LanguageCode;
  durationSeconds: number;
  speakerCount: number;
  createdAt: Date;
  updatedAt: Date;
}

// Transcript segment (maps to transcript_segment table in DB)
export interface TranscriptSegment {
  id: string;
  sessionId: string;
  speakerLabel: string;
  originalText: string;
  translatedText: string | null;
  startTime: number | null;
  endTime: number | null;
  isFinal: boolean;
  createdAt: Date;
  updatedAt: Date;
}

// User settings (maps to user_settings table in DB)
export interface UserSettings {
  id: string;
  userId: string;
  defaultTargetLanguage: LanguageCode;
  selectedMicrophoneId: string | null;
  updatedAt: Date;
}

// Speaker color assignments (6 distinct, colorblind-friendly colors)
export const SPEAKER_COLORS = [
  "oklch(0.65 0.2 250)", // Blue
  "oklch(0.65 0.2 150)", // Green
  "oklch(0.7 0.18 60)", // Orange
  "oklch(0.6 0.2 300)", // Purple
  "oklch(0.7 0.18 350)", // Pink
  "oklch(0.65 0.15 180)", // Teal
] as const;
