import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const KEY_TTL_SECONDS = 60;

export async function POST(req: NextRequest) {
  const session = await auth.api.getSession({ headers: req.headers });
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const apiKey = process.env.DEEPGRAM_API_KEY;
  const projectId = process.env.DEEPGRAM_PROJECT_ID;

  if (!apiKey || !projectId) {
    return NextResponse.json(
      { error: "Deepgram is not configured. Set DEEPGRAM_API_KEY and DEEPGRAM_PROJECT_ID." },
      { status: 500 }
    );
  }

  try {
    const res = await fetch(
      `https://api.deepgram.com/v1/projects/${projectId}/keys`,
      {
        method: "POST",
        headers: {
          Authorization: `Token ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          comment: `realtt browser key for user ${session.user.id}`,
          scopes: ["usage:write"],
          time_to_live_in_seconds: KEY_TTL_SECONDS,
        }),
      }
    );

    if (!res.ok) {
      const text = await res.text();
      console.error("[Deepgram] Failed to mint temp key:", res.status, text);
      return NextResponse.json(
        { error: "Failed to provision transcription key" },
        { status: 502 }
      );
    }

    const data = (await res.json()) as { key: string; expiration_date?: string };
    return NextResponse.json({
      key: data.key,
      expiresAt: data.expiration_date ?? null,
      ttlSeconds: KEY_TTL_SECONDS,
    });
  } catch (err) {
    console.error("[Deepgram] Token mint error:", err);
    return NextResponse.json(
      { error: "Failed to provision transcription key" },
      { status: 500 }
    );
  }
}
