import { NextRequest } from "next/server";
import { and, eq } from "drizzle-orm";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { streamText } from "ai";

import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { transcriptSegment, transcriptionSession } from "@/lib/schema";

export const runtime = "nodejs";
export const maxDuration = 60;

interface TranslateBody {
  sessionId?: string;
  segmentId?: string;
  originalText?: string;
  targetLanguage?: string;
}

function jsonError(message: string, status: number): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { "content-type": "application/json" },
  });
}

export async function POST(req: NextRequest): Promise<Response> {
  const session = await auth.api.getSession({ headers: req.headers });
  if (!session?.user?.id) return jsonError("Unauthorized", 401);

  let body: TranslateBody;
  try {
    body = (await req.json()) as TranslateBody;
  } catch {
    return jsonError("Invalid JSON", 400);
  }

  const { sessionId, segmentId, originalText, targetLanguage } = body;
  if (!sessionId || !segmentId || !originalText || !targetLanguage) {
    return jsonError(
      "sessionId, segmentId, originalText, and targetLanguage are required",
      400
    );
  }

  // Verify session ownership
  const [sess] = await db
    .select({ id: transcriptionSession.id })
    .from(transcriptionSession)
    .where(
      and(
        eq(transcriptionSession.id, sessionId),
        eq(transcriptionSession.userId, session.user.id)
      )
    );
  if (!sess) return jsonError("Session not found", 404);

  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey || !apiKey.trim()) {
    return jsonError("Translation service is not configured", 500);
  }

  const openrouter = createOpenRouter({ apiKey });
  const model = process.env.OPENROUTER_MODEL || "openai/gpt-5-mini";

  const result = streamText({
    model: openrouter(model),
    messages: [
      {
        role: "system",
        content: `You are a professional translator. Translate the following text to ${targetLanguage}. Output ONLY the translated text, nothing else. Do not add explanations, notes, or quotation marks around the translation. Preserve the original meaning and tone.`,
      },
      { role: "user", content: originalText },
    ],
    maxOutputTokens: 1000,
    temperature: 0.3,
  });

  // Stream tokens to the client; persist the final translation server-side.
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let full = "";
      try {
        for await (const chunk of result.textStream) {
          full += chunk;
          controller.enqueue(encoder.encode(chunk));
        }
        const trimmed = full.trim();
        if (trimmed) {
          try {
            await db
              .update(transcriptSegment)
              .set({ translatedText: trimmed })
              .where(
                and(
                  eq(transcriptSegment.id, segmentId),
                  eq(transcriptSegment.sessionId, sessionId)
                )
              );
          } catch (err) {
            console.error("[Translate] DB update failed:", err);
          }
        }
        controller.close();
      } catch (err) {
        console.error("[Translate] Stream error:", err);
        controller.error(err);
      }
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}
