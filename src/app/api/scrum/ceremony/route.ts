import { NextRequest, NextResponse } from "next/server";
import { createScrumCeremonyMeeting, type ScrumCeremonyType } from "@/lib/scrum-lifecycle";

const VALID_CEREMONIES = new Set<ScrumCeremonyType>([
  "sprint_planning",
  "daily_standup",
  "mid_sprint_check",
  "sprint_review",
  "sprint_retrospective",
]);

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => null);
    if (!body || typeof body !== "object") {
      return NextResponse.json(
        { error: "invalid_payload", message: "Payload must be a JSON object" },
        { status: 400 },
      );
    }

    const {
      ceremonyType,
      boardSlug = "hot-telegram",
      channelId = "c_general",
      sprintGoal,
      sprintTag,
      plannedItems,
    } = body;

    if (!ceremonyType || !VALID_CEREMONIES.has(ceremonyType)) {
      return NextResponse.json(
        {
          error: "invalid_ceremony_type",
          message: `Ceremony type must be one of: ${Array.from(VALID_CEREMONIES).join(", ")}`,
        },
        { status: 400 },
      );
    }

    const result = await createScrumCeremonyMeeting({
      ceremonyType,
      boardSlug,
      channelId,
      sprintGoal,
      sprintTag,
      plannedItems,
    });

    return NextResponse.json({
      ok: result.success,
      meetingId: result.meetingId,
      ceremonyType: result.ceremonyType,
      sprintTag: result.sprintTag,
      boardSlug: result.boardSlug,
      topic: result.topic,
      totalTurns: result.totalTurns,
      durationSeconds: result.durationSeconds,
      participantsCount: result.participants.length,
      participants: result.participants,
      keyTopics: result.keyTopics,
      conclusions: result.conclusions,
      outcome: result.outcome,
      transcript: result.transcript,
    });
  } catch (err: any) {
    console.error("[scrum-ceremony-api] Error instantiating ceremony meeting:", err);
    return NextResponse.json(
      { error: "internal_error", message: String(err?.message ?? err) },
      { status: 500 },
    );
  }
}
