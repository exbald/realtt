import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { transcriptionSession, transcriptSegment } from "@/lib/schema";

type RouteContext = {
  params: Promise<{ id: string }>;
};

/** Escape special Markdown characters in plain text content */
function escapeMarkdown(text: string): string {
  return text
    .replace(/\\/g, "\\\\")
    .replace(/\*/g, "\\*")
    .replace(/_/g, "\\_")
    .replace(/`/g, "\\`")
    .replace(/#/g, "\\#")
    .replace(/\[/g, "\\[")
    .replace(/\]/g, "\\]");
}

/** Format seconds into a human-readable duration string */
function formatDuration(totalSeconds: number): string {
  const hours = Math.floor(totalSeconds / 3600);
  const mins = Math.floor((totalSeconds % 3600) / 60);
  const secs = totalSeconds % 60;
  if (hours > 0) {
    return `${hours}h ${mins}m ${secs}s`;
  }
  return `${mins}m ${secs}s`;
}

/** Format seconds into M:SS or H:MM:SS timestamp */
function formatTime(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  if (hours > 0) {
    return `${hours}:${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
  }
  return `${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
}

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

    // Get transcript segments (only final segments for export)
    const allSegments = await db
      .select()
      .from(transcriptSegment)
      .where(eq(transcriptSegment.sessionId, id))
      .orderBy(transcriptSegment.createdAt);

    // Only export final segments
    const segments = allSegments.filter((seg) => seg.isFinal);

    // Build Markdown content
    const date = sess.createdAt.toISOString().split("T")[0];
    const durationStr = formatDuration(sess.durationSeconds ?? 0);

    let markdown = `# ${escapeMarkdown(sess.title)}\n\n`;
    markdown += `## Metadata\n\n`;
    markdown += `| Field | Value |\n`;
    markdown += `|-------|-------|\n`;
    markdown += `| **Date** | ${date} |\n`;
    markdown += `| **Duration** | ${durationStr} |\n`;
    markdown += `| **Source Language** | ${escapeMarkdown(sess.sourceLanguage ?? "auto-detected")} |\n`;
    markdown += `| **Target Language** | ${escapeMarkdown(sess.targetLanguage)} |\n`;
    markdown += `| **Speakers** | ${sess.speakerCount ?? 0} |\n`;
    markdown += `| **Segments** | ${segments.length} |\n\n`;
    markdown += `## Transcript\n\n`;

    if (segments.length === 0) {
      markdown += `*No transcript segments recorded.*\n`;
    } else {
      for (const seg of segments) {
        const startStr = seg.startTime != null ? formatTime(seg.startTime) : "--:--";
        const endStr = seg.endTime != null ? formatTime(seg.endTime) : "--:--";
        markdown += `### ${escapeMarkdown(seg.speakerLabel)} [${startStr} – ${endStr}]\n\n`;
        markdown += `${escapeMarkdown(seg.originalText)}\n\n`;
        if (seg.translatedText) {
          markdown += `*${escapeMarkdown(seg.translatedText)}*\n\n`;
        }
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
