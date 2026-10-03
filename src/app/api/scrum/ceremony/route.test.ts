import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { POST } from "./route";
import { NextRequest } from "next/server";

describe("Scrum Ceremony API Endpoint (/api/scrum/ceremony)", () => {
  it("rejects invalid payload with 400", async () => {
    const req = new NextRequest("http://localhost:3000/api/scrum/ceremony", {
      method: "POST",
      body: "not-json",
    });
    const res = await POST(req);
    assert.equal(res.status, 400);
  });

  it("rejects unknown ceremony type with 400", async () => {
    const req = new NextRequest("http://localhost:3000/api/scrum/ceremony", {
      method: "POST",
      body: JSON.stringify({ ceremonyType: "party_time" }),
    });
    const res = await POST(req);
    assert.equal(res.status, 400);
    const data = await res.json();
    assert.equal(data.error, "invalid_ceremony_type");
  });

  it("instantiates a valid sprint_planning ceremony meeting", async () => {
    const req = new NextRequest("http://localhost:3000/api/scrum/ceremony", {
      method: "POST",
      body: JSON.stringify({
        ceremonyType: "sprint_planning",
        boardSlug: "hot-telegram",
        sprintGoal: "Lançar nova rota de pagamento",
      }),
    });
    const res = await POST(req);
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.ok, true);
    assert.match(data.meetingId, /^m_/);
    assert.equal(data.ceremonyType, "sprint_planning");
    assert.ok(data.participants.length >= 4);
    assert.ok(data.totalTurns >= 5);
    assert.ok(data.conclusions.includes("Sprint Goal selado"));
    assert.ok(data.transcript.includes("[product-manager]"));
  });

  it("instantiates a valid daily_standup ceremony meeting", async () => {
    const req = new NextRequest("http://localhost:3000/api/scrum/ceremony", {
      method: "POST",
      body: JSON.stringify({
        ceremonyType: "daily_standup",
        boardSlug: "hot-telegram",
      }),
    });
    const res = await POST(req);
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.ok, true);
    assert.equal(data.ceremonyType, "daily_standup");
    assert.ok(data.transcript.includes("[chief-of-staff]"));
  });
});
