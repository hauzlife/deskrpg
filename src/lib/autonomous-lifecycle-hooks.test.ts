import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  parseArtifactPyramidSlices,
  insertTaskSafely,
  getSqliteDatabase,
  checkBoardStarvation,
  PRODUCT_BOARDS,
  resolveWorkspaceForTask,
  cleanOrphanSessionLeases,
  executeBlockerTriageLifecycle,
  executeQuotaModelSentinelLifecycle,
} from './autonomous-lifecycle-hooks';

interface TestTaskRow {
  id?: string;
  title?: string;
  body?: string;
  assignee?: string;
  status?: string;
  priority?: number;
  workspace_kind?: string;
  workspace_path?: string;
  project_id?: string;
  block_kind?: string | null;
  last_failure_error?: string | null;
}

test('parseArtifactPyramidSlices extracts cards and routes to correct boards', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pyramid-test-'));
  const analysisDir = path.join(tmpDir, '02-analysis');
  fs.mkdirSync(analysisDir, { recursive: true });

  const mysteliaCardPath = path.join(analysisDir, '03-mystelia-cards.md');
  fs.writeFileSync(
    mysteliaCardPath,
    `---
title: "02 Analysis: Mystelia"
---
# Mystelia Analysis

### [MY-01] Implementacao de Synastry
- **Identificador:** \`MY-01\`
- **Atribuído a:** \`backend-engineer\`
- **Prioridade:** P0
- **Objetivo:** Calcular mapas compostos.

### [MY-02] Tracking de UTMs
- **Identificador:** \`MY-02\`
- **Atribuído a:** \`platform-engineer\`
- **Prioridade:** P1
- **Objetivo:** Persistir UTMs no Stripe.
`,
    'utf8'
  );

  const bloopuCardPath = path.join(analysisDir, '02-bloopu-crypto-cards.md');
  fs.writeFileSync(
    bloopuCardPath,
    `---
title: "02 Analysis: Bloopu"
---
### [BL-01] Quantum Consensus
- **Atribuído a:** \`frontend-engineer\`
- **Prioridade:** P2
- **Objetivo:** WebSocket telemetry.
`,
    'utf8'
  );

  const slices = parseArtifactPyramidSlices(tmpDir);
  assert.equal(slices.length, 3);

  const my01 = slices.find((s) => s.title.includes('[MY-01]'));
  assert.ok(my01);
  assert.equal(my01.targetBoard, 'mystelia');
  assert.equal(my01.assignee, 'backend-engineer');
  assert.equal(my01.priority, 10); // P0 -> 10

  const my02 = slices.find((s) => s.title.includes('[MY-02]'));
  assert.ok(my02);
  assert.equal(my02.targetBoard, 'mystelia');
  assert.equal(my02.assignee, 'platform-engineer');
  assert.equal(my02.priority, 8); // P1 -> 8

  const bl01 = slices.find((s) => s.title.includes('[BL-01]'));
  assert.ok(bl01);
  assert.equal(bl01.targetBoard, 'bloopu');
  assert.equal(bl01.assignee, 'frontend-engineer');
  assert.equal(bl01.priority, 5); // P2 -> 5

  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('checkBoardStarvation identifies empty and starved boards accurately', () => {
  // Check that product boards list contains the 4 core products
  assert.ok(PRODUCT_BOARDS.includes('mystelia'));
  assert.ok(PRODUCT_BOARDS.includes('hot-telegram'));
  assert.ok(PRODUCT_BOARDS.includes('bloopu'));
  assert.ok(PRODUCT_BOARDS.includes('social'));

  // Non-existent board does not fail
  const nonExistent = checkBoardStarvation('unknown-board-xyz-999');
  assert.equal(nonExistent.starved, false);
});

test('resolveWorkspaceForTask resolves correct project and worktree/dir paths', () => {
  // Hot Telegram (default traffic)
  const htTraffic = resolveWorkspaceForTask('hot-telegram', { title: 'Implementar slots de campaign' });
  assert.equal(htTraffic.workspaceKind, 'worktree');
  assert.equal(htTraffic.projectId, 'p_8c9879cd');
  assert.equal(htTraffic.workspacePath, '/Users/anonymous/Projects/hauzhouse/hot/hot-traffic');

  // Hot Telegram (billing hint)
  const htBilling = resolveWorkspaceForTask('hot-telegram', { title: 'Corrigir webhook de checkout e PIX' });
  assert.equal(htBilling.workspaceKind, 'worktree');
  assert.equal(htBilling.projectId, 'p_c21aedb6');
  assert.equal(htBilling.workspacePath, '/Users/anonymous/Projects/hauzhouse/hot/hot-billing');

  // Mystelia
  const mystelia = resolveWorkspaceForTask('mystelia', { title: 'Refatorar synastry view' });
  assert.equal(mystelia.workspaceKind, 'worktree');
  assert.equal(mystelia.projectId, 'p_d0b4686c');
  assert.equal(mystelia.workspacePath, '/Users/anonymous/Projects/hauzhouse/esoteric/mystelia');

  // Bloopu (multi-repo umbrella -> dir)
  const bloopu = resolveWorkspaceForTask('bloopu', { title: 'Deploy telemetry listener' });
  assert.equal(bloopu.workspaceKind, 'dir');
  assert.equal(bloopu.projectId, 'p_55adf712');
  assert.equal(bloopu.workspacePath, '/Users/anonymous/Projects/hauzhouse/crypto');

  // Social
  const social = resolveWorkspaceForTask('social', { title: 'Publicar agendamento TikTok' });
  assert.equal(social.workspaceKind, 'worktree');
  assert.equal(social.projectId, 'p_f9791739');
  assert.equal(social.workspacePath, '/Users/anonymous/Projects/hauzhouse/social');

  // Explicit override preserved
  const override = resolveWorkspaceForTask('hot-telegram', {
    workspaceKind: 'dir',
    workspacePath: '/custom/path',
    projectId: 'p_custom',
  });
  assert.equal(override.workspaceKind, 'dir');
  assert.equal(override.workspacePath, '/custom/path');
  assert.equal(override.projectId, 'p_custom');
});

test('insertTaskSafely populates workspace and project metadata and bypasses WIP for emergency P0', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kanban-test-'));
  const dbPath = path.join(tmpDir, 'test.db');
  const sqlite = getSqliteDatabase(dbPath);

  // Setup minimal tasks schema
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
      run_id INTEGER,
      kind TEXT NOT NULL,
      payload TEXT,
      created_at INTEGER NOT NULL
    );
  `);

  // Insert task on hot-telegram via insertTaskSafely
  const res = insertTaskSafely('hot-telegram', {
    title: 'Nova feature de tráfego',
    body: 'Implementar rotação',
    assignee: 'backend-engineer',
    priority: 8,
    parentId: 't_root',
    databasePath: dbPath,
  });

  assert.equal(res.success, true);
  assert.ok(res.taskId);

  const row = sqlite.prepare('SELECT * FROM tasks WHERE id = ?').get(res.taskId) as TestTaskRow;
  assert.equal(row.workspace_kind, 'worktree');
  assert.equal(row.workspace_path, '/Users/anonymous/Projects/hauzhouse/hot/hot-traffic');
  assert.equal(row.project_id, 'p_8c9879cd');

  // Fill up active tasks to test WIP limit
  for (let i = 0; i < 5; i++) {
    sqlite
      .prepare("INSERT INTO tasks (id, title, status, created_at) VALUES (?, ?, 'ready', ?)")
      .run(`t_filler_${i}`, `Filler ${i}`, Math.floor(Date.now() / 1000));
  }

  // Normal priority task should be blocked by WIP
  const normalRes = insertTaskSafely('hot-telegram', {
    title: 'Normal low prio task',
    body: 'Should be blocked by WIP',
    assignee: 'backend-engineer',
    priority: 5,
    parentId: 't_root',
    databasePath: dbPath,
    wipLimit: 5,
  });
  assert.equal(normalRes.success, false);
  assert.match(normalRes.reason!, /WIP limit exceeded/);

  // Emergency P0 task (priority 10) bypasses WIP check
  const p0Res = insertTaskSafely('hot-telegram', {
    title: '[P0-EMERGENCY] Hotfix crítico',
    body: 'Bypasses WIP',
    assignee: 'backend-engineer',
    priority: 10,
    parentId: 't_root',
    databasePath: dbPath,
    wipLimit: 5,
  });
  assert.equal(p0Res.success, true);
  assert.ok(p0Res.taskId);

  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('cleanOrphanSessionLeases removes leases with dead PIDs and preserves live ones', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hermes-session-test-'));
  const profileDir = path.join(tmpDir, 'profiles', 'backend-engineer', 'runtime');
  fs.mkdirSync(profileDir, { recursive: true });

  const activePath = path.join(profileDir, 'active_sessions.json');
  // PID 9999999 is definitely not alive; process.pid is alive
  const entries = [
    { lease_id: 'dead_1', pid: 9999999, session_id: 's_dead' },
    { lease_id: 'live_1', pid: process.pid, session_id: 's_live' },
  ];
  fs.writeFileSync(activePath, JSON.stringify({ entries }), 'utf8');

  const cleaned = cleanOrphanSessionLeases(tmpDir);
  assert.equal(cleaned, 1);

  const updated = JSON.parse(fs.readFileSync(activePath, 'utf8'));
  assert.equal(updated.entries.length, 1);
  assert.equal(updated.entries[0].lease_id, 'live_1');

  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('executeBlockerTriageLifecycle auto-heals empty scratch workspace to worktree', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'triage-test-'));
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
      run_id INTEGER,
      kind TEXT NOT NULL,
      payload TEXT,
      created_at INTEGER NOT NULL
    );
  `);

  // Insert a task blocked with empty scratch workspace
  const taskId = 't_scratch_test';
  sqlite.prepare(`
    INSERT INTO tasks (id, title, body, assignee, status, priority, created_at, workspace_kind, workspace_path, block_kind, last_failure_error)
    VALUES (?, ?, ?, ?, 'blocked', 5, ?, 'scratch', '/tmp/empty', 'capability', ?)
  `).run(
    taskId,
    'Auditar e implementar safeguards de slots',
    'Testar rotinas de tráfego',
    'backend-engineer',
    Math.floor(Date.now() / 1000),
    "kanban_block(kind='capability', reason='Workspace scratch está vazio e não contém checkout Git...')"
  );

  sqlite.prepare(`
    INSERT INTO task_events (task_id, kind, payload, created_at)
    VALUES (?, 'blocked', ?, ?)
  `).run(
    taskId,
    JSON.stringify({ kind: 'capability', reason: 'Workspace scratch está vazio e não contém checkout Git...' }),
    Math.floor(Date.now() / 1000)
  );

  const result = await executeBlockerTriageLifecycle({
    channelId: 'test-chan',
    boardSlug: 'hot-telegram',
    taskId,
    cardTitle: 'Auditar e implementar safeguards de slots',
    assignee: 'backend-engineer',
    databasePath: dbPath,
    bypassDispatchSpawn: true,
  });

  assert.equal(result.action, 'workspace_remediated');
  assert.equal(result.remediatedTaskId, taskId);

  const updatedTask = sqlite.prepare('SELECT * FROM tasks WHERE id = ?').get(taskId) as TestTaskRow;
  assert.equal(updatedTask.status, 'ready');
  assert.equal(updatedTask.workspace_kind, 'worktree');
  assert.equal(updatedTask.workspace_path, '/Users/anonymous/Projects/hauzhouse/hot/hot-traffic');
  assert.equal(updatedTask.project_id, 'p_8c9879cd');
  assert.equal(updatedTask.block_kind, null);

  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('executeBlockerTriageLifecycle dispatches P0 env-fix task for ImportError / broken venv', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'triage-env-test-'));
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
      run_id INTEGER,
      kind TEXT NOT NULL,
      payload TEXT,
      created_at INTEGER NOT NULL
    );
  `);

  const taskId = 't_env_test';
  sqlite.prepare(`
    INSERT INTO tasks (id, title, body, assignee, status, priority, created_at, workspace_kind, workspace_path, block_kind, last_failure_error)
    VALUES (?, ?, ?, ?, 'blocked', 5, ?, 'worktree', '/path/to/repo', 'capability', ?)
  `).run(
    taskId,
    'Rodar testes de integridade hot-telegram',
    'pytest suite',
    'qa-engineer',
    Math.floor(Date.now() / 1000),
    "ImportError: No module named 'Crypto'"
  );

  const result = await executeBlockerTriageLifecycle({
    channelId: 'test-chan',
    boardSlug: 'hot-telegram',
    taskId,
    cardTitle: 'Rodar testes de integridade hot-telegram',
    assignee: 'qa-engineer',
    databasePath: dbPath,
    bypassDispatchSpawn: true,
  });

  assert.equal(result.action, 'env_fix_dispatched');
  assert.equal(result.remediatedTaskId, taskId);
  assert.ok(result.spawnedTaskId);

  // Original task moved to todo gated by dependency
  const originalTask = sqlite.prepare('SELECT status, block_kind FROM tasks WHERE id = ?').get(taskId) as TestTaskRow;
  assert.equal(originalTask.status, 'todo');
  assert.equal(originalTask.block_kind, 'dependency');

  // Spawned task assigned to platform-engineer with priority 10
  const spawnedTask = sqlite.prepare('SELECT * FROM tasks WHERE id = ?').get(result.spawnedTaskId) as TestTaskRow;
  assert.equal(spawnedTask.assignee, 'platform-engineer');
  assert.equal(spawnedTask.priority, 10);
  assert.match(spawnedTask.title ?? '', /\[P0-ENV-FIX\]/);

  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('executeBlockerTriageLifecycle dispatches P0 decision task for needs_input ambiguity', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'triage-needs-input-test-'));
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
      run_id INTEGER,
      kind TEXT NOT NULL,
      payload TEXT,
      created_at INTEGER NOT NULL
    );
  `);

  const taskId = 't_needs_input_test';
  sqlite.prepare(`
    INSERT INTO tasks (id, title, body, assignee, status, priority, created_at, workspace_kind, workspace_path, block_kind, last_failure_error)
    VALUES (?, ?, ?, ?, 'blocked', 5, ?, 'worktree', '/path/to/repo', 'needs_input', ?)
  `).run(
    taskId,
    'Validar primeira venda real pós-QA',
    'Critério 7: primeira venda real liquidada',
    'backend-engineer',
    Math.floor(Date.now() / 1000),
    'Deploy 100% íntegro, mas requer conversão orgânica ou compra teste autorizada pelo operador'
  );

  const result = await executeBlockerTriageLifecycle({
    channelId: 'test-chan',
    boardSlug: 'hot-telegram',
    taskId,
    cardTitle: 'Validar primeira venda real pós-QA',
    assignee: 'backend-engineer',
    databasePath: dbPath,
    bypassDispatchSpawn: true,
  });

  assert.equal(result.action, 'needs_input_dispatched');
  assert.equal(result.remediatedTaskId, taskId);
  assert.ok(result.spawnedTaskId);

  const decisionTask = sqlite.prepare('SELECT * FROM tasks WHERE id = ?').get(result.spawnedTaskId) as TestTaskRow;
  assert.equal(decisionTask.assignee, 'product-manager');
  assert.equal(decisionTask.priority, 10);
  assert.match(decisionTask.title ?? '', /\[P0-DECISÃO\]/);

  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('executeBlockerTriageLifecycle auto-heals quota / HTTP 429 / model / session blocks', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'triage-quota-test-'));
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
      run_id INTEGER,
      kind TEXT NOT NULL,
      payload TEXT,
      created_at INTEGER NOT NULL
    );
  `);

  const taskId = 't_quota_test';
  sqlite.prepare(`
    INSERT INTO tasks (id, title, body, assignee, status, priority, created_at, workspace_kind, workspace_path, block_kind, last_failure_error, model_override, provider_override)
    VALUES (?, ?, ?, ?, 'blocked', 5, ?, 'worktree', '/path/to/repo', 'quota', ?, 'gpt-5.3-codex-spark', 'openrouter')
  `).run(
    taskId,
    'Sincronizar telemetria com Langfuse',
    'Pipeline de observabilidade',
    'backend-engineer',
    Math.floor(Date.now() / 1000),
    'HTTP 429 Too Many Requests: insufficient_quota for model gpt-5.3-codex-spark'
  );

  const result = await executeBlockerTriageLifecycle({
    channelId: 'test-chan',
    boardSlug: 'hot-telegram',
    taskId,
    cardTitle: 'Sincronizar telemetria com Langfuse',
    assignee: 'backend-engineer',
    databasePath: dbPath,
    bypassDispatchSpawn: true,
  });

  assert.equal(result.action, 'quota_model_remediated');
  assert.equal(result.remediatedTaskId, taskId);

  const updatedTask = sqlite.prepare('SELECT status, block_kind, last_failure_error, model_override, provider_override FROM tasks WHERE id = ?').get(taskId) as any;
  assert.equal(updatedTask.status, 'ready');
  assert.equal(updatedTask.block_kind, null);
  assert.equal(updatedTask.last_failure_error, null);
  assert.equal(updatedTask.model_override, null);
  assert.equal(updatedTask.provider_override, null);

  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('executeBlockerTriageLifecycle dispatches L3 Owner Triage card for capability wall', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'triage-owner-test-'));
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
      run_id INTEGER,
      kind TEXT NOT NULL,
      payload TEXT,
      created_at INTEGER NOT NULL
    );
  `);

  const taskId = 't_capability_wall';
  sqlite.prepare(`
    INSERT INTO tasks (id, title, body, assignee, status, priority, created_at, workspace_kind, workspace_path, block_kind, last_failure_error)
    VALUES (?, ?, ?, ?, 'blocked', 5, ?, 'worktree', '/path/to/repo', 'capability', ?)
  `).run(
    taskId,
    'Configurar chaves bancárias e credenciais PIX no gateway de produção',
    'Exige autenticação física com e-CNPJ do operador titular',
    'platform-engineer',
    Math.floor(Date.now() / 1000),
    'Acesso negado: requer credenciais mTLS e autorização bancária restrita ao titular da conta (Owner)'
  );

  const result = await executeBlockerTriageLifecycle({
    channelId: 'test-chan',
    boardSlug: 'hot-telegram',
    taskId,
    cardTitle: 'Configurar chaves bancárias e credenciais PIX no gateway de produção',
    assignee: 'platform-engineer',
    databasePath: dbPath,
    bypassDispatchSpawn: true,
  });

  assert.equal(result.action, 'owner_triage_dispatched');
  assert.equal(result.remediatedTaskId, taskId);
  assert.ok(result.spawnedTaskId);

  const triageTask = sqlite.prepare('SELECT * FROM tasks WHERE id = ?').get(result.spawnedTaskId) as TestTaskRow;
  assert.equal(triageTask.assignee, 'product-manager');
  assert.equal(triageTask.priority, 10);
  assert.match(triageTask.title ?? '', /\[P0-OWNER-TRIAGE\]/);

  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('HK-09: executeQuotaModelSentinelLifecycle purges overrides and auto-unblocks transient blocked tasks', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sentinel-hk09-test-'));
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
      workspace_kind TEXT NOT NULL DEFAULT 'scratch',
      workspace_path TEXT,
      project_id TEXT,
      block_kind TEXT,
      last_failure_error TEXT,
      model_override TEXT,
      provider_override TEXT
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
      run_id INTEGER,
      kind TEXT NOT NULL,
      payload TEXT,
      created_at INTEGER NOT NULL
    );
  `);

  // Insert task with invalid overrides
  sqlite.prepare(`
    INSERT INTO tasks (id, title, status, created_at, model_override, provider_override)
    VALUES ('t_override_1', 'Task with bad override', 'ready', ?, 'gpt-5.3-codex-spark', 'openrouter')
  `).run(Math.floor(Date.now() / 1000));

  // Insert task blocked by quota / 429
  sqlite.prepare(`
    INSERT INTO tasks (id, title, status, created_at, block_kind, last_failure_error, model_override)
    VALUES ('t_quota_block_1', 'Blocked by quota', 'blocked', ?, 'quota', 'HTTP 429: rate limit exceeded', 'claude-3-5')
  `).run(Math.floor(Date.now() / 1000));

  const result = executeQuotaModelSentinelLifecycle({
    boardSlug: 'test-board',
    databasePath: dbPath,
    bypassDispatchSpawn: true,
  });

  assert.equal(result.clearedOverridesCount, 2);
  assert.equal(result.unblockedTasksCount, 1);
  assert.deepEqual(result.remediatedTaskIds, ['t_quota_block_1']);

  const task1 = sqlite.prepare('SELECT model_override, provider_override FROM tasks WHERE id = ?').get('t_override_1') as any;
  assert.equal(task1.model_override, null);
  assert.equal(task1.provider_override, null);

  const task2 = sqlite.prepare('SELECT status, block_kind, last_failure_error, model_override FROM tasks WHERE id = ?').get('t_quota_block_1') as any;
  assert.equal(task2.status, 'ready');
  assert.equal(task2.block_kind, null);
  assert.equal(task2.last_failure_error, null);
  assert.equal(task2.model_override, null);

  fs.rmSync(tmpDir, { recursive: true, force: true });
});
