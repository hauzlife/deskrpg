import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { getSqliteDatabase, insertTaskSafely } from "@/lib/autonomous-lifecycle-hooks";
import {
  buildAlertFingerprint,
  buildSentryIssueFingerprint,
  sentryIssueMarker,
  POST,
} from "@/lib/alertmanager-webhook";
import { NextRequest } from "next/server";

test("Sentry-style issue fingerprint groups by alertname, board, and tier across multiple workers", () => {
  const alert1 = {
    status: "firing" as const,
    labels: {
      alertname: "BotDeliveryErrorRateExceeded",
      tier: "traffic",
      bot: "aggregate_dispatch",
      instance: "187.77.141.106",
    },
    annotations: { summary: "Delivery error rate exceeded 10%" },
  };
  const alert2 = {
    status: "firing" as const,
    labels: {
      alertname: "BotDeliveryErrorRateExceeded",
      tier: "traffic",
      bot: "hot-worker-instagram",
      instance: "187.77.141.107",
    },
    annotations: { summary: "Delivery error rate exceeded 10% on instagram" },
  };

  const sentryFp1 = buildSentryIssueFingerprint(alert1, "hot-telegram");
  const sentryFp2 = buildSentryIssueFingerprint(alert2, "hot-telegram");

  // Under Sentry rollup rules, both alerts group under the SAME issue fingerprint!
  assert.equal(sentryFp1, sentryFp2);
});

test("Alertmanager webhook creates issue in triage assigned to PM and accumulates bursts like Sentry", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "deskrpg-sentry-rollup-"));
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
      completed_at INTEGER,
      result TEXT,
      workspace_kind TEXT NOT NULL DEFAULT 'scratch'
    );
    CREATE TABLE task_comments (
      task_id TEXT NOT NULL,
      author TEXT NOT NULL,
      body TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE task_events (
      task_id TEXT NOT NULL,
      run_id TEXT,
      kind TEXT NOT NULL,
      payload TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
  `);

  const payloadFirst = {
    version: "4",
    status: "firing",
    alerts: [
      {
        status: "firing",
        labels: {
          alertname: "BotDeliveryErrorRateExceeded",
          tier: "traffic",
          bot: "aggregate_dispatch",
          instance: "187.77.141.106",
          board: "test-alerts",
          severity: "critical",
        },
        annotations: {
          summary: "Bot Delivery Error Rate Exceeded 10% on aggregate_dispatch",
        },
        startsAt: "2026-10-04T13:49:11.000Z",
      },
    ],
  };

  const req1 = new NextRequest("http://localhost:3000/api/webhooks/alertmanager", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-test-database-path": databasePath,
    },
    body: JSON.stringify(payloadFirst),
  });

  const res1 = await POST(req1);
  const data1 = (await res1.json()) as { ok: boolean; tasksCreated: Array<{ taskId: string }> };
  assert.equal(data1.ok, true);
  assert.equal(data1.tasksCreated.length, 1);
  const firstTaskId = data1.tasksCreated[0].taskId;

  // 1. Verify that first card was created in 'triage' and assigned to 'product-manager'
  const rowFirst = database.prepare("SELECT * FROM tasks WHERE id = ?").get(firstTaskId) as {
    status: string;
    assignee: string;
    body: string;
  };
  assert.equal(rowFirst.status, "triage");
  assert.equal(rowFirst.assignee, "product-manager");
  assert.ok(rowFirst.body.includes("<!-- occurrences: 1 -->"));
  assert.ok(rowFirst.body.includes("GATE DE TRIAGEM ATIVO"));
  assert.ok(rowFirst.body.includes("Critérios de Aceite Verificáveis (BDD Given-When-Then)"));

  // 2. Second alert burst from a different worker (hot-worker-instagram)
  const payloadSecond = {
    version: "4",
    status: "firing",
    alerts: [
      {
        status: "firing",
        labels: {
          alertname: "BotDeliveryErrorRateExceeded",
          tier: "traffic",
          bot: "hot-worker-instagram",
          instance: "187.77.141.107",
          board: "test-alerts",
          severity: "critical",
        },
        annotations: {
          summary: "Bot Delivery Error Rate Exceeded 10% on hot-worker-instagram",
        },
        startsAt: "2026-10-04T13:49:52.000Z",
      },
    ],
  };

  const req2 = new NextRequest("http://localhost:3000/api/webhooks/alertmanager", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-test-database-path": databasePath,
    },
    body: JSON.stringify(payloadSecond),
  });

  const res2 = await POST(req2);
  const data2 = (await res2.json()) as { ok: boolean; tasksUpdated: Array<{ taskId: string }> };
  assert.equal(data2.ok, true);
  assert.equal(data2.tasksUpdated.length, 1);
  assert.equal(data2.tasksUpdated[0].taskId, firstTaskId);

  // 3. Verify that NO second task was created; occurrences accumulated to 2
  const activeCount = database
    .prepare("SELECT count(*) as count FROM tasks WHERE status NOT IN ('done', 'archived')")
    .get() as { count: number };
  assert.equal(activeCount.count, 1);

  const rowUpdated = database.prepare("SELECT * FROM tasks WHERE id = ?").get(firstTaskId) as {
    body: string;
    status: string;
  };
  assert.equal(rowUpdated.status, "triage");
  assert.ok(rowUpdated.body.includes("<!-- occurrences: 2 -->"));
  assert.ok(rowUpdated.body.includes("hot-worker-instagram"));

  // Verify rollup comment in task_comments
  const comments = database
    .prepare("SELECT * FROM task_comments WHERE task_id = ?")
    .all(firstTaskId) as Array<{ author: string; body: string }>;
  assert.equal(comments.length, 1);
  assert.equal(comments[0].author, "sentry-local-sentinel");
  assert.ok(comments[0].body.includes("OCORRÊNCIA #2"));

  // 4. Resolve the alert
  const payloadResolved = {
    version: "4",
    status: "resolved",
    alerts: [
      {
        status: "resolved",
        labels: {
          alertname: "BotDeliveryErrorRateExceeded",
          tier: "traffic",
          board: "test-alerts",
        },
        annotations: {
          summary: "Bot Delivery Error Rate Exceeded 10%",
        },
        endsAt: "2026-10-04T13:54:00.000Z",
      },
    ],
  };

  const req3 = new NextRequest("http://localhost:3000/api/webhooks/alertmanager", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-test-database-path": databasePath,
    },
    body: JSON.stringify(payloadResolved),
  });

  const res3 = await POST(req3);
  const data3 = (await res3.json()) as { ok: boolean; tasksResolved: Array<{ taskId: string }> };
  assert.equal(data3.ok, true);
  assert.equal(data3.tasksResolved.length, 1);
  assert.equal(data3.tasksResolved[0].taskId, firstTaskId);

  const rowFinal = database.prepare("SELECT * FROM tasks WHERE id = ?").get(firstTaskId) as {
    status: string;
    result: string;
  };
  assert.equal(rowFinal.status, "done");
  assert.equal(rowFinal.result, "auto-resolved by telemetry monitor");
});
