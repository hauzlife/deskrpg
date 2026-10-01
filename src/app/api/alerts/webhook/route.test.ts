import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { POST } from "./route";
import { NextRequest } from "next/server";
import { getSqliteDatabase } from "@/lib/autonomous-lifecycle-hooks";
import {
  isAlertManagerWebhookPayload,
  resolveBoardSlug,
  validateNetworkSecurity,
  validateWebhookAuth,
} from "@/lib/alertmanager-webhook";

describe("Alertmanager Webhook endpoint (/api/alerts/webhook)", () => {
  it("validates the Alertmanager envelope and alert field types", () => {
    assert.equal(
      isAlertManagerWebhookPayload({
        status: "firing",
        alerts: [{ status: "firing", labels: {}, annotations: {} }],
      }),
      true,
    );
    assert.equal(
      isAlertManagerWebhookPayload({
        status: "firing",
        alerts: [{ status: "pending", labels: {}, annotations: {} }],
      }),
      false,
    );
    assert.equal(
      isAlertManagerWebhookPayload({
        status: "firing",
        alerts: [{ status: "firing", labels: { severity: 10 }, annotations: {} }],
      }),
      false,
    );
  });

  it("routes infrastructure alerts to infra-ops and rejects unsafe board labels", () => {
    assert.equal(resolveBoardSlug({ tier: "critical-infra", alertname: "NodeDown" }), "infra-ops");
    assert.equal(resolveBoardSlug({ project: "../../outside", tier: "traffic" }), "hot-telegram");
  });

  it("enforces the configured webhook secret", () => {
    const previous = process.env.ALERTMANAGER_WEBHOOK_SECRET;
    process.env.ALERTMANAGER_WEBHOOK_SECRET = "test-alertmanager-secret";
    try {
      const unauthorized = new NextRequest("http://localhost/api/alerts/webhook");
      const authorized = new NextRequest("http://localhost/api/alerts/webhook", {
        headers: { authorization: "Bearer test-alertmanager-secret" },
      });
      assert.equal(validateWebhookAuth(unauthorized).authorized, false);
      assert.equal(validateWebhookAuth(authorized).authorized, true);
    } finally {
      if (previous === undefined) delete process.env.ALERTMANAGER_WEBHOOK_SECRET;
      else process.env.ALERTMANAGER_WEBHOOK_SECRET = previous;
    }
  });

  it("enforces the configured source IP allowlist", () => {
    const previous = process.env.ALERTMANAGER_ALLOWED_IPS;
    process.env.ALERTMANAGER_ALLOWED_IPS = "10.0.0.7";
    try {
      const denied = new NextRequest("https://kanban.example/api/alerts/webhook", {
        headers: { "x-forwarded-for": "203.0.113.8" },
      });
      const allowed = new NextRequest("https://kanban.example/api/alerts/webhook", {
        headers: { "x-forwarded-for": "10.0.0.7" },
      });
      assert.equal(validateNetworkSecurity(denied).allowed, false);
      assert.equal(validateNetworkSecurity(allowed).allowed, true);
    } finally {
      if (previous === undefined) delete process.env.ALERTMANAGER_ALLOWED_IPS;
      else process.env.ALERTMANAGER_ALLOWED_IPS = previous;
    }
  });

  it("creates a P0 card with extracted fields for a critical infrastructure alert", async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "deskrpg-alert-route-"));
    const databasePath = path.join(tempDir, "kanban.db");
    const database = getSqliteDatabase(databasePath);
    database.exec(`
      CREATE TABLE tasks (
        id TEXT PRIMARY KEY NOT NULL,
        title TEXT NOT NULL,
        body TEXT NOT NULL,
        assignee TEXT NOT NULL,
        status TEXT NOT NULL,
        priority INTEGER NOT NULL,
        created_by TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        workspace_kind TEXT NOT NULL
      );
    `);

    try {
      const req = new NextRequest("http://localhost:3000/api/alerts/webhook", {
        method: "POST",
        headers: { "x-test-database-path": databasePath },
        body: JSON.stringify({
          version: "4",
          status: "firing",
          receiver: "deskrpg-critical",
          alerts: [
            {
              status: "firing",
              labels: {
                alertname: "NodeDown",
                severity: "critical",
                tier: "infra",
                instance: "node-1",
              },
              annotations: {
                summary: "Production node unavailable",
                description: "The production node stopped responding to probes.",
              },
            },
          ],
        }),
      });

      const response = await POST(req);
      assert.equal(response.status, 200);
      const result = await response.json();
      assert.equal(result.tasksCreated.length, 1);
      assert.equal(result.tasksCreated[0].board, "infra-ops");

      const task = database.prepare("SELECT title, body, priority FROM tasks LIMIT 1").get() as {
        title: string;
        body: string;
        priority: number;
      };
      assert.equal(task.priority, 10);
      assert.match(task.title, /Production node unavailable/);
      assert.match(task.body, /NodeDown/);
      assert.match(task.body, /The production node stopped responding/);
      assert.match(task.body, /P0/);
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

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
            description:
              "Worker Sargatanas reportou link inativo para o bot @caroline_sil_3507_bot",
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
