import { NextRequest, NextResponse } from "next/server";
import { desc, eq } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { transcriptionSession } from "@/lib/schema";
import { createId } from "@/lib/utils";

// GET /api/sessions - List user's sessions sorted by date desc
export async function GET(req: NextRequest) {
  try {
    const session = await auth.api.getSession({ headers: req.headers });
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const sessions = await db
      .select()
      .from(transcriptionSession)
      .where(eq(transcriptionSession.userId, session.user.id))
      .orderBy(desc(transcriptionSession.createdAt));

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

    const newSession = await db
      .insert(transcriptionSession)
      .values({
        id: createId(),
        userId: session.user.id,
        title: title || "Untitled Session",
        targetLanguage,
        status: "recording",
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
