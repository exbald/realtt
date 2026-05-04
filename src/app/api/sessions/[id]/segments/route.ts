import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { transcriptionSession, transcriptSegment } from "@/lib/schema";
import { createId } from "@/lib/utils";

type RouteContext = { params: Promise<{ id: string }> };

async function assertOwnership(userId: string, sessionId: string): Promise<boolean> {
  const [sess] = await db
    .select({ id: transcriptionSession.id })
    .from(transcriptionSession)
    .where(
      and(
        eq(transcriptionSession.id, sessionId),
        eq(transcriptionSession.userId, userId)
      )
    );
  return !!sess;
}

// POST /api/sessions/[id]/segments - Insert a finalized transcript segment
export async function POST(req: NextRequest, context: RouteContext) {
  try {
    const session = await auth.api.getSession({ headers: req.headers });
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id: sessionId } = await context.params;
    if (!(await assertOwnership(session.user.id, sessionId))) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }

    const body = await req.json();
    const {
      id,
      speakerLabel,
      originalText,
      translatedText,
      startTime,
      endTime,
      isFinal,
    } = body as {
      id?: string;
      speakerLabel?: string;
      originalText?: string;
      translatedText?: string | null;
      startTime?: number;
      endTime?: number;
      isFinal?: boolean;
    };

    if (typeof speakerLabel !== "string" || !speakerLabel.trim()) {
      return NextResponse.json({ error: "speakerLabel required" }, { status: 400 });
    }
    if (typeof originalText !== "string" || !originalText.trim()) {
      return NextResponse.json({ error: "originalText required" }, { status: 400 });
    }

    const [created] = await db
      .insert(transcriptSegment)
      .values({
        id: id || createId(),
        sessionId,
        speakerLabel,
        originalText,
        translatedText: translatedText ?? null,
        startTime: typeof startTime === "number" ? startTime : null,
        endTime: typeof endTime === "number" ? endTime : null,
        isFinal: isFinal ?? true,
      })
      .returning();

    return NextResponse.json(created, { status: 201 });
  } catch (error) {
    console.error("Error inserting segment:", error);
    return NextResponse.json({ error: "Failed to insert segment" }, { status: 500 });
  }
}
