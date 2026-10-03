import { NextRequest, NextResponse } from "next/server";
import {
  handleGitHubPullRequestEvent,
  handleGitHubCheckSuiteEvent,
  handleGitHubReviewEvent,
  handleGitHubIssueCommentEvent,
} from "@/lib/github-lifecycle-hooks";

export async function POST(req: NextRequest) {
  try {
    const eventType = req.headers.get("x-github-event") || "";

    // Handle Ping event from GitHub Webhook settings
    if (eventType === "ping") {
      return NextResponse.json({ ok: true, message: "pong", timestamp: new Date().toISOString() });
    }

    const payload = await req.json();

    if (!payload || typeof payload !== "object") {
      return NextResponse.json(
        { error: "invalid_payload", message: "Payload must be a JSON object" },
        { status: 400 },
      );
    }

    let result;

    switch (eventType) {
      case "pull_request": {
        result = await handleGitHubPullRequestEvent({ payload });
        break;
      }
      case "check_suite":
      case "check_run": {
        // Normalize check_run to check_suite structure if needed
        const checkSuitePayload = payload.check_suite
          ? payload
          : {
              ...payload,
              check_suite: payload.check_run?.check_suite || {
                status: payload.check_run?.status,
                conclusion: payload.check_run?.conclusion,
                head_branch:
                  payload.check_run?.check_suite?.head_branch || payload.check_run?.head_sha,
                head_sha: payload.check_run?.head_sha,
                pull_requests: payload.check_run?.pull_requests,
              },
            };
        result = await handleGitHubCheckSuiteEvent({ payload: checkSuitePayload });
        break;
      }
      case "pull_request_review": {
        result = await handleGitHubReviewEvent({ payload });
        break;
      }
      case "issue_comment": {
        result = await handleGitHubIssueCommentEvent({ payload });
        break;
      }
      default: {
        return NextResponse.json(
          {
            ok: true,
            action: "ignored_unsupported_event",
            eventType,
            message: `Event type '${eventType}' is not tracked by the 5-Gate pipeline.`,
          },
          { status: 200 },
        );
      }
    }

    return NextResponse.json({
      ok: result?.success ?? true,
      ...result,
    });
  } catch (err: any) {
    console.error("[github-webhook] Error processing GitHub webhook:", err);
    return NextResponse.json(
      {
        error: "internal_error",
        message: String(err?.message ?? err),
      },
      { status: 500 },
    );
  }
}
