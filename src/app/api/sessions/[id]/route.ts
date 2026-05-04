import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { transcriptionSession, transcriptSegment } from "@/lib/schema";

type RouteContext = {
  params: Promise<{ id: string }>;
};

// GET /api/sessions/[id] - Get session with transcript segments
export async function GET(req: NextRequest, context: RouteContext) {
  try {
    const session = await auth.api.getSession({ headers: req.headers });
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await context.params;

    // Get the session (scoped to user)
    const [sess] = await db
      .select()
      .from(transcriptionSession)
      .where(
        and(
          eq(transcriptionSession.id, id),
          eq(transcriptionSession.userId, session.user.id)
        )
      );

    if (!sess) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }

    // Get transcript segments for this session
    const segments = await db
      .select()
      .from(transcriptSegment)
      .where(eq(transcriptSegment.sessionId, id))
      .orderBy(transcriptSegment.createdAt);

    return NextResponse.json({ ...sess, segments });
  } catch (error) {
    console.error("Error getting session:", error);
    return NextResponse.json({ error: "Failed to get session" }, { status: 500 });
  }
}

// DELETE /api/sessions/[id] - Delete a session and its segments
export async function DELETE(req: NextRequest, context: RouteContext) {
  try {
    const session = await auth.api.getSession({ headers: req.headers });
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await context.params;

    // Verify ownership
    const [sess] = await db
      .select()
      .from(transcriptionSession)
      .where(
        and(
          eq(transcriptionSession.id, id),
          eq(transcriptionSession.userId, session.user.id)
        )
      );

    if (!sess) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }

    // Delete (cascade will handle segments)
    await db
      .delete(transcriptionSession)
      .where(eq(transcriptionSession.id, id));

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error deleting session:", error);
    return NextResponse.json({ error: "Failed to delete session" }, { status: 500 });
  }
}

// PATCH /api/sessions/[id] - Update session (status, duration, etc.)
export async function PATCH(req: NextRequest, context: RouteContext) {
  try {
    const session = await auth.api.getSession({ headers: req.headers });
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await context.params;

    // Verify ownership
    const [sess] = await db
      .select()
      .from(transcriptionSession)
      .where(
        and(
          eq(transcriptionSession.id, id),
          eq(transcriptionSession.userId, session.user.id)
        )
      );

    if (!sess) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }

    const body = await req.json();
    const { status, durationSeconds, speakerCount } = body;

    // Build update object with only provided fields
    const updates: Record<string, unknown> = {};
    if (status !== undefined) {
      const validStatuses = ["created", "recording", "paused", "completed"];
      if (!validStatuses.includes(status)) {
        return NextResponse.json(
          { error: "Invalid status. Must be: created, recording, paused, or completed" },
          { status: 400 }
        );
      }
      updates.status = status;
    }
    if (durationSeconds !== undefined) {
      if (typeof durationSeconds !== "number" || durationSeconds < 0) {
        return NextResponse.json(
          { error: "durationSeconds must be a non-negative number" },
          { status: 400 }
        );
      }
      updates.durationSeconds = Math.round(durationSeconds);
    }
    if (speakerCount !== undefined) {
      if (typeof speakerCount !== "number" || speakerCount < 0) {
        return NextResponse.json(
          { error: "speakerCount must be a non-negative number" },
          { status: 400 }
        );
      }
      updates.speakerCount = Math.round(speakerCount);
    }

    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: "No valid fields to update" }, { status: 400 });
    }

    const [updated] = await db
      .update(transcriptionSession)
      .set(updates)
      .where(eq(transcriptionSession.id, id))
      .returning();

    return NextResponse.json(updated);
  } catch (error) {
    console.error("Error updating session:", error);
    return NextResponse.json({ error: "Failed to update session" }, { status: 500 });
  }
}
