import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { POST } from "./route";
import { NextRequest } from "next/server";

describe("Alertmanager Webhook endpoint (/api/alerts/webhook)", () => {
  it("rejects invalid payload", async () => {
    const req = new NextRequest("http://localhost:3000/api/alerts/webhook", {
      method: "POST",
      body: JSON.stringify({ invalid: true }),
    });
    const res = await POST(req);
    assert.equal(res.status, 400);
  });

  it("processes firing alerts and returns ok", async () => {
    const payload = {
      status: "firing",
      alerts: [
        {
          status: "firing",
          labels: {
            alertname: "TelegramBotLinkRestricted",
            severity: "critical",
            tier: "business-traffic",
            bot: "@caroline_sil_3507_bot",
            group: "OMG",
          },
          annotations: {
            summary: "Vínculo inativo ou restrito detectado",
            description: "Worker Sargatanas reportou link inativo para o bot @caroline_sil_3507_bot",
          },
          startsAt: new Date().toISOString(),
        },
      ],
    };

    const req = new NextRequest("http://localhost:3000/api/alerts/webhook", {
      method: "POST",
      body: JSON.stringify(payload),
    });

    const res = await POST(req);
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.ok, true);
    assert.equal(data.processed, 1);
  });

  it("ignores Watchdog and sentinel alerts with severity none", async () => {
    const payload = {
      status: "firing",
      alerts: [
        {
          status: "firing",
          labels: {
            alertname: "Watchdog",
            component: "prometheus",
            severity: "none",
            tier: "platform",
          },
          annotations: {
            summary: "Prometheus Watchdog / Deadman's Switch is active",
            description: "Sentinel alert verifying alerting pipeline",
          },
          startsAt: new Date().toISOString(),
        },
      ],
    };

    const req = new NextRequest("http://localhost:3000/api/alerts/webhook", {
      method: "POST",
      body: JSON.stringify(payload),
    });

    const res = await POST(req);
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.ok, true);
    assert.equal(data.tasksCreated.length, 0);
  });

  it("processes resolved alerts and closes matching open tasks", async () => {
    const payload = {
      status: "resolved",
      alerts: [
        {
          status: "resolved",
          labels: {
            alertname: "TelegramBotLinkRestricted",
            severity: "critical",
            tier: "business-traffic",
            bot: "@caroline_sil_3507_bot",
          },
          annotations: {
            summary: "Vínculo inativo ou restrito detectado",
            description: "Alert cleared",
          },
          endsAt: new Date().toISOString(),
        },
      ],
    };

    const req = new NextRequest("http://localhost:3000/api/alerts/webhook", {
      method: "POST",
      body: JSON.stringify(payload),
    });

    const res = await POST(req);
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.ok, true);
    assert.equal(data.processed, 1);
    assert.ok(Array.isArray(data.tasksResolved));
  });
});
