import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { transcriptionSession, transcriptSegment } from "@/lib/schema";

type RouteContext = { params: Promise<{ id: string; segmentId: string }> };

// PATCH /api/sessions/[id]/segments/[segmentId] - Update a segment (e.g. attach translation)
export async function PATCH(req: NextRequest, context: RouteContext) {
  try {
    const session = await auth.api.getSession({ headers: req.headers });
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id: sessionId, segmentId } = await context.params;

    // Verify ownership of the session
    const [sess] = await db
      .select({ id: transcriptionSession.id })
      .from(transcriptionSession)
      .where(
        and(
          eq(transcriptionSession.id, sessionId),
          eq(transcriptionSession.userId, session.user.id)
        )
      );
    if (!sess) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }

    const body = await req.json();
    const { translatedText } = body as { translatedText?: string | null };

    const updates: Record<string, unknown> = {};
    if (translatedText !== undefined) {
      if (translatedText !== null && typeof translatedText !== "string") {
        return NextResponse.json(
          { error: "translatedText must be a string or null" },
          { status: 400 }
        );
      }
      updates.translatedText = translatedText;
    }

    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: "No fields to update" }, { status: 400 });
    }

    const [updated] = await db
      .update(transcriptSegment)
      .set(updates)
      .where(
        and(
          eq(transcriptSegment.id, segmentId),
          eq(transcriptSegment.sessionId, sessionId)
        )
      )
      .returning();

    if (!updated) {
      return NextResponse.json({ error: "Segment not found" }, { status: 404 });
    }
    return NextResponse.json(updated);
  } catch (error) {
    console.error("Error updating segment:", error);
    return NextResponse.json({ error: "Failed to update segment" }, { status: 500 });
  }
}
