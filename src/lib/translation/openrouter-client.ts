import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { streamText } from "ai";
import { eq } from "drizzle-orm";
import { db } from "../db";
import { transcriptSegment } from "../schema";

/**
 * Callback types for translation streaming.
 */
export interface TranslationCallbacks {
  /** Called with each chunk of translated text as it streams in */
  onChunk: (segmentId: string, text: string, isDone: boolean) => void;
  /** Called when translation completes with the full text */
  onComplete: (segmentId: string, fullText: string) => void;
  /** Called if translation fails */
  onError: (segmentId: string, error: Error) => void;
}

/**
 * Translate a transcript segment using OpenRouter with streaming.
 * Streams translated text chunks via callbacks and updates the database on completion.
 */
export async function translateSegment(
  segmentId: string,
  originalText: string,
  targetLanguage: string,
  callbacks: TranslationCallbacks
): Promise<void> {
  const apiKey = process.env.OPENROUTER_API_KEY;

  if (!apiKey || !apiKey.trim()) {
    // No API key - skip translation gracefully
    callbacks.onError(segmentId, new Error("OpenRouter API key not configured"));
    return;
  }

  if (!originalText.trim()) {
    // Empty text - nothing to translate
    callbacks.onError(segmentId, new Error("Empty text, nothing to translate"));
    return;
  }

  const openrouter = createOpenRouter({ apiKey });
  const model = process.env.OPENROUTER_MODEL || "openai/gpt-5-mini";

  try {
    const result = streamText({
      model: openrouter(model),
      messages: [
        {
          role: "system",
          content: `You are a professional translator. Translate the following text to ${targetLanguage}. Output ONLY the translated text, nothing else. Do not add explanations, notes, or quotation marks around the translation. Preserve the original meaning and tone.`,
        },
        {
          role: "user",
          content: originalText,
        },
      ],
      maxOutputTokens: 1000,
      temperature: 0.3,
    });

    let fullText = "";

    for await (const chunk of result.textStream) {
      fullText += chunk;
      callbacks.onChunk(segmentId, fullText, false);
    }

    // Translation complete - update database and notify
    const trimmedText = fullText.trim();
    if (trimmedText) {
      try {
        await db
          .update(transcriptSegment)
          .set({ translatedText: trimmedText })
          .where(eq(transcriptSegment.id, segmentId));
      } catch (dbErr) {
        console.error("[Translation] Error updating database:", dbErr);
      }
    }

    callbacks.onComplete(segmentId, trimmedText);
  } catch (err) {
    console.error("[Translation] Error translating segment:", err);
    callbacks.onError(
      segmentId,
      err instanceof Error ? err : new Error(String(err))
    );
  }
}
