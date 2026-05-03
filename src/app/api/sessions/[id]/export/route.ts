import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { transcriptionSession, transcriptSegment } from "@/lib/schema";

type RouteContext = {
  params: Promise<{ id: string }>;
};

// GET /api/sessions/[id]/export - Export session transcript as Markdown
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

    // Get transcript segments
    const segments = await db
      .select()
      .from(transcriptSegment)
      .where(eq(transcriptSegment.sessionId, id))
      .orderBy(transcriptSegment.createdAt);

    // Build Markdown content
    const date = sess.createdAt.toISOString().split("T")[0];
    const durationMin = Math.floor((sess.durationSeconds ?? 0) / 60);
    const durationSec = (sess.durationSeconds ?? 0) % 60;
    const durationStr = `${durationMin}m ${durationSec}s`;

    let markdown = `# ${sess.title}\n\n`;
    markdown += `## Metadata\n\n`;
    markdown += `- **Date:** ${date}\n`;
    markdown += `- **Duration:** ${durationStr}\n`;
    markdown += `- **Source Language:** ${sess.sourceLanguage ?? "auto-detected"}\n`;
    markdown += `- **Target Language:** ${sess.targetLanguage}\n`;
    markdown += `- **Speakers:** ${sess.speakerCount ?? 0}\n\n`;
    markdown += `## Transcript\n\n`;

    if (segments.length === 0) {
      markdown += `*No transcript segments recorded.*\n`;
    } else {
      for (const seg of segments) {
        const startStr = seg.startTime != null ? formatTime(seg.startTime) : "??:??";
        const endStr = seg.endTime != null ? formatTime(seg.endTime) : "??:??";
        markdown += `**${seg.speakerLabel}** [${startStr} - ${endStr}]:\n`;
        markdown += `> ${seg.originalText}\n`;
        if (seg.translatedText) {
          markdown += `> *${seg.translatedText}*\n`;
        }
        markdown += `\n`;
      }
    }

    // Generate descriptive filename
    const safeTitle = sess.title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "");
    const filename = `${safeTitle}_${date}.md`;

    return new NextResponse(markdown, {
      status: 200,
      headers: {
        "Content-Type": "text/markdown; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  } catch (error) {
    console.error("Error exporting session:", error);
    return NextResponse.json({ error: "Failed to export session" }, { status: 500 });
  }
}

function formatTime(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
}
