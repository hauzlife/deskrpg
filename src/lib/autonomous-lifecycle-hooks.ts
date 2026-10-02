/**
 * Autonomous Lifecycle Hooks (HIVE — DeskRPG + Hermes)
 *
 * Implements the lifecycle hooks from AUTONOMOUS_LIFECYCLE_HOOKS.md:
 * - HK-01: PostCompletionActionHook (Auto-Triage & Remediation Dispatcher + Artifact Pyramid Ingestion)
 * - HK-02: IncidentRoomDispatchHook (Contextual Tactical Room Notifications)
 * - HK-03: ArtifactPreservationHook (Preserves L1/L2/L3 Artifact Pyramids)
 * - HK-04: ReviewGateTransitionHook (Reviewer -> Verifier chain handoff)
 * - HK-05: OrchestratorFeedbackLoopHook (Epic closing & backlog feeding)
 * - HK-06: CircuitBreakerDeadlockHook (Quarantine on failure loops)
 * - HK-07: Bidirectional Starvation Hook (Instant backlog feeding on 0 active tasks)
 */

import { db, chatRooms } from '@/db';
import { eq, and } from 'drizzle-orm';
import { appendRoomMessage } from '@/lib/chat-rooms';
import type { RoomMessage } from '@/lib/chat-rooms-policy';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';

export const PRODUCT_BOARDS = ['mystelia', 'hot-telegram', 'bloopu', 'social'] as const;
export const STARVATION_COOLDOWN_MS = 10 * 60 * 1000; // 10 minutes debounce
export const lastStarvationTrigger = new Map<string, number>();

export interface ProjectMapping {
  projectId: string;
  primaryPath: string;
  defaultWorkspaceKind: 'worktree' | 'dir';
}

export const CANONICAL_PROJECT_MAPPINGS: Record<string, ProjectMapping> = {
  mystelia: {
    projectId: 'p_d0b4686c',
    primaryPath: '/Users/anonymous/Projects/hauzhouse/esoteric/mystelia',
    defaultWorkspaceKind: 'worktree',
  },
  bloopu: {
    projectId: 'p_55adf712',
    primaryPath: '/Users/anonymous/Projects/hauzhouse/crypto',
    defaultWorkspaceKind: 'dir',
  },
  social: {
    projectId: 'p_f9791739',
    primaryPath: '/Users/anonymous/Projects/hauzhouse/social',
    defaultWorkspaceKind: 'worktree',
  },
};

export function resolveHotTelegramProject(hintText?: string): ProjectMapping {
  const lower = (hintText || '').toLowerCase();
  if (
    lower.includes('billing') ||
    lower.includes('checkout') ||
    lower.includes('payment') ||
    lower.includes('rebeltransfer') ||
    lower.includes('order') ||
    lower.includes('pix')
  ) {
    return {
      projectId: 'p_c21aedb6',
      primaryPath: '/Users/anonymous/Projects/hauzhouse/hot/hot-billing',
      defaultWorkspaceKind: 'worktree',
    };
  }
  return {
    projectId: 'p_8c9879cd',
    primaryPath: '/Users/anonymous/Projects/hauzhouse/hot/hot-traffic',
    defaultWorkspaceKind: 'worktree',
  };
}

export function resolveWorkspaceForTask(
  boardSlug: string,
  spec: {
    title?: string;
    body?: string;
    assignee?: string;
    workspaceKind?: 'scratch' | 'worktree' | 'dir';
    workspacePath?: string;
    projectId?: string;
  }
): {
  workspaceKind: 'scratch' | 'worktree' | 'dir';
  workspacePath: string | null;
  projectId: string | null;
} {
  // If caller explicitly passed non-scratch workspaceKind and workspacePath, preserve it
  if (spec.workspaceKind && spec.workspaceKind !== 'scratch' && spec.workspacePath) {
    return {
      workspaceKind: spec.workspaceKind,
      workspacePath: spec.workspacePath,
      projectId: spec.projectId ?? null,
    };
  }

  const combinedHint = `${spec.title ?? ''} ${spec.body ?? ''}`;

  // 1. Hot Telegram resolution
  if (boardSlug === 'hot-telegram') {
    const mapping = resolveHotTelegramProject(combinedHint);
    return {
      workspaceKind: mapping.defaultWorkspaceKind,
      workspacePath: mapping.primaryPath,
      projectId: mapping.projectId,
    };
  }

  // 2. Core Product Boards
  if (boardSlug in CANONICAL_PROJECT_MAPPINGS) {
    const mapping = CANONICAL_PROJECT_MAPPINGS[boardSlug];
    return {
      workspaceKind: mapping.defaultWorkspaceKind,
      workspacePath: mapping.primaryPath,
      projectId: mapping.projectId,
    };
  }

  // 3. Fallback: Check board.json under ~/.hermes/kanban/boards/<boardSlug>/board.json
  try {
    const boardJsonPath = path.join(os.homedir(), '.hermes', 'kanban', 'boards', boardSlug, 'board.json');
    if (fs.existsSync(boardJsonPath)) {
      const boardData = JSON.parse(fs.readFileSync(boardJsonPath, 'utf8'));
      if (boardData.default_workdir && typeof boardData.default_workdir === 'string') {
        const isGit = fs.existsSync(path.join(boardData.default_workdir, '.git'));
        return {
          workspaceKind: isGit ? 'worktree' : 'dir',
          workspacePath: boardData.default_workdir,
          projectId: boardData.project_id || null,
        };
      }
    }
  } catch {}

  // 4. Default fallback: keep scratch if no repo/worktree could be resolved
  return {
    workspaceKind: spec.workspaceKind ?? 'scratch',
    workspacePath: spec.workspacePath ?? null,
    projectId: spec.projectId ?? null,
  };
}

// Dynamic SQLite loader compatible with Node 22/24/26 built-in node:sqlite or better-sqlite3
export function getSqliteDatabase(dbPath: string, options?: { readonly?: boolean }) {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const nodeSqlite = require('node:sqlite');
    if (nodeSqlite && nodeSqlite.DatabaseSync) {
      const dbInstance = new nodeSqlite.DatabaseSync(dbPath, { readOnly: options?.readonly ?? false });
      return {
        prepare: (query: string) => {
          const stmt = dbInstance.prepare(query);
          return {
            get: (...args: unknown[]) => stmt.get(...args),
            all: (...args: unknown[]) => stmt.all(...args),
            run: (...args: unknown[]) => stmt.run(...args),
          };
        },
        exec: (query: string) => dbInstance.exec(query),
      };
    }
  } catch {
    // fallback
  }

  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const BetterSqlite = require('better-sqlite3');
  return new BetterSqlite(dbPath, { readonly: options?.readonly ?? false });
}

export interface TaskRunInfo {
  summary: string | null;
  metadata: Record<string, unknown> | null;
  artifacts: string[];
}

export interface DownstreamHandoff {
  nextActor: string;
  actionRequired: string;
  targetRoomName: string;
}

export interface ParsedSlice {
  targetBoard: string;
  title: string;
  body: string;
  assignee: string;
  priority: number;
}

/**
 * Reads the latest run summary and metadata from Hermes Kanban DB directly
 */
export function readTaskRunInfo(boardSlug: string, taskId: string): TaskRunInfo | null {
  try {
    const dbPath = path.join(os.homedir(), '.hermes', 'kanban', 'boards', boardSlug, 'kanban.db');
    if (!fs.existsSync(dbPath)) return null;

    const sqlite = getSqliteDatabase(dbPath, { readonly: true });
    const row = sqlite
      .prepare('SELECT summary, metadata FROM task_runs WHERE task_id = ? ORDER BY started_at DESC LIMIT 1')
      .get(taskId) as { summary?: string | null; metadata?: string | null } | undefined;

    let parsedMeta: Record<string, unknown> | null = null;
    if (row?.metadata) {
      try {
        parsedMeta = JSON.parse(row.metadata);
      } catch {
        // ignore parse error
      }
    }

    const artifacts: string[] = [];
    if (parsedMeta?.artifact_pyramid && typeof parsedMeta.artifact_pyramid === 'string') {
      artifacts.push(parsedMeta.artifact_pyramid);
    }
    if (Array.isArray(parsedMeta?.artifacts)) {
      for (const a of parsedMeta.artifacts) {
        if (typeof a === 'string' && !artifacts.includes(a)) artifacts.push(a);
      }
    }

    // Also inspect tasks table for result / body if runInfo has no artifacts
    if (artifacts.length === 0) {
      try {
        const taskRow = sqlite
          .prepare('SELECT body, result FROM tasks WHERE id = ?')
          .get(taskId) as { body?: string | null; result?: string | null } | undefined;
        
        const combined = `${taskRow?.result ?? ''}\n${taskRow?.body ?? ''}`;
        const match = combined.match(/(\/[^\s\n]+\/(?:00-index\.md|[a-zA-Z0-9_-]+-decomposition[^\s\n]*))/);
        if (match && !artifacts.includes(match[1])) {
          artifacts.push(match[1]);
        }
      } catch {
        // ignore
      }
    }

    return {
      summary: row?.summary ?? null,
      metadata: parsedMeta,
      artifacts,
    };
  } catch (err) {
    console.warn(`[autonomous-hooks] readTaskRunInfo failed for ${boardSlug}/${taskId}:`, err);
    return null;
  }
}

function matchTacticalRoom(
  rooms: Array<{ id: string; name: string }>,
  assignee: string | null
): { roomId: string; roomName: string } | null {
  if (rooms.length === 0) return null;

  const preferences: Record<string, string[]> = {
    'security-engineer': ['Incident Response', 'NOC', 'Dev Lab'],
    'site-reliability-engineer': ['Incident Response', 'War Room', 'NOC'],
    debugger: ['War Room', 'Dev Lab', 'Incident Response'],
    'qa-engineer': ['War Room', 'Dev Lab'],
    verifier: ['War Room', 'Dev Lab', 'Product Office'],
    reviewer: ['Dev Lab', 'Product Office', 'War Room'],
    'backend-engineer': ['Dev Lab', 'Meeting Room'],
    'frontend-engineer': ['Dev Lab', 'Meeting Room'],
    'platform-engineer': ['Dev Lab', 'NOC'],
    'technical-architect': ['Dev Lab', 'Incident Response', 'NOC'],
    'implementation-planner': ['Ops Control', 'Product Office', 'Dev Lab'],
    orchestrator: ['Ops Control', 'War Room', 'Boardroom'],
    'kanban-strategist': ['Ops Control', 'Boardroom'],
    'product-manager': ['Product Office', 'Ops Control', 'Dev Lab'],
    'spec-driven-development': ['Product Office', 'Dev Lab'],
    'ux-designer': ['Product Office', 'Brainstorm Room'],
    'copy-editor': ['Campaigns', 'Studio'],
    'brand-designer': ['Studio', 'Campaigns'],
    'seo-specialist': ['Campaigns'],
    writer: ['Campaigns', 'Studio'],
    curator: ['Deep Thought', 'Library'],
    wonderer: ['Deep Thought', 'Library'],
    ceo: ['Boardroom', 'CFO Suite'],
    cfo: ['CFO Suite', 'Boardroom'],
    cto: ['Boardroom', 'Dev Lab'],
    coo: ['Ops Control', 'Boardroom'],
  };

  const role = assignee?.trim().toLowerCase() ?? '';
  const preferredNames = preferences[role] ?? [
    'Dev Lab',
    'War Room',
    'Ops Control',
    'Incident Response',
    'Product Office',
    'Campaigns',
    'Boardroom',
    'Deep Thought',
  ];

  for (const pName of preferredNames) {
    const match = rooms.find((r) => r.name.toLowerCase() === pName.toLowerCase());
    if (match) return { roomId: match.id, roomName: match.name };
  }

  return { roomId: rooms[0].id, roomName: rooms[0].name };
}

/**
 * Resolves the primary tactical room for a channel and role with fail-safe fallback
 */
export async function resolveTacticalRoomId(
  channelId: string,
  assignee: string | null
): Promise<{ roomId: string; roomName: string } | null> {
  // 1. Try Drizzle / @/db
  try {
    const rooms = await db
      .select({ id: chatRooms.id, name: chatRooms.name, kind: chatRooms.kind })
      .from(chatRooms)
      .where(and(eq(chatRooms.channelId, channelId), eq(chatRooms.kind, 'group')));

    if (rooms.length > 0) {
      return matchTacticalRoom(rooms, assignee);
    }
  } catch {
    // Fallback to node:sqlite on ~/.deskrpg/data/deskrpg.db
    try {
      const deskDbPath = path.join(os.homedir(), '.deskrpg', 'data', 'deskrpg.db');
      if (fs.existsSync(deskDbPath)) {
        const sqlite = getSqliteDatabase(deskDbPath, { readonly: true });
        const rows = sqlite
          .prepare("SELECT id, name, kind FROM chat_rooms WHERE channel_id = ? AND kind = 'group'")
          .all(channelId) as Array<{ id: string; name: string; kind: string }>;
        if (rows.length > 0) {
          return matchTacticalRoom(rows, assignee);
        }
      }
    } catch (e) {
      console.warn('[autonomous-hooks] resolveTacticalRoomId fallback failed:', e);
    }
  }

  return null;
}

/**
 * Maps the completed role to the downstream consumer and action
 */
export function resolveDownstreamHandoff(assignee: string | null): DownstreamHandoff {
  const role = assignee?.trim().toLowerCase() ?? '';

  switch (role) {
    case 'site-reliability-engineer':
      return {
        nextActor: '@backend-engineer @debugger',
        actionRequired: 'Varredura de telemetria/anomalias concluída. Executar remediação física de serviços, bots e links.',
        targetRoomName: 'NOC',
      };
    case 'security-engineer':
      return {
        nextActor: '@site-reliability-engineer @backend-engineer',
        actionRequired: 'Auditoria de segurança concluída. Iniciar mitigação de vulnerabilidades e rotação de credenciais.',
        targetRoomName: 'Incident Response',
      };
    case 'qa-engineer':
      return {
        nextActor: '@debugger @backend-engineer',
        actionRequired: 'Baterias de teste concluídas. Inspecionar falhas e aplicar correções de código.',
        targetRoomName: 'War Room',
      };
    case 'backend-engineer':
    case 'frontend-engineer':
      return {
        nextActor: '@reviewer',
        actionRequired: 'Implementação de código concluída. Realizar code review e aprovação de PR.',
        targetRoomName: 'Dev Lab',
      };
    case 'reviewer':
      return {
        nextActor: '@verifier',
        actionRequired: 'Code review aprovado. Executar verificação de critérios de aceite.',
        targetRoomName: 'Dev Lab',
      };
    case 'verifier':
      return {
        nextActor: '@orchestrator',
        actionRequired: 'Critérios de aceite validados com sucesso. Card pronto para fechamento e release.',
        targetRoomName: 'Dev Lab',
      };
    case 'technical-architect':
      return {
        nextActor: '@backend-engineer @implementation-planner',
        actionRequired: 'Decisões de arquitetura (ADR) publicadas. Pronto para decomposição e implementação.',
        targetRoomName: 'Dev Lab',
      };
    case 'spec-driven-development':
    case 'product-manager':
      return {
        nextActor: '@implementation-planner @backend-engineer',
        actionRequired: 'Especificações formais refinadas. Pronto para planejamento técnico e sprint.',
        targetRoomName: 'Product Office',
      };
    case 'implementation-planner':
      return {
        nextActor: '@orchestrator',
        actionRequired: 'Fatiamento de épics em tarefas atômicas concluído. Pronto para despacho no Kanban.',
        targetRoomName: 'Ops Control',
      };
    case 'kanban-strategist':
      return {
        nextActor: '@orchestrator @coo',
        actionRequired: 'Auditoria de fluxo e limites de WIP concluída. Ajustar gargalos de esteira.',
        targetRoomName: 'Ops Control',
      };
    case 'copy-editor':
    case 'writer':
      return {
        nextActor: '@brand-designer @seo-specialist',
        actionRequired: 'Textos e copys finalizados. Integrar aos assets visuais e metatags de campanha.',
        targetRoomName: 'Campaigns',
      };
    default:
      return {
        nextActor: '@orchestrator',
        actionRequired: 'Entrega finalizada. Avaliar continuidade do épico e desdobramentos.',
        targetRoomName: 'Ops Control',
      };
  }
}

/**
 * Parses markdown analysis files in an artifact pyramid (02-analysis/*.md) to extract atomic cards
 */
export function parseArtifactPyramidSlices(pyramidPathOrIndex: string): ParsedSlice[] {
  const slices: ParsedSlice[] = [];
  try {
    let rootDir = pyramidPathOrIndex;
    if (fs.existsSync(pyramidPathOrIndex)) {
      const stat = fs.statSync(pyramidPathOrIndex);
      if (stat.isFile()) {
        rootDir = path.dirname(pyramidPathOrIndex);
      }
    } else {
      return slices;
    }

    const analysisDir = path.join(rootDir, '02-analysis');
    if (!fs.existsSync(analysisDir) || !fs.statSync(analysisDir).isDirectory()) {
      return slices;
    }

    const files = fs.readdirSync(analysisDir).filter((f) => f.endsWith('.md'));
    for (const file of files) {
      const fullPath = path.join(analysisDir, file);
      const content = fs.readFileSync(fullPath, 'utf8');

      // Resolve destination board from filename or content
      let targetBoard = '';
      const lowerFile = file.toLowerCase();
      const lowerHead = content.slice(0, 600).toLowerCase();

      if (lowerFile.includes('mystelia') || lowerHead.includes('mystelia')) {
        targetBoard = 'mystelia';
      } else if (
        lowerFile.includes('hot-telegram') ||
        lowerFile.includes('hot') ||
        lowerHead.includes('hot-telegram')
      ) {
        targetBoard = 'hot-telegram';
      } else if (
        lowerFile.includes('bloopu') ||
        lowerFile.includes('crypto') ||
        lowerHead.includes('bloopu')
      ) {
        targetBoard = 'bloopu';
      } else if (lowerFile.includes('social') || lowerHead.includes('social')) {
        targetBoard = 'social';
      }

      // Split into sections by H3 headers
      const sections = content.split(/\n###\s+/);
      for (let i = 1; i < sections.length; i++) {
        const sec = sections[i];
        const lines = sec.trim().split('\n');
        const header = lines[0].trim();
        const body = lines.slice(1).join('\n').trim();

        const title = header.replace(/[`*]/g, '').trim();

        const assigneeMatch = body.match(/-\s*\*\*Atribuído a:\*\*\s*`?([a-zA-Z0-9_-]+)`?/i);
        const assignee = assigneeMatch ? assigneeMatch[1] : 'backend-engineer';

        const priorityMatch = body.match(/-\s*\*\*Prioridade:\*\*\s*(P[0-9])/i);
        let priority = 5;
        if (priorityMatch) {
          const p = priorityMatch[1].toUpperCase();
          if (p === 'P0') priority = 10;
          else if (p === 'P1') priority = 8;
          else if (p === 'P2') priority = 5;
        }

        slices.push({
          targetBoard,
          title,
          body,
          assignee,
          priority,
        });
      }
    }
  } catch (err) {
    console.warn('[autonomous-hooks] Error parsing artifact pyramid slices:', err);
  }
  return slices;
}

/**
 * HK-01 & HK-02: Executed when a card reaches 'done' or when a run finishes.
 * Posts rich notification with artifact in tactical room and creates child remediation tasks if needed.
 */
export async function executePostCompletionLifecycle(args: {
  channelId: string;
  boardSlug: string;
  taskId: string;
  cardTitle: string;
  assignee: string | null;
  emitRoomMessage?: (roomId: string, message: RoomMessage) => void;
}): Promise<void> {
  const { channelId, boardSlug, taskId, cardTitle, assignee, emitRoomMessage } = args;

  const runInfo = readTaskRunInfo(boardSlug, taskId);
  const tacticalRoom = await resolveTacticalRoomId(channelId, assignee);
  const handoff = resolveDownstreamHandoff(assignee);

  // 1. Post to tactical room if available
  if (tacticalRoom) {
    const summaryText = runInfo?.summary ? `\n> ${runInfo.summary}\n` : '';
    const artifactLink = runInfo?.artifacts?.length
      ? `\n📄 **Artefatos Gerados:**\n${runInfo.artifacts.map((a) => `• \`${a}\``).join('\n')}\n`
      : '';

    const content = `✅ **[ENTREGA CONCLUÍDA]** \`${taskId}\` — ${cardTitle}
${summaryText}${artifactLink}
👉 **Próximo Passo:** ${handoff.nextActor} — ${handoff.actionRequired}`;

    try {
      const message = await appendRoomMessage({
        roomId: tacticalRoom.roomId,
        senderKind: 'system',
        senderId: null,
        senderName: 'Lifecycle Orchestrator',
        content,
        notice: {
          kind: 'card_done',
          cardId: taskId,
          cardTitle,
          boardSlug,
          npcName: assignee ?? 'system',
        },
      });

      if (emitRoomMessage) {
        emitRoomMessage(tacticalRoom.roomId, message);
      }
      console.log(`[autonomous-hooks] Posted tactical handoff in "${tacticalRoom.roomName}" (${tacticalRoom.roomId})`);
    } catch (err) {
      console.warn('[autonomous-hooks] Failed to post tactical message:', err);
    }
  }

  // 2. HK-01 & Channel Board Dispatcher: Auto-Remediation / Slices / Child Tasks / Artifact Pyramid Ingestion
  await dispatchAutomatedRemediation(boardSlug, taskId, cardTitle, runInfo?.metadata ?? {}, channelId, runInfo);
}

/**
 * HK-04: Intermediate Transition Hook (Review & Verification Gate)
 * Called when card moves to 'review' or is handed off for verification.
 */
export async function executeReviewGateHandoff(args: {
  channelId: string;
  boardSlug: string;
  taskId: string;
  cardTitle: string;
  assignee: string | null;
  emitRoomMessage?: (roomId: string, message: RoomMessage) => void;
}): Promise<void> {
  const { channelId, boardSlug, taskId, cardTitle, assignee, emitRoomMessage } = args;
  const tacticalRoom = await resolveTacticalRoomId(channelId, assignee ?? 'reviewer');

  if (tacticalRoom) {
    const isVerifierTarget = assignee === 'verifier';
    const nextActor = isVerifierTarget ? '@verifier' : '@reviewer';
    const actionRequired = isVerifierTarget
      ? 'Executar verificação rigorosa de critérios de aceite e evidências.'
      : 'Revisar código e diff de PR para conformidade técnica.';

    const content = `🔍 **[GATE DE REVISÃO / VALIDAÇÃO ATIVO]** \`${taskId}\` — ${cardTitle}
👉 **Ação Requerida:** ${nextActor} — ${actionRequired}
Board: \`${boardSlug}\``;

    try {
      const message = await appendRoomMessage({
        roomId: tacticalRoom.roomId,
        senderKind: 'system',
        senderId: null,
        senderName: 'Gate Controller',
        content,
        notice: {
          kind: 'card_review',
          cardId: taskId,
          cardTitle,
          boardSlug,
          npcName: assignee ?? 'reviewer',
        },
      });

      if (emitRoomMessage) {
        emitRoomMessage(tacticalRoom.roomId, message);
      }
      console.log(`[autonomous-hooks] Posted review gate alert in "${tacticalRoom.roomName}" (${tacticalRoom.roomId})`);
    } catch (err) {
      console.warn('[autonomous-hooks] Failed to post review gate message:', err);
    }
  }
}

export interface WipCheckResult {
  allowed: boolean;
  activeCount: number;
  wipLimit: number;
  reason?: string;
}

/**
 * Checks WIP limits on a target Kanban board (counts tasks in ready, running, and review)
 */
export function checkBoardWipLimit(boardSlug: string, wipLimit = 5): WipCheckResult {
  try {
    const dbPath = path.join(os.homedir(), '.hermes', 'kanban', 'boards', boardSlug, 'kanban.db');
    if (!fs.existsSync(dbPath)) {
      return { allowed: true, activeCount: 0, wipLimit };
    }

    const sqlite = getSqliteDatabase(dbPath, { readonly: true });
    const row = sqlite
      .prepare(
        "SELECT count(*) as count FROM tasks WHERE status IN ('ready', 'running', 'review')"
      )
      .get() as { count?: number } | undefined;

    const activeCount = Number(row?.count ?? 0);
    if (activeCount >= wipLimit) {
      return {
        allowed: false,
        activeCount,
        wipLimit,
        reason: `WIP limit exceeded on board "${boardSlug}": ${activeCount} active tasks (limit is ${wipLimit})`,
      };
    }

    return { allowed: true, activeCount, wipLimit };
  } catch (err) {
    console.warn(`[autonomous-hooks] checkBoardWipLimit failed for ${boardSlug}:`, err);
    return { allowed: true, activeCount: 0, wipLimit };
  }
}

/**
 * Checks if a product board has run out of tasks (0 in ready, running, todo)
 */
export function checkBoardStarvation(boardSlug: string): { starved: boolean; activeCount: number } {
  try {
    const dbPath = path.join(os.homedir(), '.hermes', 'kanban', 'boards', boardSlug, 'kanban.db');
    if (!fs.existsSync(dbPath)) return { starved: false, activeCount: 0 };

    const sqlite = getSqliteDatabase(dbPath, { readonly: true });
    const row = sqlite
      .prepare("SELECT count(*) as count FROM tasks WHERE status IN ('ready', 'running', 'todo')")
      .get() as { count?: number } | undefined;

    const activeCount = Number(row?.count ?? 0);
    return { starved: activeCount === 0, activeCount };
  } catch (err) {
    console.warn(`[autonomous-hooks] checkBoardStarvation failed for ${boardSlug}:`, err);
    return { starved: false, activeCount: 0 };
  }
}

/**
 * HK-07: Bidirectional Starvation Sentinel
 * When 0 active tasks exist on a product board, instantly triggers the roadmap progression / task slicing pipeline.
 */
export async function checkAndTriggerStarvation(args: {
  channelId: string;
  boardSlug: string;
  emitRoomMessage?: (roomId: string, message: RoomMessage) => void;
}): Promise<boolean> {
  const { channelId, boardSlug, emitRoomMessage } = args;

  if (!PRODUCT_BOARDS.includes(boardSlug as (typeof PRODUCT_BOARDS)[number])) return false;

  const { starved, activeCount } = checkBoardStarvation(boardSlug);
  if (!starved) return false;

  const now = Date.now();
  const lastTime = lastStarvationTrigger.get(boardSlug) ?? 0;
  if (now - lastTime < STARVATION_COOLDOWN_MS) {
    return false;
  }
  lastStarvationTrigger.set(boardSlug, now);

  console.warn(`[autonomous-hooks] 🚨 BACKLOG STARVATION DETECTED on board "${boardSlug}" (active=${activeCount})`);

  // 1. Alert in Product Office / Ops Control
  const tacticalRoom = await resolveTacticalRoomId(channelId, 'product-manager');
  if (tacticalRoom) {
    const alertContent = `🚨 **[FOME DE BACKLOG DETECTADA]**
Board: \`${boardSlug}\`
Status: **0 tarefas ativas** (ready / running / todo esgotados).
⚡ **Ação Autônoma:** Acionando @product-manager e @implementation-planner para fatiar o próximo marco do Roadmap imediatamente.`;

    try {
      const message = await appendRoomMessage({
        roomId: tacticalRoom.roomId,
        senderKind: 'system',
        senderId: null,
        senderName: 'Starvation Sentinel',
        content: alertContent,
        notice: {
          kind: 'card_blocked',
          cardId: `starvation-${boardSlug}`,
          cardTitle: `Backlog Starvation on ${boardSlug}`,
          boardSlug,
          npcName: 'product-manager',
        },
      });
      if (emitRoomMessage) emitRoomMessage(tacticalRoom.roomId, message);
    } catch (err) {
      console.warn('[autonomous-hooks] Failed to post starvation room notice:', err);
    }
  }

  // 2. Wake up implementation-planner and product-manager via Hermes CLI
  try {
    spawn('hermes', ['--profile', 'implementation-planner', 'cron', 'run', 'cefc5ff877ce'], {
      detached: true,
      stdio: 'ignore',
    }).unref();

    spawn('hermes', ['--profile', 'product-manager', 'cron', 'run', '06c46a5c4668'], {
      detached: true,
      stdio: 'ignore',
    }).unref();

    return true;
  } catch (err) {
    console.warn('[autonomous-hooks] Failed to spawn hermes cron jobs on starvation:', err);
    return false;
  }
}

/**
 * Creates concrete downstream tasks in the appropriate board if critical findings exist,
 * technical slices are generated, or an artifact pyramid was output.
 */
async function dispatchAutomatedRemediation(
  boardSlug: string,
  parentTaskId: string,
  parentTitle: string,
  meta: Record<string, unknown>,
  channelId?: string,
  runInfo?: TaskRunInfo | null
): Promise<void> {
  const cveCount = Number(meta.cve_critical_count ?? 0);
  const cveFindings = Array.isArray(meta.cve_findings) ? meta.cve_findings : [];
  const sslExpiredCount = Number(meta.ssl_expired_certs_count ?? 0);

  // A. If Critical CVEs exist -> create task in Engineering
  if (cveCount > 0 || cveFindings.length > 0) {
    const engBoard = 'eng-ops';
    const cveList = cveFindings.length ? cveFindings.join(', ') : `${cveCount} vulnerabilidades críticas`;
    const title = `[P0-HOTFIX] Mitigar RCEs e CVEs críticos (${cveList})`;
    const body = `Tarefa de remediação P0 criada automaticamente a partir da auditoria ${parentTaskId} ("${parentTitle}").\n\nDetalhes:\n- CVEs identificados: ${cveList}\n- Ação: Atualizar dependências afetadas e validar ausência de regressões com test runner.`;
    insertTaskSafely(engBoard, {
      title,
      body,
      assignee: 'backend-engineer',
      priority: 9,
      parentId: parentTaskId,
    });
  }

  // B. If Expired SSL certs exist -> create task in Infrastructure
  if (sslExpiredCount > 0) {
    const infraBoard = 'infra-ops';
    const title = `[P0-INFRA] Renovar ${sslExpiredCount} certificados SSL/TLS expirados`;
    const body = `Tarefa de remediação P0 criada automaticamente a partir da auditoria ${parentTaskId} ("${parentTitle}").\n\nDetalhes:\n- Certificados expirados: ${sslExpiredCount}\n- Ação: Executar certbot renew, inspecionar bindings do Nginx/Traefik e validar TLS handshake.`;
    insertTaskSafely(infraBoard, {
      title,
      body,
      assignee: 'site-reliability-engineer',
      priority: 9,
      parentId: parentTaskId,
    });
  }

  // C. Generic In-Memory Slices Dispatcher: if technical_slices array was in metadata
  const technicalSlices = Array.isArray(meta.technical_slices)
    ? (meta.technical_slices as Array<Record<string, unknown>>)
    : [];

  if (technicalSlices.length > 0) {
    let targetBoard = boardSlug;
    if (channelId) {
      try {
        const { listChannelBoards } = await import('@/lib/kanban-boards');
        const boards = await listChannelBoards(channelId);
        const carrier = boards.find((b) => b.isEventCarrier) ?? boards[0];
        if (carrier?.boardSlug) {
          targetBoard = carrier.boardSlug;
        }
      } catch {
        // fallback to current boardSlug
      }
    }

    for (const slice of technicalSlices) {
      const sliceTitle = typeof slice.title === 'string' ? slice.title : `[FATIA TÉCNICA] Sub-entrega de ${parentTaskId}`;
      const sliceBody = typeof slice.body === 'string' ? slice.body : JSON.stringify(slice, null, 2);
      const assignee = typeof slice.assignee === 'string' ? slice.assignee : 'backend-engineer';
      const priority = typeof slice.priority === 'number' ? slice.priority : 5;

      insertTaskSafely(targetBoard, {
        title: sliceTitle,
        body: sliceBody,
        assignee,
        priority,
        parentId: parentTaskId,
      });
    }
  }

  // D. HK-01 Artifact Pyramid Ingestion: parses L2 analysis markdown files and commits cards to DeskRPG
  const candidatePyramids: string[] = [];
  if (typeof meta.artifact_pyramid === 'string') {
    candidatePyramids.push(meta.artifact_pyramid);
  }
  if (Array.isArray(runInfo?.artifacts)) {
    for (const a of runInfo.artifacts) {
      if (typeof a === 'string' && !candidatePyramids.includes(a)) {
        candidatePyramids.push(a);
      }
    }
  }
  if (runInfo?.summary) {
    const match = runInfo.summary.match(/(\/[^\s\n]+\/(?:00-index\.md|[a-zA-Z0-9_-]+-decomposition[^\s\n]*))/);
    if (match && !candidatePyramids.includes(match[1])) {
      candidatePyramids.push(match[1]);
    }
  }

  const affectedBoards = new Set<string>();
  let totalCardsCommitted = 0;

  for (const candidate of candidatePyramids) {
    const slices = parseArtifactPyramidSlices(candidate);
    for (const slice of slices) {
      const destBoard = slice.targetBoard || boardSlug;
      const res = insertTaskSafely(destBoard, {
        title: slice.title,
        body: slice.body,
        assignee: slice.assignee,
        priority: slice.priority,
        parentId: parentTaskId,
      });
      if (res.success && res.taskId) {
        affectedBoards.add(destBoard);
        totalCardsCommitted++;
      }
    }
  }

  // Kickstart workers on affected boards immediately
  if (affectedBoards.size > 0) {
    console.log(
      `[autonomous-hooks] Committed ${totalCardsCommitted} cards across boards [${Array.from(affectedBoards).join(', ')}]. Spawning dispatchers...`
    );
    for (const destBoard of affectedBoards) {
      try {
        spawn('hermes', ['kanban', '--board', destBoard, 'dispatch'], {
          detached: true,
          stdio: 'ignore',
        }).unref();
      } catch (err) {
        console.warn(`[autonomous-hooks] Failed to spawn hermes dispatch for ${destBoard}:`, err);
      }
    }
  }
}

export function normalizeSemanticTitle(title: string): string {
  return (title || '')
    .toLowerCase()
    .replace(/\[.*?\]/g, '') // strip tag brackets like [P0-OWNER-TRIAGE], [INCIDENT], etc.
    .replace(/t_[a-f0-9]{8,12}/g, '') // strip task IDs
    .replace(/#[0-9]+/g, '') // strip numbers
    .replace(/[^\p{L}\p{N}\s]/gu, ' ') // strip punctuation
    .replace(/\s+/g, ' ')
    .trim();
}

export function ensureBoardAntiFloodTriggers(sqlite: ReturnType<typeof getSqliteDatabase>): void {
  try {
    sqlite.exec(`
      CREATE TRIGGER IF NOT EXISTS trg_antiflood_active_limit
      BEFORE INSERT ON tasks
      FOR EACH ROW
      WHEN NEW.status IN ('ready', 'running', 'blocked', 'review', 'todo')
      BEGIN
          SELECT CASE
              WHEN (SELECT COUNT(*) FROM tasks WHERE status IN ('ready', 'running', 'blocked', 'review') AND id != NEW.id) >= 20
              THEN RAISE(ABORT, '[ANTI-FLOOD-GATE] Hard limit of 20 active tasks reached on this board.')
          END;
      END;
      CREATE TRIGGER IF NOT EXISTS trg_antiflood_title_dedup
      BEFORE INSERT ON tasks
      FOR EACH ROW
      WHEN NEW.status IN ('ready', 'running', 'blocked', 'review', 'todo')
       AND NEW.body NOT LIKE '%<!-- alertmanager-fingerprint:%'
      BEGIN
          SELECT CASE
              WHEN (SELECT COUNT(*) FROM tasks WHERE title = NEW.title AND status NOT IN ('done', 'archived') AND id != NEW.id) >= 1
              THEN RAISE(ABORT, '[ANTI-FLOOD-GATE] An active task with this exact title already exists on this board.')
          END;
      END;
    `);
  } catch {}
}

export function insertTaskSafely(
  boardSlug: string,
  spec: {
    title: string;
    body: string;
    assignee: string;
    priority: number;
    parentId: string;
    wipLimit?: number;
    initialStatus?: 'todo' | 'ready';
    /** Optional stable marker used by event consumers to deduplicate active tasks. */
    dedupKey?: string;
    /** Comment and event payload to append when an active dedupKey match is found. */
    updateComment?: string;
    /** Test-only/embedded callers may provide an isolated SQLite database. */
    databasePath?: string;
    workspaceKind?: 'scratch' | 'worktree' | 'dir';
    workspacePath?: string;
    projectId?: string;
    bypassWipLimit?: boolean;
  }
): { success: boolean; taskId?: string; reason?: string } {
  let sqlite: ReturnType<typeof getSqliteDatabase> | null = null;
  let transactionOpen = false;
  try {
    const dbPath = spec.databasePath ?? path.join(os.homedir(), '.hermes', 'kanban', 'boards', boardSlug, 'kanban.db');
    if (!fs.existsSync(dbPath)) return { success: false, reason: 'board_db_not_found' };

    sqlite = getSqliteDatabase(dbPath);
    // Serialize the deduplication read with the eventual insert. Without this, two concurrent
    // Alertmanager retries can both observe no matching task and create duplicate incidents.
    sqlite.exec('BEGIN IMMEDIATE');
    transactionOpen = true;

    // Ensure dedupKey is permanently stamped in body so future queries find it deterministically
    let finalBody = spec.body || '';
    if (spec.dedupKey && !finalBody.includes(spec.dedupKey)) {
      finalBody = finalBody ? `${finalBody}\n\n<!-- dedupKey: ${spec.dedupKey} -->` : `<!-- dedupKey: ${spec.dedupKey} -->`;
    }

    ensureBoardAntiFloodTriggers(sqlite);

    let existing: { id?: string } | undefined;
    if (spec.dedupKey) {
      existing = sqlite
        .prepare("SELECT id FROM tasks WHERE status NOT IN ('done', 'archived') AND body LIKE ? LIMIT 1")
        .get(`%${spec.dedupKey}%`) as { id?: string } | undefined;
    }

    // 1. Exact title idempotency check (only when caller has not provided an explicit dedupKey)
    if (!existing && !spec.dedupKey) {
      existing = sqlite
        .prepare("SELECT id FROM tasks WHERE status NOT IN ('done', 'archived') AND title = ? LIMIT 1")
        .get(spec.title) as { id?: string } | undefined;
    }

    // 2. Normalized semantic title check for triage and automated cards (only when caller has not provided an explicit dedupKey)
    if (!existing && !spec.dedupKey) {
      const normalizedNew = normalizeSemanticTitle(spec.title);
      if (normalizedNew.length >= 8 && /triagem|triage|env-fix|reparar|alerta|incident/i.test(spec.title)) {
        const activeRows = sqlite
          .prepare("SELECT id, title FROM tasks WHERE status NOT IN ('done', 'archived')")
          .all() as Array<{ id: string; title: string }>;
        for (const row of activeRows) {
          if (normalizeSemanticTitle(row.title) === normalizedNew) {
            existing = { id: row.id };
            break;
          }
        }
      }
    }

    if (existing?.id) {
      if (spec.updateComment) {
        const now = Math.floor(Date.now() / 1000);
        try {
          sqlite
            .prepare('INSERT INTO task_comments (task_id, author, body, created_at) VALUES (?, ?, ?, ?)')
            .run(existing.id, 'alertmanager-webhook', spec.updateComment, now);
        } catch (commentErr) {
          console.warn(`[autonomous-hooks] Failed to append dedup comment for ${existing.id}:`, commentErr);
        }
        try {
          sqlite
            .prepare(
              "INSERT INTO task_events (task_id, run_id, kind, payload, created_at) VALUES (?, NULL, 'updated', ?, ?)"
            )
            .run(
              existing.id,
              JSON.stringify({ source: 'alertmanager-webhook', action: 'deduplicated', dedupKey: spec.dedupKey }),
              now
            );
        } catch (eventErr) {
          console.warn(`[autonomous-hooks] Failed to append dedup event for ${existing.id}:`, eventErr);
        }
      }
      sqlite.exec('COMMIT');
      transactionOpen = false;
      console.log(`[autonomous-hooks] Active task deduplicated on ${boardSlug}: "${spec.title}" (id: ${existing.id})`);
      return { success: true, taskId: existing.id, reason: 'updated_existing' };
    }

    const now = Math.floor(Date.now() / 1000);
    const isEmergencyP0 = spec.priority >= 9 || spec.bypassWipLimit === true;

    // --- ANTI-FLOOD LAYER 1: Regular WIP Limit Check ---
    const wipLimit = spec.wipLimit ?? 5;
    const activeRow = sqlite
      .prepare("SELECT count(*) as count FROM tasks WHERE status IN ('ready', 'running', 'review')")
      .get() as { count?: number } | undefined;
    const activeCount = Number(activeRow?.count ?? 0);
    if (!isEmergencyP0 && activeCount >= wipLimit) {
      const reason = `WIP limit exceeded on board "${boardSlug}": ${activeCount} active tasks (limit is ${wipLimit})`;
      sqlite.exec('ROLLBACK');
      transactionOpen = false;
      console.warn(`[autonomous-hooks] Task creation blocked by WIP: ${reason}`);
      return { success: false, reason };
    }

    // --- ANTI-FLOOD LAYER 2: Hard Board Active Task Ceiling (Iron Cap) ---
    const totalActiveRow = sqlite
      .prepare("SELECT count(*) as count FROM tasks WHERE status IN ('ready', 'running', 'review', 'blocked', 'todo')")
      .get() as { count?: number } | undefined;
    const totalActiveCount = Number(totalActiveRow?.count ?? 0);
    const HARD_CEILING = isEmergencyP0 ? 20 : 15;
    if (totalActiveCount >= HARD_CEILING) {
      const reason = `[ANTI-FLOOD-GATE] Hard active task ceiling reached on board "${boardSlug}": ${totalActiveCount} active tasks (max ceiling is ${HARD_CEILING}).`;
      sqlite.exec('ROLLBACK');
      transactionOpen = false;
      console.warn(`[autonomous-hooks] Task creation blocked by hard ceiling: ${reason}`);
      return { success: false, reason };
    }

    // --- ANTI-FLOOD LAYER 3: Sliding-Window Rate Limiter (Max 5 tasks per 5 minutes) ---
    const recentWindowSeconds = 300;
    const recentRow = sqlite
      .prepare("SELECT count(*) as count FROM tasks WHERE created_at >= ?")
      .get(now - recentWindowSeconds) as { count?: number } | undefined;
    const recentCount = Number(recentRow?.count ?? 0);
    if (!isEmergencyP0 && recentCount >= 5) {
      const reason = `[ANTI-FLOOD-GATE] Rate limit exceeded on board "${boardSlug}": ${recentCount} tasks created in the last 5 minutes. Cooling down.`;
      sqlite.exec('ROLLBACK');
      transactionOpen = false;
      console.warn(`[autonomous-hooks] Task creation blocked by rate limiter: ${reason}`);
      return { success: false, reason };
    }

    const taskId = 't_' + randomUUID().replace(/-/g, '').slice(0, 8);
    const status = spec.initialStatus ?? 'ready';

    const resolvedWs = resolveWorkspaceForTask(boardSlug, {
      title: spec.title,
      body: finalBody,
      assignee: spec.assignee,
      workspaceKind: spec.workspaceKind,
      workspacePath: spec.workspacePath,
      projectId: spec.projectId,
    });

    const columns = (sqlite.prepare('PRAGMA table_info(tasks)').all() as Array<{ name: string }>).map((c) => c.name);
    const hasWsPath = columns.includes('workspace_path');
    const hasProjId = columns.includes('project_id');
    const hasModelOverride = columns.includes('model_override');
    const hasProviderOverride = columns.includes('provider_override');

    if (hasWsPath && hasProjId && hasModelOverride && hasProviderOverride) {
      sqlite
        .prepare(
          `INSERT INTO tasks (id, title, body, assignee, status, priority, created_by, created_at, workspace_kind, workspace_path, project_id, model_override, provider_override)
           VALUES (?, ?, ?, ?, ?, ?, 'autonomous-hook', ?, ?, ?, ?, NULL, NULL)`
        )
        .run(
          taskId,
          spec.title,
          finalBody,
          spec.assignee,
          status,
          spec.priority,
          now,
          resolvedWs.workspaceKind,
          resolvedWs.workspacePath,
          resolvedWs.projectId
        );
    } else if (hasWsPath && hasProjId) {
      sqlite
        .prepare(
          `INSERT INTO tasks (id, title, body, assignee, status, priority, created_by, created_at, workspace_kind, workspace_path, project_id)
           VALUES (?, ?, ?, ?, ?, ?, 'autonomous-hook', ?, ?, ?, ?)`
        )
        .run(
          taskId,
          spec.title,
          finalBody,
          spec.assignee,
          status,
          spec.priority,
          now,
          resolvedWs.workspaceKind,
          resolvedWs.workspacePath,
          resolvedWs.projectId
        );
    } else {
      sqlite
        .prepare(
          `INSERT INTO tasks (id, title, body, assignee, status, priority, created_by, created_at, workspace_kind)
           VALUES (?, ?, ?, ?, ?, ?, 'autonomous-hook', ?, ?)`
        )
        .run(taskId, spec.title, finalBody, spec.assignee, status, spec.priority, now, resolvedWs.workspaceKind);
    }

    // Link parent
    try {
      sqlite
        .prepare('INSERT INTO task_links (parent_id, child_id, created_at) VALUES (?, ?, ?)')
        .run(spec.parentId, taskId, now);
    } catch {
      // ignore link collision
    }

    sqlite.exec('COMMIT');
    transactionOpen = false;

    console.log(
      `[autonomous-hooks] Created task ${taskId} on board ${boardSlug}: "${spec.title}" (status: ${status}, assignee: ${spec.assignee}, workspace: ${resolvedWs.workspaceKind} @ ${resolvedWs.workspacePath})`
    );
    return { success: true, taskId };
  } catch (err: unknown) {
    if (transactionOpen && sqlite) {
      try {
        sqlite.exec('ROLLBACK');
      } catch {
        // Preserve the original insertion error.
      }
    }
    console.warn(`[autonomous-hooks] Failed to insert task on ${boardSlug}:`, err);
    return { success: false, reason: err instanceof Error ? err.message : String(err) };
  }
}

export interface ActiveSessionEntry {
  lease_id?: string;
  pid?: number | string;
  session_id?: string;
  [key: string]: unknown;
}

/**
 * Sentinela de Concorrência e Sessões:
 * Scans active_sessions.json in all profiles and prunes stale leases whose PIDs are no longer alive.
 */
export function cleanOrphanSessionLeases(hermesHome?: string): number {
  const home = hermesHome ?? path.join(os.homedir(), '.hermes');
  const profilesDir = path.join(home, 'profiles');
  let cleanedCount = 0;
  const dirsToCheck: string[] = [];
  if (fs.existsSync(profilesDir)) {
    try {
      const entries = fs.readdirSync(profilesDir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory()) {
          dirsToCheck.push(path.join(profilesDir, entry.name));
        }
      }
    } catch {}
  }
  dirsToCheck.push(home);

  for (const dir of dirsToCheck) {
    const activePath = path.join(dir, 'runtime', 'active_sessions.json');
    if (!fs.existsSync(activePath)) continue;
    try {
      const raw = fs.readFileSync(activePath, 'utf8');
      const data = JSON.parse(raw) as { entries?: ActiveSessionEntry[] };
      if (!Array.isArray(data.entries) || data.entries.length === 0) continue;
      const alive: ActiveSessionEntry[] = [];
      let profileCleaned = 0;
      for (const entry of data.entries) {
        const pid = Number(entry.pid);
        if (!pid) continue;
        let isAlive = false;
        try {
          process.kill(pid, 0);
          isAlive = true;
        } catch {
          isAlive = false;
        }
        if (isAlive) {
          alive.push(entry);
        } else {
          profileCleaned++;
        }
      }
      if (profileCleaned > 0) {
        data.entries = alive;
        fs.writeFileSync(activePath, JSON.stringify(data, null, 2), 'utf8');
        cleanedCount += profileCleaned;
      }
    } catch {}
  }
  return cleanedCount;
}

export interface BlockerTriageResult {
  action:
    | 'workspace_remediated'
    | 'env_fix_dispatched'
    | 'needs_input_dispatched'
    | 'session_cleaned'
    | 'quota_model_remediated'
    | 'owner_triage_dispatched'
    | 'owner_triage_aggregated'
    | 'none';
  remediatedTaskId?: string;
  spawnedTaskId?: string;
  details?: string;
}

export interface BlockerTaskRow {
  id: string;
  title: string;
  body: string | null;
  assignee: string | null;
  status: string;
  priority: number;
  block_kind: string | null;
  last_failure_error: string | null;
  workspace_kind: 'scratch' | 'worktree' | 'dir';
  workspace_path: string | null;
  project_id: string | null;
}

/**
 * HK-08: BlockerTriageHook — Active Automated Triage of Blocked Cards
 *
 * Diagnoses why a task blocked and summons the specialized role or applies auto-remediation:
 * - Scratch workspace empty: converts to worktree/dir pointing to the project repository and unblocks.
 * - Broken environment (.venv, missing libs): creates P0 repair card for platform-engineer / SRE and gates original task.
 * - needs_input: creates P0 decision card for product-manager / orchestrator to clarify acceptance criteria.
 * - Session saturation (6/6) or invalid model: cleans dead session leases, clears invalid model override, resets to ready.
 */
export async function executeBlockerTriageLifecycle(args: {
  channelId: string;
  boardSlug: string;
  taskId: string;
  cardTitle: string;
  assignee: string | null;
  emitRoomMessage?: (roomId: string, message: RoomMessage) => void;
  databasePath?: string;
  bypassDispatchSpawn?: boolean;
}): Promise<BlockerTriageResult> {
  const { channelId, boardSlug, taskId, cardTitle, assignee, emitRoomMessage } = args;
  const dbPath = args.databasePath ?? path.join(os.homedir(), '.hermes', 'kanban', 'boards', boardSlug, 'kanban.db');
  if (!fs.existsSync(dbPath)) {
    return { action: 'none', details: 'board_db_not_found' };
  }

  let sqlite: ReturnType<typeof getSqliteDatabase> | null = null;
  try {
    sqlite = getSqliteDatabase(dbPath);
  } catch (err: unknown) {
    return { action: 'none', details: `db_open_failed: ${err instanceof Error ? err.message : String(err)}` };
  }

  const taskRow = sqlite
    .prepare(
      'SELECT id, title, body, assignee, status, priority, block_kind, last_failure_error, workspace_kind, workspace_path, project_id FROM tasks WHERE id = ?'
    )
    .get(taskId) as BlockerTaskRow | undefined;

  if (!taskRow) {
    return { action: 'none', details: 'task_not_found' };
  }

  // --- RECURSION GUARD: Prevent Infinite Recursive Triage Chains ---
  const isAlreadyTriageTask =
    /\[(?:P0-OWNER-TRIAGE|P0-DECISÃO|P0-ENV-FIX|EPIC-TRIAGE)\]|triagem executiva/i.test(
      taskRow.title
    );
  if (isAlreadyTriageTask) {
    console.warn(
      `[autonomous-hooks] Refusing recursive triage for already-triaged task ${taskId} ("${taskRow.title}")`
    );
    sqlite
      .prepare(
        "UPDATE tasks SET block_kind = 'quarantine' WHERE id = ?"
      )
      .run(taskId);
    return { action: 'none', details: 'recursive_triage_prevented' };
  }

  const eventRow = sqlite
    .prepare(
      "SELECT payload FROM task_events WHERE task_id = ? AND kind = 'blocked' ORDER BY created_at DESC LIMIT 1"
    )
    .get(taskId) as { payload?: string } | undefined;

  let eventPayload: Record<string, unknown> = {};
  if (eventRow?.payload) {
    try {
      eventPayload = JSON.parse(eventRow.payload) as Record<string, unknown>;
    } catch {}
  }

  const blockKind = String(eventPayload.kind || taskRow.block_kind || '').toLowerCase();
  const blockReason = [
    eventPayload.reason ?? '',
    taskRow.last_failure_error ?? '',
    taskRow.body ?? '',
  ].join(' ');

  const tacticalRoom = await resolveTacticalRoomId(channelId, assignee);
  const now = Math.floor(Date.now() / 1000);

  // --- Branch A: Scratch workspace empty or missing git repo ---
  const isScratchIssue =
    taskRow.workspace_kind === 'scratch' ||
    /workspace.*scratch.*(?:vazio|empty)|scratch.*vazio|sem checkout|nenhum checkout|não contém checkout|empty workspace|not inside a git repo|workspace scratch está vazio|workspace está vazio/i.test(
      blockReason
    );

  if (isScratchIssue) {
    const resolved = resolveWorkspaceForTask(boardSlug, {
      title: taskRow.title,
      body: taskRow.body ?? undefined,
      assignee: taskRow.assignee ?? undefined,
    });

    if (resolved.workspacePath && resolved.workspaceKind !== 'scratch') {
      sqlite
        .prepare(
          `UPDATE tasks
           SET workspace_kind = ?,
               workspace_path = ?,
               project_id = ?,
               status = 'ready',
               block_kind = NULL,
               last_failure_error = NULL
           WHERE id = ?`
        )
        .run(resolved.workspaceKind, resolved.workspacePath, resolved.projectId, taskId);

      try {
        sqlite
          .prepare(
            'INSERT INTO task_comments (task_id, author, body, created_at) VALUES (?, ?, ?, ?)'
          )
          .run(
            taskId,
            'blocker-triage-hook',
            `[BlockerTriageHook] Workspace efêmero 'scratch' convertido automaticamente para '${resolved.workspaceKind}' no repositório ${resolved.workspacePath} (projeto: ${resolved.projectId}). Card promovido para 'ready'.`,
            now
          );
        sqlite
          .prepare(
            "INSERT INTO task_events (task_id, run_id, kind, payload, created_at) VALUES (?, NULL, 'unblocked', ?, ?)"
          )
          .run(
            taskId,
            JSON.stringify({
              reason: 'auto_healed_scratch_workspace_to_worktree',
              project_id: resolved.projectId,
              workspace_path: resolved.workspacePath,
              workspace_kind: resolved.workspaceKind,
            }),
            now
          );
      } catch (e) {
        console.warn(`[autonomous-hooks] Failed to record unblock event:`, e);
      }

      if (tacticalRoom) {
        const content =
          `🔧 **[AUTO-REMEDIAÇÃO DE WORKSPACE]** \`${taskId}\` — ${cardTitle}\n` +
          `Workspace efêmero scratch convertido para \`${resolved.workspaceKind}\` em \`${resolved.workspacePath}\`.\n` +
          `Status redefinido para **ready** — agente relançado automaticamente!`;
        try {
          const msg = await appendRoomMessage({
            roomId: tacticalRoom.roomId,
            senderKind: 'system',
            senderId: null,
            senderName: 'Blocker Triage Sentinel',
            content,
            notice: {
              kind: 'card_done',
              cardId: taskId,
              cardTitle,
              boardSlug,
              npcName: assignee ?? 'system',
            },
          });
          if (emitRoomMessage) emitRoomMessage(tacticalRoom.roomId, msg);
        } catch {}
      }

      if (!args.bypassDispatchSpawn) {
        try {
          spawn('hermes', ['kanban', '--board', boardSlug, 'dispatch'], {
            detached: true,
            stdio: 'ignore',
          }).unref();
        } catch {}
      }

      return {
        action: 'workspace_remediated',
        remediatedTaskId: taskId,
        details: `Converted to ${resolved.workspaceKind} at ${resolved.workspacePath}`,
      };
    }
  }

  // --- Branch B: Broken environment / missing dependencies (.venv, missing libs, daphne, etc.) ---
  const isEnvIssue =
    /import(?:error)?:\s*no module named|modulenotfounderror|\b(?:daphne|django_extensions)\b|poetry.*not found|broken environment|missing dependency|depend[êe]ncia.*ausente/i.test(
      blockReason
    );

  if (isEnvIssue) {
    const dedupKey = `env-fix-${boardSlug}`;
    const insertRes = insertTaskSafely(boardSlug, {
      title: `[P0-ENV-FIX] Reparar ambiente virtual e dependências para ${taskId} (${boardSlug})`,
      body:
        `Tarefa P0 criada automaticamente pelo BlockerTriageHook devido a falha de dependências/ambiente no card ${taskId} ("${cardTitle}").\n\n` +
        `Erro identificado:\n\`\`\`\n${blockReason.slice(0, 1000)}\n\`\`\`\n\n` +
        `Ação para @platform-engineer / @site-reliability-engineer:\n` +
        `1. Reparar .venv/poetry/pip e dependências ausentes no repositório.\n` +
        `2. Rodar a suíte de testes unitários para validar a integridade.\n` +
        `3. Finalizar este card para desbloquear automaticamente a tarefa dependente ${taskId}.`,
      assignee: 'platform-engineer',
      priority: 10,
      parentId: taskId,
      dedupKey,
      databasePath: args.databasePath,
    });

    if (insertRes.success && insertRes.taskId) {
      try {
        sqlite
          .prepare('INSERT OR IGNORE INTO task_links (parent_id, child_id, created_at) VALUES (?, ?, ?)')
          .run(insertRes.taskId, taskId, now);
        sqlite.prepare("UPDATE tasks SET status = 'todo', block_kind = 'dependency' WHERE id = ?").run(taskId);
      } catch (e) {
        console.warn(`[autonomous-hooks] Failed to link dependency task:`, e);
      }

      if (tacticalRoom) {
        const content =
          `🛠️ **[AUTO-TRIAGEM DE AMBIENTE]** \`${taskId}\` — ${cardTitle}\n` +
          `Detectada quebra de dependências no ambiente (.venv/libs).\n` +
          `Card de reparo P0 \`${insertRes.taskId}\` criado para @platform-engineer. Card original aguardando correção na fila.`;
        try {
          const msg = await appendRoomMessage({
            roomId: tacticalRoom.roomId,
            senderKind: 'system',
            senderId: null,
            senderName: 'Blocker Triage Sentinel',
            content,
            notice: {
              kind: 'card_blocked',
              cardId: taskId,
              cardTitle,
              boardSlug,
              npcName: assignee ?? 'system',
            },
          });
          if (emitRoomMessage) emitRoomMessage(tacticalRoom.roomId, msg);
        } catch {}
      }

      if (!args.bypassDispatchSpawn) {
        try {
          spawn('hermes', ['kanban', '--board', boardSlug, 'dispatch'], {
            detached: true,
            stdio: 'ignore',
          }).unref();
        } catch {}
      }

      return {
        action: 'env_fix_dispatched',
        remediatedTaskId: taskId,
        spawnedTaskId: insertRes.taskId,
        details: `Dispatched env fix card ${insertRes.taskId}`,
      };
    }
  }

  // --- Branch C: needs_input / Acceptance Criteria Ambiguity ---
  const isNeedsInput =
    blockKind === 'needs_input' ||
    (blockKind !== 'capability' &&
      /needs_input|aguardando.*decis|conversão orgânica|compra teste autorizada|ambiguidade de aceite/i.test(
        blockReason
      ));

  if (isNeedsInput) {
    const dedupKey = `needs-input-${taskId}`;
    const insertRes = insertTaskSafely(boardSlug, {
      title: `[P0-DECISÃO] Desbloquear especificação / critério de aceite para ${taskId}`,
      body:
        `O card ${taskId} ("${cardTitle}") foi paralisado por 'needs_input' / ambiguidade de aceite.\n\n` +
        `Motivo do bloqueio registrado:\n${blockReason.slice(0, 1500)}\n\n` +
        `Instruções para @product-manager / @orchestrator:\n` +
        `1. Avaliar se o critério de aceite exige intervenção física externa ou validação de compra teste.\n` +
        `2. Ajustar os critérios de aceite do card ${taskId} para permitir simulação aprovada ou sign-off alternativo.\n` +
        `3. Emitir kanban_unblock para liberar a esteira autônoma.`,
      assignee: 'product-manager',
      priority: 10,
      parentId: taskId,
      dedupKey,
      databasePath: args.databasePath,
    });

    if (insertRes.success && insertRes.taskId) {
      if (tacticalRoom) {
        const content =
          `📋 **[AUTO-TRIAGEM PRODUCT OFFICE]** \`${taskId}\` — ${cardTitle}\n` +
          `Paralisado por critério externo ('needs_input').\n` +
          `Card de decisão P0 \`${insertRes.taskId}\` atribuído a @product-manager para redefinir aceite e destravar a execução.`;
        try {
          const msg = await appendRoomMessage({
            roomId: tacticalRoom.roomId,
            senderKind: 'system',
            senderId: null,
            senderName: 'Blocker Triage Sentinel',
            content,
            notice: {
              kind: 'card_blocked',
              cardId: taskId,
              cardTitle,
              boardSlug,
              npcName: assignee ?? 'system',
            },
          });
          if (emitRoomMessage) emitRoomMessage(tacticalRoom.roomId, msg);
        } catch {}
      }

      if (!args.bypassDispatchSpawn) {
        try {
          spawn('hermes', ['kanban', '--board', boardSlug, 'dispatch'], {
            detached: true,
            stdio: 'ignore',
          }).unref();
        } catch {}
      }

      return {
        action: 'needs_input_dispatched',
        remediatedTaskId: taskId,
        spawnedTaskId: insertRes.taskId,
        details: `Dispatched decision card ${insertRes.taskId}`,
      };
    }
  }

  // --- Branch D: Quota, HTTP 429, session ceiling 6/6 or invalid model override ---
  const isQuotaOrModelOrSession =
    /active session limit|model.*not supported|gpt-5\.3-codex-spark|quota|rate.*limit|http\s*429|too many requests|insufficient_quota|resource_exhausted/i.test(
      blockReason
    ) ||
    blockKind === 'quota' ||
    blockKind === 'model' ||
    blockKind === 'transient';

  if (isQuotaOrModelOrSession) {
    const cleaned = cleanOrphanSessionLeases();
    sqlite
      .prepare(
        `UPDATE tasks
         SET model_override = NULL,
             provider_override = NULL,
             status = 'ready',
             block_kind = NULL,
             last_failure_error = NULL
         WHERE id = ?`
      )
      .run(taskId);

    try {
      sqlite
        .prepare('INSERT INTO task_comments (task_id, author, body, created_at) VALUES (?, ?, ?, ?)')
        .run(
          taskId,
          'blocker-triage-hook',
          `[BlockerTriageHook] Quota / modelo / saturação de sessão auto-remediado: overrides limpos, status resetado para 'ready'.`,
          now
        );
      sqlite
        .prepare(
          "INSERT INTO task_events (task_id, run_id, kind, payload, created_at) VALUES (?, NULL, 'unblocked', ?, ?)"
        )
        .run(
          taskId,
          JSON.stringify({
            reason: 'quota_model_session_auto_remediated',
            cleaned_leases: cleaned,
          }),
          now
        );
    } catch (e) {
      console.warn(`[autonomous-hooks] Failed to record unblock event:`, e);
    }

    if (tacticalRoom) {
      const content =
        `⚡ **[SENTINELA DE QUOTA / MODELO / SESSÃO]** \`${taskId}\` — ${cardTitle}\n` +
        `Detectada saturação de sessões, quota ou modelo incompatível.\n` +
        `Limpos ${cleaned} leases órfãos, resetado override para o modelo estável do perfil e card retornado a **ready**.`;
      try {
        const msg = await appendRoomMessage({
          roomId: tacticalRoom.roomId,
          senderKind: 'system',
          senderId: null,
          senderName: 'Blocker Triage Sentinel',
          content,
          notice: {
            kind: 'card_done',
            cardId: taskId,
            cardTitle,
            boardSlug,
            npcName: assignee ?? 'system',
          },
        });
        if (emitRoomMessage) emitRoomMessage(tacticalRoom.roomId, msg);
      } catch {}
    }

    if (!args.bypassDispatchSpawn) {
      try {
        spawn('hermes', ['kanban', '--board', boardSlug, 'dispatch'], {
          detached: true,
          stdio: 'ignore',
        }).unref();
      } catch {}
    }

    return {
      action: 'quota_model_remediated',
      remediatedTaskId: taskId,
      details: `Cleaned ${cleaned} orphan sessions, cleared model/provider overrides, moved to ready`,
    };
  }

  // --- Branch E: Capability / Owner-Gated / Hard Blocker / Fallback Triage (L3) ---
  // Board-level triage cap: If an open triage card already exists on this board, aggregate into it
  const existingBoardTriage = sqlite
    .prepare(
      "SELECT id, title FROM tasks WHERE status NOT IN ('done', 'archived') AND (title LIKE '%[P0-OWNER-TRIAGE]%' OR title LIKE '%[EPIC-TRIAGE]%') LIMIT 1"
    )
    .get() as { id: string; title: string } | undefined;

  if (existingBoardTriage && existingBoardTriage.id !== taskId) {
    try {
      sqlite
        .prepare('INSERT OR IGNORE INTO task_links (parent_id, child_id, created_at) VALUES (?, ?, ?)')
        .run(existingBoardTriage.id, taskId, now);
      sqlite
        .prepare('INSERT INTO task_comments (task_id, author, body, created_at) VALUES (?, ?, ?, ?)')
        .run(
          existingBoardTriage.id,
          'blocker-triage-sentinel',
          `⚠️ [NOVO BLOQUEIO AGREGADO] O card ${taskId} ("${cardTitle}") também bloqueou em L3 e foi vinculado a esta triagem existente.`,
          now
        );
    } catch {}

    return {
      action: 'owner_triage_aggregated',
      remediatedTaskId: taskId,
      spawnedTaskId: existingBoardTriage.id,
      details: `Aggregated into existing board triage card ${existingBoardTriage.id}`,
    };
  }

  const dedupKey = `owner-triage-${taskId}`;
  const insertRes = insertTaskSafely(boardSlug, {
    title: `[P0-OWNER-TRIAGE] Triagem executiva L3 para card bloqueado ${taskId}`,
    body:
      `O card ${taskId} ("${cardTitle}") foi paralisado em nível L3 (Owner-Gated / Capability).\n\n` +
      `Motivo do bloqueio registrado:\n\`\`\`\n${blockReason.slice(0, 1500)}\n\`\`\`\n\n` +
      `Instruções para @product-manager / @orchestrator (Nível L3):\n` +
      `1. Analisar se o bloqueio decorre de credenciais de terceiros, autorização financeira ou escopo restrito ao Soberano.\n` +
      `2. Caso viável via contorno técnico, delegar para o especialista competente com novo plano.\n` +
      `3. Se exigir decisão do Soberano, consolidar a síntese executiva na sala War Room / Ops Control.\n` +
      `4. Executar kanban_unblock no card original ${taskId} após resolução.`,
    assignee: 'product-manager',
    priority: 10,
    parentId: taskId,
    dedupKey,
    databasePath: args.databasePath,
  });

  if (insertRes.success && insertRes.taskId) {
    try {
      sqlite
        .prepare('INSERT OR IGNORE INTO task_links (parent_id, child_id, created_at) VALUES (?, ?, ?)')
        .run(insertRes.taskId, taskId, now);
    } catch (e) {
      console.warn(`[autonomous-hooks] Failed to link owner triage task:`, e);
    }

    if (tacticalRoom) {
      const content =
        `🚨 **[AUTO-TRIAGEM EXECUTIVA L3]** \`${taskId}\` — ${cardTitle}\n` +
        `Card paralisado por restrição estrutural/capability.\n` +
        `Card de triagem P0 \`${insertRes.taskId}\` atribuído a @product-manager para deliberação executiva.`;
      try {
        const msg = await appendRoomMessage({
          roomId: tacticalRoom.roomId,
          senderKind: 'system',
          senderId: null,
          senderName: 'Blocker Triage Sentinel',
          content,
          notice: {
            kind: 'card_blocked',
            cardId: taskId,
            cardTitle,
            boardSlug,
            npcName: assignee ?? 'system',
          },
        });
        if (emitRoomMessage) emitRoomMessage(tacticalRoom.roomId, msg);
      } catch {}
    }

    if (!args.bypassDispatchSpawn) {
      try {
        spawn('hermes', ['kanban', '--board', boardSlug, 'dispatch'], {
          detached: true,
          stdio: 'ignore',
        }).unref();
      } catch {}
    }

    return {
      action: 'owner_triage_dispatched',
      remediatedTaskId: taskId,
      spawnedTaskId: insertRes.taskId,
      details: `Dispatched L3 owner triage card ${insertRes.taskId} for blocked task ${taskId}`,
    };
  }

  return { action: 'none', details: 'no_matching_triage_rule' };
}

/**
 * HK-09: QuotaModelSentinelHook — Proactive Sentinel for Quota, Models & Session Cleanups
 *
 * Deterministic audit executed reactively or via 15-minute cron:
 * 1. Cleans orphan session leases across active profiles.
 * 2. Purges model_override and provider_override to enforce profile-level model inheritance.
 * 3. Identifies cards in 'blocked' caused by quota, HTTP 429, session limit or invalid model,
 *    clears their failure states and auto-unblocks them to 'ready'.
 */
export interface QuotaModelSentinelResult {
  inspectedBoard: string;
  clearedOverridesCount: number;
  unblockedTasksCount: number;
  remediatedTaskIds: string[];
}

export function executeQuotaModelSentinelLifecycle(args: {
  boardSlug: string;
  databasePath?: string;
  bypassDispatchSpawn?: boolean;
}): QuotaModelSentinelResult {
  const { boardSlug } = args;
  const dbPath = args.databasePath ?? path.join(os.homedir(), '.hermes', 'kanban', 'boards', boardSlug, 'kanban.db');
  if (!fs.existsSync(dbPath)) {
    return {
      inspectedBoard: boardSlug,
      clearedOverridesCount: 0,
      unblockedTasksCount: 0,
      remediatedTaskIds: [],
    };
  }

  const sqlite = getSqliteDatabase(dbPath);
  cleanOrphanSessionLeases();
  const now = Math.floor(Date.now() / 1000);

  // 1. Clear model and provider overrides
  const columns = (sqlite.prepare('PRAGMA table_info(tasks)').all() as Array<{ name: string }>).map((c) => c.name);
  let clearedOverridesCount = 0;
  if (columns.includes('model_override') && columns.includes('provider_override')) {
    const info = sqlite
      .prepare(
        `UPDATE tasks
         SET model_override = NULL,
             provider_override = NULL
         WHERE model_override IS NOT NULL OR provider_override IS NOT NULL`
      )
      .run();
    clearedOverridesCount = Number(info.changes || 0);
  }

  // 2. Identify blocked tasks by quota, 429, session limit, or invalid model
  const blockedRows = sqlite
    .prepare(`SELECT id, title, block_kind, last_failure_error FROM tasks WHERE status = 'blocked'`)
    .all() as Array<{ id: string; title: string; block_kind: string | null; last_failure_error: string | null }>;

  const remediatedTaskIds: string[] = [];
  for (const row of blockedRows) {
    const reason = `${row.block_kind ?? ''} ${row.last_failure_error ?? ''}`.toLowerCase();
    const isQuotaOrModel =
      row.block_kind === 'quota' ||
      row.block_kind === 'model' ||
      row.block_kind === 'transient' ||
      /quota|rate.*limit|http\s*429|too many requests|active session limit|resource_exhausted|insufficient_quota|model.*not supported|gpt-5\.3-codex-spark/i.test(
        reason
      );

    if (isQuotaOrModel) {
      sqlite
        .prepare(
          `UPDATE tasks
           SET status = 'ready',
               block_kind = NULL,
               last_failure_error = NULL
           WHERE id = ?`
        )
        .run(row.id);

      try {
        sqlite
          .prepare('INSERT INTO task_comments (task_id, author, body, created_at) VALUES (?, ?, ?, ?)')
          .run(
            row.id,
            'quota-model-sentinel',
            `[HK-09 QuotaModelSentinel] Auto-unblock executado e overrides limpos. Card retornado para 'ready'.`,
            now
          );
        sqlite
          .prepare(
            "INSERT INTO task_events (task_id, run_id, kind, payload, created_at) VALUES (?, NULL, 'unblocked', ?, ?)"
          )
          .run(row.id, JSON.stringify({ reason: 'sentinel_auto_unblock_quota_model' }), now);
      } catch {}

      remediatedTaskIds.push(row.id);
    }
  }

  if (remediatedTaskIds.length > 0 && !args.bypassDispatchSpawn) {
    try {
      spawn('hermes', ['kanban', '--board', boardSlug, 'dispatch'], {
        detached: true,
        stdio: 'ignore',
      }).unref();
    } catch {}
  }

  return {
    inspectedBoard: boardSlug,
    clearedOverridesCount,
    unblockedTasksCount: remediatedTaskIds.length,
    remediatedTaskIds,
  };
}
