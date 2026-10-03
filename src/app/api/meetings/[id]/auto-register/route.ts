import { NextRequest, NextResponse } from "next/server";
import { autonomousRegisterMeetingOutcome } from "@/lib/scrum-lifecycle";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const body = (await req.json().catch(() => ({}))) as Record<string, any>;
    const { boardSlug, channelId = "c_general", approverProfile = "product-manager" } = body;

    const result = await autonomousRegisterMeetingOutcome({
      meetingId: id,
      boardSlug,
      channelId,
      approverProfile,
    });

    return NextResponse.json({
      ok: result.success,
      ...result,
    });
  } catch (err: any) {
    console.error("[auto-register-route] Error in autonomous meeting registration:", err);
    return NextResponse.json(
      {
        error: "internal_error",
        message: String(err?.message ?? err),
      },
      { status: 500 },
    );
  }
}
