import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { getSqliteDatabase, insertTaskSafely } from "@/lib/autonomous-lifecycle-hooks";
import { buildAlertFingerprint } from "@/lib/alertmanager-webhook";

function marker(fingerprint: string): string {
  return `<!-- alertmanager-fingerprint:${fingerprint} -->`;
}

test("Alertmanager retries update one active card while distinct targets open independently", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "deskrpg-alert-dedup-"));
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
  try {
    const firstAlert = {
      status: "firing" as const,
      labels: {
        alertname: "EndpointUnavailable",
        tier: "business-traffic",
        endpoint: "/checkout",
        instance: "api-1",
        window: "5m",
      },
      annotations: { summary: "Checkout indisponível" },
      startsAt: "2026-09-30T22:00:00.000Z",
    };
    const equivalentRetry = {
      ...firstAlert,
      annotations: { summary: "Checkout indisponível (repetido)" },
      startsAt: "2026-09-30T22:01:00.000Z",
    };
    const distinctAlert = {
      ...firstAlert,
      labels: { ...firstAlert.labels, endpoint: "/health" },
    };

    const firstFingerprint = buildAlertFingerprint(firstAlert);
    assert.equal(buildAlertFingerprint(equivalentRetry), firstFingerprint);
    const distinctFingerprint = buildAlertFingerprint(distinctAlert);
    assert.notEqual(distinctFingerprint, firstFingerprint);

    const first = insertTaskSafely("test-alerts", {
      title: "[INCIDENT-CRITICAL][HOT-TELEGRAM] Endpoint indisponível",
      body: `${marker(firstFingerprint)}\nfirst event`,
      assignee: "backend-engineer",
      priority: 10,
      parentId: "root-incident",
      databasePath,
      dedupKey: marker(firstFingerprint),
      updateComment: "duplicate update",
    });
    const retry = insertTaskSafely("test-alerts", {
      title: "[INCIDENT-CRITICAL][HOT-TELEGRAM] Endpoint indisponível",
      body: `${marker(firstFingerprint)}\nretry event`,
      assignee: "backend-engineer",
      priority: 10,
      parentId: "root-incident",
      databasePath,
      dedupKey: marker(firstFingerprint),
      updateComment: "duplicate update",
    });
    const distinct = insertTaskSafely("test-alerts", {
      title: "[INCIDENT-CRITICAL][HOT-TELEGRAM] Endpoint indisponível",
      body: `${marker(distinctFingerprint)}\ndistinct event`,
      assignee: "backend-engineer",
      priority: 10,
      parentId: "root-incident",
      databasePath,
      dedupKey: marker(distinctFingerprint),
      updateComment: "distinct update",
    });

    assert.equal(first.success, true);
    assert.equal(retry.reason, "updated_existing");
    assert.equal(retry.taskId, first.taskId);
    assert.equal(distinct.success, true);
    assert.notEqual(distinct.taskId, first.taskId);

    const verificationDb = getSqliteDatabase(databasePath, { readonly: true });
    const activeTasks = verificationDb
      .prepare("SELECT count(*) AS count FROM tasks WHERE status NOT IN ('done', 'archived')")
      .get() as { count: number };
    const updateEvents = verificationDb
      .prepare("SELECT count(*) AS count FROM task_events WHERE kind = 'updated'")
      .get() as { count: number };
    const comments = verificationDb
      .prepare("SELECT count(*) AS count FROM task_comments")
      .get() as { count: number };
    assert.equal(activeTasks.count, 2);
    assert.equal(updateEvents.count, 1);
    assert.equal(comments.count, 1);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
