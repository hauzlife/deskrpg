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
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';

export const PRODUCT_BOARDS = ['mystelia', 'hot-telegram', 'bloopu', 'social'] as const;
export const STARVATION_COOLDOWN_MS = 10 * 60 * 1000; // 10 minutes debounce
export const lastStarvationTrigger = new Map<string, number>();

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
            get: (...args: any[]) => stmt.get(...args),
            all: (...args: any[]) => stmt.all(...args),
            run: (...args: any[]) => stmt.run(...args),
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
  emitRoomMessage?: (roomId: string, message: any) => void;
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
  emitRoomMessage?: (roomId: string, message: any) => void;
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
  emitRoomMessage?: (roomId: string, message: any) => void;
}): Promise<boolean> {
  const { channelId, boardSlug, emitRoomMessage } = args;

  if (!PRODUCT_BOARDS.includes(boardSlug as any)) return false;

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

    let existing: { id?: string } | undefined;
    if (spec.dedupKey) {
      existing = sqlite
        .prepare("SELECT id FROM tasks WHERE status NOT IN ('done', 'archived') AND body LIKE ? LIMIT 1")
        .get(`%${spec.dedupKey}%`) as { id?: string } | undefined;

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
    }

    // WIP Limit Check (performed inside the same transaction as deduplication).
    const wipLimit = spec.wipLimit ?? 5;
    const activeRow = sqlite
      .prepare("SELECT count(*) as count FROM tasks WHERE status IN ('ready', 'running', 'review')")
      .get() as { count?: number } | undefined;
    const activeCount = Number(activeRow?.count ?? 0);
    if (activeCount >= wipLimit) {
      const reason = `WIP limit exceeded on board "${boardSlug}": ${activeCount} active tasks (limit is ${wipLimit})`;
      sqlite.exec('ROLLBACK');
      transactionOpen = false;
      console.warn(`[autonomous-hooks] Task creation blocked by WIP: ${reason}`);
      return { success: false, reason };
    }

    // Preserve title idempotency for non-alert callers. Alert callers use dedupKey so
    // distinct targets with the same human-readable summary remain independent cards.
    if (!spec.dedupKey) {
      existing = sqlite.prepare('SELECT id FROM tasks WHERE title = ?').get(spec.title) as { id?: string } | undefined;
      if (existing?.id) {
        sqlite.exec('COMMIT');
        transactionOpen = false;
        console.log(`[autonomous-hooks] Task already exists on ${boardSlug}: "${spec.title}" (id: ${existing.id})`);
        return { success: true, taskId: existing.id, reason: 'already_exists' };
      }
    }

    const taskId = 't_' + randomUUID().replace(/-/g, '').slice(0, 8);
    const now = Math.floor(Date.now() / 1000);
    const status = spec.initialStatus ?? 'ready';

    sqlite
      .prepare(
        `INSERT INTO tasks (id, title, body, assignee, status, priority, created_by, created_at, workspace_kind)
         VALUES (?, ?, ?, ?, ?, ?, 'autonomous-hook', ?, 'scratch')`
      )
      .run(taskId, spec.title, spec.body, spec.assignee, status, spec.priority, now);

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
      `[autonomous-hooks] Created task ${taskId} on board ${boardSlug}: "${spec.title}" (status: ${status}, assignee: ${spec.assignee})`
    );
    return { success: true, taskId };
  } catch (err: any) {
    if (transactionOpen && sqlite) {
      try {
        sqlite.exec('ROLLBACK');
      } catch {
        // Preserve the original insertion error.
      }
    }
    console.warn(`[autonomous-hooks] Failed to insert task on ${boardSlug}:`, err);
    return { success: false, reason: err?.message ?? String(err) };
  }
}
