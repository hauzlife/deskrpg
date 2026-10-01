import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { getSqliteDatabase } from './autonomous-lifecycle-hooks';
import {
  handleGitHubPullRequestEvent,
  handleGitHubCheckSuiteEvent,
  handleGitHubReviewEvent,
  handleGitHubIssueCommentEvent,
  resolveBoardFromGitHubRepo,
  enforceReviewGateForPrTasks,
} from './github-lifecycle-hooks';

function createMockKanbanDb(): { tmpDir: string; dbPath: string } {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gh-hooks-test-'));
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

test('resolveBoardFromGitHubRepo maps canonical repositories accurately', () => {
  assert.equal(resolveBoardFromGitHubRepo('hauzlife/hot-telegram'), 'hot-telegram');
  assert.equal(resolveBoardFromGitHubRepo('hauzlife/mystelia'), 'mystelia');
  assert.equal(resolveBoardFromGitHubRepo('hauzlife/bloopu-backend'), 'bloopu');
  assert.equal(resolveBoardFromGitHubRepo('hauzlife/social'), 'social');
  assert.equal(resolveBoardFromGitHubRepo('hauzlife/unknown-repo', 'feature para mystelia'), 'mystelia');
});

test('Gate 1 (Clean PR): opened PR without conflict dispatches to review with reviewer assigned', async () => {
  const { tmpDir, dbPath } = createMockKanbanDb();

  const payload: any = {
    action: 'opened',
    number: 42,
    pull_request: {
      number: 42,
      title: 'Adicionar gateway de pagamento PIX v2',
      body: 'Implementa liquidação automática de webhooks PIX.',
      html_url: 'https://github.com/hauzlife/hot-telegram/pull/42',
      state: 'open',
      mergeable: true,
      head: {
        ref: 'feat/pix-v2',
        sha: 'a1b2c3d',
        repo: { full_name: 'hauzlife/hot-telegram', name: 'hot-telegram' },
      },
      base: { ref: 'main' },
      user: { login: 'sargatanas-dev' },
    },
    repository: {
      full_name: 'hauzlife/hot-telegram',
      name: 'hot-telegram',
    },
  };

  const res = await handleGitHubPullRequestEvent({
    payload,
    databasePath: dbPath,
    bypassDispatchSpawn: true,
  });

  assert.equal(res.success, true);
  assert.equal(res.action, 'review_dispatched');
  assert.equal(res.prNumber, 42);

  const sqlite = getSqliteDatabase(dbPath);
  const task = sqlite.prepare('SELECT * FROM tasks WHERE id = ?').get(res.taskId) as any;
  assert.equal(task.status, 'review');
  assert.equal(task.assignee, 'reviewer');
  assert.equal(task.block_kind, null);

  const comments = sqlite.prepare('SELECT * FROM task_comments WHERE task_id = ?').all(res.taskId) as any[];
  assert.ok(comments.some((c) => c.body.includes('[GATE 1 — MERGEABLE OK]')));

  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('Gate 1 (Conflict): opened PR with merge conflict locks task to blocked (kind: conflict)', async () => {
  const { tmpDir, dbPath } = createMockKanbanDb();

  const payload: any = {
    action: 'opened',
    number: 43,
    pull_request: {
      number: 43,
      title: 'Refatorar middleware de autenticação',
      body: 'Refatora auth.',
      html_url: 'https://github.com/hauzlife/hot-telegram/pull/43',
      state: 'open',
      mergeable: false, // CONFLICT!
      head: {
        ref: 'feat/auth-conflict',
        sha: 'x9y8z7',
        repo: { full_name: 'hauzlife/hot-telegram', name: 'hot-telegram' },
      },
      base: { ref: 'main' },
      user: { login: 'dev-aluno' },
    },
    repository: {
      full_name: 'hauzlife/hot-telegram',
      name: 'hot-telegram',
    },
  };

  const res = await handleGitHubPullRequestEvent({
    payload,
    databasePath: dbPath,
    bypassDispatchSpawn: true,
  });

  assert.equal(res.success, true);
  assert.equal(res.action, 'conflict_blocked');

  const sqlite = getSqliteDatabase(dbPath);
  const task = sqlite.prepare('SELECT * FROM tasks WHERE id = ?').get(res.taskId) as any;
  assert.equal(task.status, 'blocked');
  assert.equal(task.block_kind, 'conflict');

  const comments = sqlite.prepare('SELECT * FROM task_comments WHERE task_id = ?').all(res.taskId) as any[];
  assert.ok(comments.some((c) => c.body.includes('CONFLITO DE MERGE')));

  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('Gate 2 (CI Failure & Success): check_suite blocks on failure and summons QA on success', async () => {
  const { tmpDir, dbPath } = createMockKanbanDb();

  // First open PR 50
  const prPayload: any = {
    action: 'opened',
    number: 50,
    pull_request: {
      number: 50,
      title: 'Nova rota de telemetria',
      body: 'Adiciona telemetria.',
      html_url: 'https://github.com/hauzlife/hot-telegram/pull/50',
      state: 'open',
      mergeable: true,
      head: { ref: 'feat/telemetry', sha: 'c1c2c3', repo: { full_name: 'hauzlife/hot-telegram', name: 'hot-telegram' } },
      base: { ref: 'main' },
      user: { login: 'dev-worker' },
    },
    repository: { full_name: 'hauzlife/hot-telegram', name: 'hot-telegram' },
  };

  const prRes = await handleGitHubPullRequestEvent({
    payload: prPayload,
    databasePath: dbPath,
    bypassDispatchSpawn: true,
  });

  // Test CI Failure
  const failPayload: any = {
    action: 'completed',
    check_suite: {
      status: 'completed',
      conclusion: 'failure',
      head_branch: 'feat/telemetry',
      head_sha: 'c1c2c3',
      pull_requests: [{ number: 50 }],
    },
    repository: { full_name: 'hauzlife/hot-telegram', name: 'hot-telegram' },
  };

  const failRes = await handleGitHubCheckSuiteEvent({
    payload: failPayload,
    databasePath: dbPath,
    bypassDispatchSpawn: true,
  });

  assert.equal(failRes.action, 'ci_failed_blocked');
  const sqlite = getSqliteDatabase(dbPath);
  const taskAfterFail = sqlite.prepare('SELECT * FROM tasks WHERE id = ?').get(prRes.taskId) as any;
  assert.equal(taskAfterFail.status, 'blocked');
  assert.equal(taskAfterFail.block_kind, 'capability');

  // Now Test CI Success
  const passPayload: any = {
    action: 'completed',
    check_suite: {
      status: 'completed',
      conclusion: 'success',
      head_branch: 'feat/telemetry',
      head_sha: 'c1c2c3',
      pull_requests: [{ number: 50 }],
    },
    repository: { full_name: 'hauzlife/hot-telegram', name: 'hot-telegram' },
  };

  const passRes = await handleGitHubCheckSuiteEvent({
    payload: passPayload,
    databasePath: dbPath,
    bypassDispatchSpawn: true,
  });

  assert.equal(passRes.action, 'ci_passed_qa_summoned');
  const comments = sqlite.prepare('SELECT * FROM task_comments WHERE task_id = ?').all(prRes.taskId) as any[];
  assert.ok(comments.some((c) => c.body.includes('[GATE 2 — CI 100% VERDE]')));

  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('Gates 3, 4 and 5 (Review, QA and PM Sign-Off): full pipeline clears all gates for merge', async () => {
  const { tmpDir, dbPath } = createMockKanbanDb();

  // 1. Open PR 60
  const prPayload: any = {
    action: 'opened',
    number: 60,
    pull_request: {
      number: 60,
      title: 'Otimização de checkout',
      body: 'Checkout rápido.',
      html_url: 'https://github.com/hauzlife/hot-telegram/pull/60',
      state: 'open',
      mergeable: true,
      head: { ref: 'feat/fast-checkout', sha: 'f1f2f3', repo: { full_name: 'hauzlife/hot-telegram', name: 'hot-telegram' } },
      base: { ref: 'main' },
      user: { login: 'dev-lead' },
    },
    repository: { full_name: 'hauzlife/hot-telegram', name: 'hot-telegram' },
  };

  const prRes = await handleGitHubPullRequestEvent({
    payload: prPayload,
    databasePath: dbPath,
    bypassDispatchSpawn: true,
  });

  // 2. Reviewer approves (Gate 3)
  const reviewPayload: any = {
    action: 'submitted',
    review: {
      id: 101,
      user: { login: 'reviewer-agent' },
      body: 'Código limpo, AST validada e padrões REST respeitados.',
      state: 'approved',
      html_url: 'https://github.com/hauzlife/hot-telegram/pull/60#pullrequestreview-101',
    },
    pull_request: {
      number: 60,
      title: 'Otimização de checkout',
      html_url: 'https://github.com/hauzlife/hot-telegram/pull/60',
      head: { ref: 'feat/fast-checkout' },
    },
    repository: { full_name: 'hauzlife/hot-telegram', name: 'hot-telegram' },
  };

  const reviewRes = await handleGitHubReviewEvent({
    payload: reviewPayload,
    databasePath: dbPath,
  });
  assert.equal(reviewRes.action, 'review_approved_pm_summoned');

  // 3. QA signs off (Gate 4)
  const qaPayload: any = {
    action: 'created',
    issue: {
      number: 60,
      title: 'Otimização de checkout',
      html_url: 'https://github.com/hauzlife/hot-telegram/pull/60',
      pull_request: { url: 'https://api.github.com/repos/hauzlife/hot-telegram/pulls/60' },
    },
    comment: {
      id: 201,
      user: { login: 'qa-engineer' },
      body: '[QA-APROVADO] Cenários de teste homologados em staging: 10/10 transações concluídas sem regressão.',
      html_url: 'https://github.com/hauzlife/hot-telegram/pull/60#issuecomment-201',
    },
    repository: { full_name: 'hauzlife/hot-telegram', name: 'hot-telegram' },
  };

  const qaRes = await handleGitHubIssueCommentEvent({
    payload: qaPayload,
    databasePath: dbPath,
  });
  assert.equal(qaRes.action, 'qa_signoff_recorded');

  // 4. PM approves (Gate 5)
  const pmPayload: any = {
    action: 'created',
    issue: {
      number: 60,
      title: 'Otimização de checkout',
      html_url: 'https://github.com/hauzlife/hot-telegram/pull/60',
      pull_request: { url: 'https://api.github.com/repos/hauzlife/hot-telegram/pulls/60' },
    },
    comment: {
      id: 202,
      user: { login: 'product-manager' },
      body: '[APROVADO] Critérios de negócio validados. Autorizado para merge.',
      html_url: 'https://github.com/hauzlife/hot-telegram/pull/60#issuecomment-202',
    },
    repository: { full_name: 'hauzlife/hot-telegram', name: 'hot-telegram' },
  };

  const pmRes = await handleGitHubIssueCommentEvent({
    payload: pmPayload,
    databasePath: dbPath,
    executeMerge: false,
  });

  assert.equal(pmRes.action, 'pm_approved_merge_authorized');
  assert.equal(pmRes.allGatesPassed, true);

  // 5. PR Merged -> task becomes done
  const mergedPayload: any = {
    action: 'closed',
    number: 60,
    pull_request: {
      number: 60,
      title: 'Otimização de checkout',
      html_url: 'https://github.com/hauzlife/hot-telegram/pull/60',
      state: 'closed',
      merged: true,
      head: { ref: 'feat/fast-checkout', repo: { full_name: 'hauzlife/hot-telegram' } },
      base: { ref: 'main' },
      user: { login: 'dev-lead' },
    },
    repository: { full_name: 'hauzlife/hot-telegram', name: 'hot-telegram' },
  };

  const mergeRes = await handleGitHubPullRequestEvent({
    payload: mergedPayload,
    databasePath: dbPath,
    bypassDispatchSpawn: true,
  });

  assert.equal(mergeRes.action, 'pr_merged_done');
  const sqlite = getSqliteDatabase(dbPath);
  const taskDone = sqlite.prepare('SELECT * FROM tasks WHERE id = ?').get(prRes.taskId) as any;
  assert.equal(taskDone.status, 'done');

  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('enforceReviewGateForPrTasks strictly holds card in review until PR is legitimately merged', async () => {
  const { tmpDir, dbPath } = createMockKanbanDb();
  const sqlite = getSqliteDatabase(dbPath);

  // 1. Create a task bound to an open, unmerged PR
  const taskId = 't_pr_gate_test';
  const now = Math.floor(Date.now() / 1000);
  sqlite.exec(`
    INSERT INTO tasks (id, title, body, assignee, status, priority, created_by, created_at, workspace_kind)
    VALUES (
      '${taskId}',
      '[PR #77] Nova rota de webhook de afiliados',
      'Card vinculado ao PR #77 <!-- dedupKey: gh-pr-hauzlife/hot-telegram-77 -->',
      'reviewer',
      'review',
      8,
      'github-webhook',
      ${now},
      'worktree'
    );
  `);

  // 2. An agent attempts to prematurely move the card to done
  sqlite.prepare("UPDATE tasks SET status = 'done', completed_at = ? WHERE id = ?").run(now, taskId);

  // 3. The enforceReviewGateForPrTasks interceptor runs
  const gateResult = await enforceReviewGateForPrTasks({
    boardSlug: 'hot-telegram',
    taskId,
    databasePath: dbPath,
  });

  // Verify that it blocked transition to done and forced status back to 'review'
  assert.equal(gateResult.preventedDone, true);
  assert.equal(gateResult.reason, 'pr_not_merged_remains_in_review');
  assert.equal(gateResult.prNumber, 77);

  const taskAfterInterceptor = sqlite.prepare('SELECT status, completed_at FROM tasks WHERE id = ?').get(taskId) as any;
  assert.equal(taskAfterInterceptor.status, 'review');
  assert.equal(taskAfterInterceptor.completed_at, null);

  const comments = sqlite.prepare('SELECT body FROM task_comments WHERE task_id = ?').all(taskId) as any[];
  assert.ok(comments.some((c) => c.body.includes('GATEWAY DE PROTEÇÃO — PR REVIEW GATE')));

  // 4. Now simulate legitimate PR merge confirmation
  sqlite.prepare('INSERT INTO task_comments (task_id, author, body, created_at) VALUES (?, ?, ?, ?)').run(
    taskId,
    'github-webhook',
    '🎉 [GitHub Hook] PR #77 mesclado com sucesso na branch base! Tarefa concluída.',
    now + 10
  );

  // 5. Interceptor runs again after merge
  const gateAfterMerge = await enforceReviewGateForPrTasks({
    boardSlug: 'hot-telegram',
    taskId,
    databasePath: dbPath,
  });

  // After merge, it does NOT prevent done!
  assert.equal(gateAfterMerge.preventedDone, false);

  fs.rmSync(tmpDir, { recursive: true, force: true });
});

