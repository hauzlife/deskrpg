/**
 * Scrum Lifecycle Engine (HIVE — DeskRPG + Hermes)
 *
 * Implements the Scrumban operational ceremonies and state machines:
 * 1. Sprint Planning & Goal Sealing (Weekly Monday Goal Definition)
 * 2. Async Standup Impediment Sweep (Linked with HK-08 Blocker Triage)
 * 3. Mid-Sprint Scope Guard & Burndown (Wednesday Scope Adjustment)
 * 4. Sprint Review & Executive Increment SITREP (Friday Demo for Sovereign)
 * 5. Sprint Retrospective & AAR Knowledge Sync (Friday Lessons Learned)
 */

import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import { getSqliteDatabase, resolveTacticalRoomId } from './autonomous-lifecycle-hooks';
import { appendRoomMessage } from './chat-rooms';

export interface SprintPlanningResult {
  success: boolean;
  sprintTag: string;
  boardSlug: string;
  goal: string;
  committedTasksCount: number;
  details?: string;
}

export interface SprintBurndownResult {
  sprintTag: string;
  boardSlug: string;
  totalCommitted: number;
  doneCount: number;
  reviewCount: number;
  runningCount: number;
  readyCount: number;
  blockedCount: number;
  completionRatePercent: number;
  health: 'on_track' | 'at_risk' | 'critical';
  recommendations: string[];
}

export interface SprintReviewResult {
  sprintTag: string;
  boardSlug: string;
  completedTasks: Array<{
    id: string;
    title: string;
    completedAt?: number;
    prNumber?: number;
  }>;
  totalCompleted: number;
  sitrepSummary: string;
}

export interface SprintRetrospectiveResult {
  sprintTag: string;
  boardSlug: string;
  totalBlockersEncountered: number;
  autoRemediatedCount: number;
  ciFailuresCount: number;
  lessonsLearned: string[];
  aarReport: string;
}

/**
 * Generate standard ISO week sprint tag, e.g. "sprint-40-2026"
 */
export function generateSprintTag(date = new Date()): string {
  const target = new Date(date.valueOf());
  const dayNr = (date.getDay() + 6) % 7;
  target.setDate(target.getDate() - dayNr + 3);
  const firstThursday = target.valueOf();
  target.setMonth(0, 1);
  if (target.getDay() !== 4) {
    target.setMonth(0, 1 + ((4 - target.getDay() + 7) % 7));
  }
  const weekNumber = 1 + Math.ceil((firstThursday - target.valueOf()) / 604800000);
  return `sprint-${String(weekNumber).padStart(2, '0')}-${date.getFullYear()}`;
}

/**
 * Cerimônia 1: Sprint Planning & Goal Sealing
 * Binds the active Sprint Goal to the Kanban board and seals the Sprint Backlog.
 */
export async function sealSprintGoal(args: {
  boardSlug: string;
  goal: string;
  sprintTag?: string;
  targetTaskIds?: string[];
  databasePath?: string;
  channelId?: string;
  emitRoomMessage?: (roomId: string, message: any) => void;
}): Promise<SprintPlanningResult> {
  const { boardSlug, goal, channelId = 'c_general', databasePath, emitRoomMessage } = args;
  const sprintTag = args.sprintTag ?? generateSprintTag();
  const now = Math.floor(Date.now() / 1000);

  const dbPath = databasePath ?? path.join(os.homedir(), '.hermes', 'kanban', 'boards', boardSlug, 'kanban.db');
  if (!fs.existsSync(dbPath)) {
    return { success: false, sprintTag, boardSlug, goal, committedTasksCount: 0, details: 'db_not_found' };
  }

  const sqlite = getSqliteDatabase(dbPath);

  // If targetTaskIds is provided, tag those tasks; otherwise tag all current ready/running tasks
  let targetIds = args.targetTaskIds;
  if (!targetIds || targetIds.length === 0) {
    const rows = sqlite
      .prepare("SELECT id FROM tasks WHERE status IN ('ready', 'running', 'todo')")
      .all() as Array<{ id: string }>;
    targetIds = rows.map((r) => r.id);
  }

  // Record sprint tag and goal marker on each committed task
  for (const tid of targetIds) {
    const row = sqlite.prepare('SELECT body FROM tasks WHERE id = ?').get(tid) as { body?: string } | undefined;
    const currentBody = row?.body ?? '';
    if (!currentBody.includes(sprintTag)) {
      const updatedBody = `${currentBody}\n\n<!-- ${sprintTag} | goal: ${goal} -->`;
      sqlite.prepare('UPDATE tasks SET body = ? WHERE id = ?').run(updatedBody, tid);
    }
  }

  const tacticalRoom = await resolveTacticalRoomId(channelId, 'product-manager');
  if (tacticalRoom) {
    const content =
      `🎯 **[SPRINT PLANNING — META SELADA]** \`${sprintTag}\` no board **${boardSlug}**\n` +
      `**Sprint Goal:** "${goal}"\n` +
      `📦 **Sprint Backlog Selado:** ${targetIds.length} tarefas comprometidas.\n` +
      `🔒 Escopo travado para a semana. Novos cards só entram via P0 de produção aprovado pelo SRE.`;

    try {
      const msg = await appendRoomMessage({
        roomId: tacticalRoom.roomId,
        senderKind: 'system',
        senderId: null,
        senderName: 'Scrum Planning Sentinel',
        content,
        notice: {
          kind: 'card_done',
          cardId: sprintTag,
          cardTitle: goal,
          boardSlug,
          npcName: 'product-manager',
        },
      });
      if (emitRoomMessage) emitRoomMessage(tacticalRoom.roomId, msg);
    } catch {}
  }

  return {
    success: true,
    sprintTag,
    boardSlug,
    goal,
    committedTasksCount: targetIds.length,
    details: `Sprint Backlog sealed with ${targetIds.length} tasks committed to goal: ${goal}`,
  };
}

/**
 * Cerimônia 3: Mid-Sprint Scope Guard & Burndown
 * Calculates throughput, burndown velocity and recommends scope slicing if at risk.
 */
export async function auditSprintBurndown(args: {
  boardSlug: string;
  sprintTag?: string;
  databasePath?: string;
}): Promise<SprintBurndownResult> {
  const { boardSlug, databasePath } = args;
  const sprintTag = args.sprintTag ?? generateSprintTag();

  const dbPath = databasePath ?? path.join(os.homedir(), '.hermes', 'kanban', 'boards', boardSlug, 'kanban.db');
  if (!fs.existsSync(dbPath)) {
    return {
      sprintTag,
      boardSlug,
      totalCommitted: 0,
      doneCount: 0,
      reviewCount: 0,
      runningCount: 0,
      readyCount: 0,
      blockedCount: 0,
      completionRatePercent: 0,
      health: 'critical',
      recommendations: ['Board database not found.'],
    };
  }

  const sqlite = getSqliteDatabase(dbPath);

  const tasks = sqlite
    .prepare("SELECT id, status, block_kind FROM tasks WHERE body LIKE ? AND status != 'archived'")
    .all(`%${sprintTag}%`) as Array<{ id: string; status: string; block_kind: string | null }>;

  const totalCommitted = tasks.length;
  const doneCount = tasks.filter((t) => t.status === 'done').length;
  const reviewCount = tasks.filter((t) => t.status === 'review').length;
  const runningCount = tasks.filter((t) => t.status === 'running').length;
  const readyCount = tasks.filter((t) => t.status === 'ready' || t.status === 'todo').length;
  const blockedCount = tasks.filter((t) => t.status === 'blocked').length;

  const completionRatePercent = totalCommitted > 0 ? Math.round((doneCount / totalCommitted) * 100) : 100;

  let health: 'on_track' | 'at_risk' | 'critical' = 'on_track';
  const recommendations: string[] = [];

  if (blockedCount > 2) {
    health = 'critical';
    recommendations.push(
      `🚨 ${blockedCount} tarefas paralisadas em 'blocked'. Acionar HK-08 BlockerTriageHook imediatamente.`
    );
  } else if (completionRatePercent < 40 && readyCount + runningCount > 5) {
    health = 'at_risk';
    recommendations.push(
      `⚠️ Velocidade de burndown abaixo de 40%. O @product-manager deve executar corte de escopo preventivo.`
    );
  } else {
    recommendations.push(`✅ Burndown saudável. Squad com ritmo alinhado para entrega integral do Sprint Goal na sexta-feira.`);
  }

  return {
    sprintTag,
    boardSlug,
    totalCommitted,
    doneCount,
    reviewCount,
    runningCount,
    readyCount,
    blockedCount,
    completionRatePercent,
    health,
    recommendations,
  };
}

/**
 * Cerimônia 4: Sprint Review & Executive SITREP
 * Compiles all merged PRs, DoD validations and features ready for delivery to Sovereign.
 */
export async function generateSprintReviewSITREP(args: {
  boardSlug: string;
  sprintTag?: string;
  databasePath?: string;
  channelId?: string;
  emitRoomMessage?: (roomId: string, message: any) => void;
}): Promise<SprintReviewResult> {
  const { boardSlug, channelId = 'c_general', databasePath, emitRoomMessage } = args;
  const sprintTag = args.sprintTag ?? generateSprintTag();

  const dbPath = databasePath ?? path.join(os.homedir(), '.hermes', 'kanban', 'boards', boardSlug, 'kanban.db');
  if (!fs.existsSync(dbPath)) {
    return { sprintTag, boardSlug, completedTasks: [], totalCompleted: 0, sitrepSummary: 'No database found' };
  }

  const sqlite = getSqliteDatabase(dbPath);

  const doneTasks = sqlite
    .prepare("SELECT id, title, completed_at, body FROM tasks WHERE status = 'done' AND body LIKE ? ORDER BY completed_at DESC")
    .all(`%${sprintTag}%`) as Array<{ id: string; title: string; completed_at?: number; body?: string }>;

  const completedTasks = doneTasks.map((t) => {
    const prMatch = t.body?.match(/PR\s*#(\d+)|gh-pr-[^\s]+-(\d+)/i);
    const prNumber = prMatch ? Number(prMatch[1] || prMatch[2]) : undefined;
    return {
      id: t.id,
      title: t.title,
      completedAt: t.completed_at,
      prNumber,
    };
  });

  const lines = [
    `# 🏆 SITREP de Encerramento de Sprint — ${sprintTag.toUpperCase()}`,
    `**Projeto/Board:** \`${boardSlug}\``,
    `**Total de Incrementos Concluídos:** ${completedTasks.length}`,
    ``,
    `### Itens Homologados e Entregues (DoD & 5 Portões Validados):`,
  ];

  for (const item of completedTasks) {
    lines.push(
      `- [x] \`${item.id}\` — **${item.title}** ${item.prNumber ? `([PR #${item.prNumber}](https://github.com/hauzlife/${boardSlug}/pull/${item.prNumber}))` : ''}`
    );
  }

  if (completedTasks.length === 0) {
    lines.push(`- *(Nenhum item marcado como done nesta sprint).*`);
  }

  const sitrepSummary = lines.join('\n');

  const tacticalRoom = await resolveTacticalRoomId(channelId, 'product-manager');
  if (tacticalRoom) {
    try {
      const msg = await appendRoomMessage({
        roomId: tacticalRoom.roomId,
        senderKind: 'system',
        senderId: null,
        senderName: 'Sprint Review Sentinel',
        content: sitrepSummary,
        notice: {
          kind: 'card_done',
          cardId: sprintTag,
          cardTitle: `Sprint Review ${sprintTag}`,
          boardSlug,
          npcName: 'product-manager',
        },
      });
      if (emitRoomMessage) emitRoomMessage(tacticalRoom.roomId, msg);
    } catch {}
  }

  return {
    sprintTag,
    boardSlug,
    completedTasks,
    totalCompleted: completedTasks.length,
    sitrepSummary,
  };
}

/**
 * Cerimônia 5: Sprint Retrospective & AAR Sync
 * Analyzes impediments, auto-remediations and extracts durable lessons for the vault.
 */
export async function generateSprintRetrospective(args: {
  boardSlug: string;
  sprintTag?: string;
  databasePath?: string;
}): Promise<SprintRetrospectiveResult> {
  const { boardSlug, databasePath } = args;
  const sprintTag = args.sprintTag ?? generateSprintTag();

  const dbPath = databasePath ?? path.join(os.homedir(), '.hermes', 'kanban', 'boards', boardSlug, 'kanban.db');
  if (!fs.existsSync(dbPath)) {
    return {
      sprintTag,
      boardSlug,
      totalBlockersEncountered: 0,
      autoRemediatedCount: 0,
      ciFailuresCount: 0,
      lessonsLearned: [],
      aarReport: 'No database found',
    };
  }

  const sqlite = getSqliteDatabase(dbPath);

  // Read comments to detect HK-08 auto-remediations and CI failures
  const comments = sqlite
    .prepare(
      "SELECT tc.body FROM task_comments tc JOIN tasks t ON tc.task_id = t.id WHERE t.body LIKE ?"
    )
    .all(`%${sprintTag}%`) as Array<{ body: string }>;

  const autoRemediatedCount = comments.filter((c) =>
    c.body.includes('[BlockerTriageHook]') || c.body.includes('auto-remediação') || c.body.includes('auto_healed')
  ).length;

  const ciFailuresCount = comments.filter((c) =>
    c.body.includes('[GATE 2 — CI FALHOU]') || c.body.includes('CI falhou')
  ).length;

  const conflictCount = comments.filter((c) =>
    c.body.includes('[GATE 1 — CONFLITO DE MERGE]') || c.body.includes('conflito de merge')
  ).length;

  const totalBlockersEncountered = autoRemediatedCount + ciFailuresCount + conflictCount;

  const lessonsLearned: string[] = [
    `Auto-remediação de workspaces HK-08 recuperou ${autoRemediatedCount} incidentes sem parar a esteira.`,
    ciFailuresCount > 0
      ? `Registradas ${ciFailuresCount} falhas de CI no GitHub Actions; recomendado reforçar linting pre-commit.`
      : `Zero falhas de CI no ciclo — cobertura de testes consistente.`,
    conflictCount > 0
      ? `Detectados ${conflictCount} conflitos de merge; incentivar rebase diário das branches de feature.`
      : `Zero conflitos de merge — integração contínua sem quebras de branch.`,
  ];

  const aarReport = [
    `# 🧠 After Action Review (AAR) — ${sprintTag.toUpperCase()}`,
    `**Board:** \`${boardSlug}\``,
    `**Bloqueios Identificados:** ${totalBlockersEncountered}`,
    `- 🔧 Auto-Remediações HK-08: ${autoRemediatedCount}`,
    `- ❌ Falhas de CI / Actions: ${ciFailuresCount}`,
    `- ⚠️ Conflitos de Merge: ${conflictCount}`,
    ``,
    `### Lições Aprendidas Institucionalizadas:`,
    ...lessonsLearned.map((l) => `- ${l}`),
  ].join('\n');

  return {
    sprintTag,
    boardSlug,
    totalBlockersEncountered,
    autoRemediatedCount,
    ciFailuresCount,
    lessonsLearned,
    aarReport,
  };
}
