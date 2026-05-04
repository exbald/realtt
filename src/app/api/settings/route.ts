import { eq } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";

import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { createId } from "@/lib/utils";
import { userSettings } from "@/lib/schema";

// Valid language codes that the settings form supports
const VALID_LANGUAGES = ["en", "es", "fr", "de", "it", "pt", "zh", "ja", "ko", "ar", "ru", "hi"];

// GET /api/settings - Get current user's settings
export async function GET(req: NextRequest) {
  try {
    const session = await auth.api.getSession({ headers: req.headers });
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const [settings] = await db
      .select()
      .from(userSettings)
      .where(eq(userSettings.userId, session.user.id));

    // Return defaults if no settings record exists yet
    if (!settings) {
      return NextResponse.json({
        id: null,
        userId: session.user.id,
        defaultTargetLanguage: "en",
        selectedMicrophoneId: null,
        updatedAt: null,
      });
    }

    return NextResponse.json(settings);
  } catch (error) {
    console.error("Error getting settings:", error);
    return NextResponse.json({ error: "Failed to get settings" }, { status: 500 });
  }
}

// PATCH /api/settings - Update current user's settings (upsert)
export async function PATCH(req: NextRequest) {
  try {
    const session = await auth.api.getSession({ headers: req.headers });
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json();
    const { defaultTargetLanguage, selectedMicrophoneId } = body;

    // Validate defaultTargetLanguage if provided
    if (defaultTargetLanguage !== undefined) {
      if (typeof defaultTargetLanguage !== "string" || defaultTargetLanguage.trim() === "") {
        return NextResponse.json(
          { error: "Target language is required" },
          { status: 400 }
        );
      }
      if (!VALID_LANGUAGES.includes(defaultTargetLanguage)) {
        return NextResponse.json(
          { error: `Invalid language code: ${defaultTargetLanguage}. Must be one of: ${VALID_LANGUAGES.join(", ")}` },
          { status: 400 }
        );
      }
    }

    // Validate selectedMicrophoneId if provided (must be string or null)
    if (selectedMicrophoneId !== undefined && selectedMicrophoneId !== null) {
      if (typeof selectedMicrophoneId !== "string") {
        return NextResponse.json(
          { error: "Invalid microphone selection" },
          { status: 400 }
        );
      }
    }

    // Check if settings already exist for this user
    const [existing] = await db
      .select()
      .from(userSettings)
      .where(eq(userSettings.userId, session.user.id));

    let settings;
    if (existing) {
      // Update existing settings
      const updateData: Record<string, unknown> = {};
      if (defaultTargetLanguage !== undefined) updateData.defaultTargetLanguage = defaultTargetLanguage;
      if (selectedMicrophoneId !== undefined) updateData.selectedMicrophoneId = selectedMicrophoneId;

      const [updated] = await db
        .update(userSettings)
        .set(updateData)
        .where(eq(userSettings.userId, session.user.id))
        .returning();
      settings = updated;
    } else {
      // Create new settings record
      const [created] = await db
        .insert(userSettings)
        .values({
          id: createId(),
          userId: session.user.id,
          defaultTargetLanguage: defaultTargetLanguage || "en",
          selectedMicrophoneId: selectedMicrophoneId || null,
        })
        .returning();
      settings = created;
    }

    return NextResponse.json(settings);
  } catch (error) {
    console.error("Error updating settings:", error);
    return NextResponse.json({ error: "Failed to update settings" }, { status: 500 });
  }
}
