import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { getSqliteDatabase } from './autonomous-lifecycle-hooks';
import {
  generateSprintTag,
  sealSprintGoal,
  auditSprintBurndown,
  generateSprintReviewSITREP,
  generateSprintRetrospective,
} from './scrum-lifecycle';

function createMockKanbanDb(): { tmpDir: string; dbPath: string } {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'scrum-lifecycle-test-'));
  const dbPath = path.join(tmpDir, 'test.db');
  const sqlite = getSqliteDatabase(dbPath);

  sqlite.exec(`
    CREATE TABLE tasks (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      body TEXT,
      assignee TEXT,
      status TEXT NOT NULL,
      priority INTEGER DEFAULT 0,
      created_by TEXT,
      created_at INTEGER NOT NULL,
      completed_at INTEGER,
      workspace_kind TEXT NOT NULL DEFAULT 'scratch',
      workspace_path TEXT,
      project_id TEXT,
      block_kind TEXT,
      last_failure_error TEXT,
      model_override TEXT,
      provider_override TEXT
    );
    CREATE TABLE task_links (
      parent_id TEXT NOT NULL,
      child_id TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      PRIMARY KEY (parent_id, child_id)
    );
    CREATE TABLE task_comments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      task_id TEXT NOT NULL,
      author TEXT,
      body TEXT,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE task_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      task_id TEXT NOT NULL,
      run_id TEXT,
      kind TEXT NOT NULL,
      payload TEXT,
      created_at INTEGER NOT NULL
    );
  `);

  return { tmpDir, dbPath };
}

test('generateSprintTag returns valid ISO sprint tag', () => {
  const tag = generateSprintTag(new Date('2026-10-01T12:00:00Z'));
  assert.match(tag, /^sprint-\d{2}-2026$/);
});

test('sealSprintGoal binds goal, tags committed tasks, and freezes sprint backlog', async () => {
  const { tmpDir, dbPath } = createMockKanbanDb();
  const sqlite = getSqliteDatabase(dbPath);
  const now = Math.floor(Date.now() / 1000);

  // Insert candidate tasks
  sqlite.exec(`
    INSERT INTO tasks (id, title, body, assignee, status, created_at)
    VALUES
      ('t_s1', 'Refatorar webhook de PIX', 'Implementar idempotência', 'backend-engineer', 'ready', ${now}),
      ('t_s2', 'Criar teste E2E de compra', 'Validar fluxo de ponta a ponta', 'qa-engineer', 'todo', ${now}),
      ('t_s3', 'Painel de conversão', 'Métricas de checkout', 'frontend-engineer', 'ready', ${now});
  `);

  const goal = 'Lançar checkout de PIX v2 com reconciliação 100% íntegra';
  const sprintTag = 'sprint-40-2026';

  const res = await sealSprintGoal({
    boardSlug: 'hot-telegram',
    goal,
    sprintTag,
    databasePath: dbPath,
  });

  assert.equal(res.success, true);
  assert.equal(res.sprintTag, sprintTag);
  assert.equal(res.committedTasksCount, 3);

  const t1 = sqlite.prepare('SELECT body FROM tasks WHERE id = ?').get('t_s1') as any;
  assert.ok(t1.body.includes('sprint-40-2026'));
  assert.ok(t1.body.includes(goal));

  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('auditSprintBurndown calculates throughput and identifies risks', async () => {
  const { tmpDir, dbPath } = createMockKanbanDb();
  const sqlite = getSqliteDatabase(dbPath);
  const now = Math.floor(Date.now() / 1000);
  const sprintTag = 'sprint-40-2026';

  // 1 done, 1 review, 3 blocked
  sqlite.exec(`
    INSERT INTO tasks (id, title, body, status, created_at, block_kind)
    VALUES
      ('t_b1', 'Task Concluída', 'corpo <!-- sprint-40-2026 -->', 'done', ${now}, NULL),
      ('t_b2', 'Task em Review', 'corpo <!-- sprint-40-2026 -->', 'review', ${now}, NULL),
      ('t_b3', 'Task Bloqueada 1', 'corpo <!-- sprint-40-2026 -->', 'blocked', ${now}, 'conflict'),
      ('t_b4', 'Task Bloqueada 2', 'corpo <!-- sprint-40-2026 -->', 'blocked', ${now}, 'capability'),
      ('t_b5', 'Task Bloqueada 3', 'corpo <!-- sprint-40-2026 -->', 'blocked', ${now}, 'needs_input');
  `);

  const burndown = await auditSprintBurndown({
    boardSlug: 'hot-telegram',
    sprintTag,
    databasePath: dbPath,
  });

  assert.equal(burndown.totalCommitted, 5);
  assert.equal(burndown.doneCount, 1);
  assert.equal(burndown.reviewCount, 1);
  assert.equal(burndown.blockedCount, 3);
  assert.equal(burndown.health, 'critical');
  assert.ok(burndown.recommendations.some((r) => r.includes('HK-08 BlockerTriageHook')));

  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('generateSprintReviewSITREP compiles merged increments and DoD validation', async () => {
  const { tmpDir, dbPath } = createMockKanbanDb();
  const sqlite = getSqliteDatabase(dbPath);
  const now = Math.floor(Date.now() / 1000);
  const sprintTag = 'sprint-40-2026';

  sqlite.exec(`
    INSERT INTO tasks (id, title, body, status, created_at, completed_at)
    VALUES
      ('t_r1', 'Webhook PIX v2', 'PR #42 <!-- sprint-40-2026 -->', 'done', ${now}, ${now + 100}),
      ('t_r2', 'Dashboard de Vendas', 'PR #48 <!-- sprint-40-2026 -->', 'done', ${now}, ${now + 200});
  `);

  const sitrep = await generateSprintReviewSITREP({
    boardSlug: 'hot-telegram',
    sprintTag,
    databasePath: dbPath,
  });

  assert.equal(sitrep.totalCompleted, 2);
  assert.ok(sitrep.sitrepSummary.includes('SITREP de Encerramento de Sprint'));
  assert.ok(sitrep.sitrepSummary.includes('PR #42'));
  assert.ok(sitrep.sitrepSummary.includes('PR #48'));

  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('generateSprintRetrospective extracts HK-08 auto-remediations and CI telemetry', async () => {
  const { tmpDir, dbPath } = createMockKanbanDb();
  const sqlite = getSqliteDatabase(dbPath);
  const now = Math.floor(Date.now() / 1000);
  const sprintTag = 'sprint-40-2026';

  sqlite.exec(`
    INSERT INTO tasks (id, title, body, status, created_at)
    VALUES ('t_retro_1', 'Task com histórico', 'corpo <!-- sprint-40-2026 -->', 'done', ${now});

    INSERT INTO task_comments (task_id, author, body, created_at)
    VALUES
      ('t_retro_1', 'blocker-triage-hook', '[BlockerTriageHook] Workspace efêmero auto-remediado para worktree.', ${now}),
      ('t_retro_1', 'github-ci', '🚨 [GATE 2 — CI FALHOU] Testes quebraram no commit abc.', ${now}),
      ('t_retro_1', 'github-webhook', '🚨 [GATE 1 — CONFLITO DE MERGE] Detectado conflito de branch.', ${now});
  `);

  const retro = await generateSprintRetrospective({
    boardSlug: 'hot-telegram',
    sprintTag,
    databasePath: dbPath,
  });

  assert.equal(retro.totalBlockersEncountered, 3);
  assert.equal(retro.autoRemediatedCount, 1);
  assert.equal(retro.ciFailuresCount, 1);
  assert.ok(retro.aarReport.includes('After Action Review'));
  assert.ok(retro.aarReport.includes('Auto-remediação de workspaces HK-08 recuperou 1 incidentes'));

  fs.rmSync(tmpDir, { recursive: true, force: true });
});
