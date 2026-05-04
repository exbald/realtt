import { NextRequest, NextResponse } from "next/server";
import { count, desc, eq } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { transcriptionSession } from "@/lib/schema";
import { createId } from "@/lib/utils";

// GET /api/sessions - List user's sessions sorted by date desc
// Supports optional pagination: ?limit=N&offset=M
// When no params: returns all sessions (backward compatible)
export async function GET(req: NextRequest) {
  try {
    const session = await auth.api.getSession({ headers: req.headers });
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const url = new URL(req.url);
    const limitParam = url.searchParams.get("limit");
    const offsetParam = url.searchParams.get("offset");

    const userId = session.user.id;

    // If pagination params provided, return paginated response with total count
    if (limitParam !== null || offsetParam !== null) {
      const limit = limitParam ? Math.min(Math.max(parseInt(limitParam, 10) || 50, 1), 200) : 50;
      const offset = offsetParam ? Math.max(parseInt(offsetParam, 10) || 0, 0) : 0;

      const [sessions, totalResult] = await Promise.all([
        db
          .select()
          .from(transcriptionSession)
          .where(eq(transcriptionSession.userId, userId))
          .orderBy(desc(transcriptionSession.createdAt))
          .limit(limit)
          .offset(offset),
        db
          .select({ total: count() })
          .from(transcriptionSession)
          .where(eq(transcriptionSession.userId, userId)),
      ]);

      return NextResponse.json({
        sessions,
        total: totalResult[0]?.total ?? 0,
        limit,
        offset,
      });
    }

    // Default: return all sessions (backward compatible, capped at 500 for safety)
    const sessions = await db
      .select()
      .from(transcriptionSession)
      .where(eq(transcriptionSession.userId, userId))
      .orderBy(desc(transcriptionSession.createdAt))
      .limit(500);

    return NextResponse.json(sessions);
  } catch (error) {
    console.error("Error listing sessions:", error);
    return NextResponse.json({ error: "Failed to list sessions" }, { status: 500 });
  }
}

// POST /api/sessions - Create a new transcription session
export async function POST(req: NextRequest) {
  try {
    const session = await auth.api.getSession({ headers: req.headers });
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json();
    const { title, targetLanguage } = body;

    if (!targetLanguage) {
      return NextResponse.json(
        { error: "targetLanguage is required" },
        { status: 400 }
      );
    }

    if (title && title.length > 200) {
      return NextResponse.json(
        { error: "Title must be 200 characters or less" },
        { status: 400 }
      );
    }

    const newSession = await db
      .insert(transcriptionSession)
      .values({
        id: createId(),
        userId: session.user.id,
        title: title || "Untitled Session",
        targetLanguage,
        status: "completed",
        sourceLanguage: "auto-detected",
        durationSeconds: 0,
        speakerCount: 0,
      })
      .returning();

    return NextResponse.json(newSession[0], { status: 201 });
  } catch (error) {
    console.error("Error creating session:", error);
    return NextResponse.json({ error: "Failed to create session" }, { status: 500 });
  }
}
