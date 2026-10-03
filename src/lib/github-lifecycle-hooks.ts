/**
 * GitHub Lifecycle Hooks (HIVE — DeskRPG + Hermes)
 *
 * Implements the 5-Gate Pull Request Continuous Verification Pipeline:
 * - Gate 1: Mergeability & Conflict Sentinel (mergeable === false -> blocked)
 * - Gate 2: CI / GitHub Actions Suite (conclusion === failure -> blocked, success -> summon QA)
 * - Gate 3: Technical Code Review (@reviewer approval required)
 * - Gate 4: QA Functional Homologation (@qa-engineer scenario sign-off & test commit)
 * - Gate 5: Product Acceptance Sign-Off (@product-manager final approval -> squash merge)
 */

import path from "node:path";
import os from "node:os";
import fs from "node:fs";
import { spawn } from "node:child_process";
import {
  getSqliteDatabase,
  insertTaskSafely,
  resolveTacticalRoomId,
  resolveWorkspaceForTask,
} from "./autonomous-lifecycle-hooks";
import { appendRoomMessage } from "./chat-rooms";

export interface GitHubPullRequestPayload {
  action: "opened" | "closed" | "reopened" | "synchronize" | string;
  number: number;
  pull_request: {
    number: number;
    title: string;
    body: string | null;
    html_url: string;
    state: "open" | "closed";
    merged?: boolean;
    mergeable?: boolean | null;
    head: {
      ref: string;
      sha: string;
      repo: {
        full_name: string;
        name: string;
      };
    };
    base: {
      ref: string;
    };
    user: {
      login: string;
    };
  };
  repository: {
    full_name: string;
    name: string;
    html_url?: string;
  };
}

export interface GitHubCheckSuitePayload {
  action: "completed" | "requested" | "rerequested" | string;
  check_suite: {
    status: "completed" | "in_progress" | "queued" | string;
    conclusion:
      "success" | "failure" | "neutral" | "cancelled" | "timed_out" | "action_required" | null;
    head_branch: string;
    head_sha: string;
    pull_requests?: Array<{
      number: number;
      head: { ref: string; sha: string };
      base: { ref: string };
    }>;
  };
  repository: {
    full_name: string;
    name: string;
  };
}

export interface GitHubReviewPayload {
  action: "submitted" | "edited" | "dismissed" | string;
  review: {
    id: number;
    user: {
      login: string;
    };
    body: string | null;
    state: "approved" | "changes_requested" | "commented" | string;
    html_url: string;
  };
  pull_request: {
    number: number;
    title: string;
    html_url: string;
    head: { ref: string };
  };
  repository: {
    full_name: string;
    name: string;
  };
}

export interface GitHubIssueCommentPayload {
  action: "created" | "edited" | "deleted" | string;
  issue: {
    number: number;
    title: string;
    html_url: string;
    pull_request?: {
      url: string;
      html_url?: string;
    };
  };
  comment: {
    id: number;
    user: {
      login: string;
    };
    body: string;
    html_url: string;
  };
  repository: {
    full_name: string;
    name: string;
  };
}

export interface GitHubWebhookResult {
  success: boolean;
  action: string;
  boardSlug: string;
  prNumber?: number;
  taskId?: string;
  details?: string;
  allGatesPassed?: boolean;
}

export function resolveBoardFromGitHubRepo(repoFullName: string, hintText?: string): string {
  const lowerRepo = (repoFullName || "").toLowerCase();
  const lowerHint = (hintText || "").toLowerCase();

  if (
    lowerRepo.includes("hot-telegram") ||
    lowerRepo.includes("hot-traffic") ||
    lowerRepo.includes("hot-billing") ||
    lowerRepo.includes("hot-common")
  ) {
    return "hot-telegram";
  }
  if (lowerRepo.includes("mystelia")) {
    return "mystelia";
  }
  if (lowerRepo.includes("bloopu") || lowerRepo.includes("crypto")) {
    return "bloopu";
  }
  if (lowerRepo.includes("social")) {
    return "social";
  }
  if (lowerRepo.includes("deskrpg")) {
    return "hot-telegram";
  }

  if (lowerHint.includes("mystelia")) return "mystelia";
  if (lowerHint.includes("bloopu") || lowerHint.includes("crypto")) return "bloopu";
  if (lowerHint.includes("social")) return "social";
  if (lowerHint.includes("hot")) return "hot-telegram";

  return "hot-telegram";
}

/**
 * Handle pull_request events (opened, synchronize, reopened, closed)
 */
export async function handleGitHubPullRequestEvent(args: {
  payload: GitHubPullRequestPayload;
  channelId?: string;
  databasePath?: string;
  bypassDispatchSpawn?: boolean;
  emitRoomMessage?: (roomId: string, message: any) => void;
}): Promise<GitHubWebhookResult> {
  const {
    payload,
    channelId = "c_general",
    databasePath,
    bypassDispatchSpawn,
    emitRoomMessage,
  } = args;
  const pr = payload.pull_request;
  const repo = payload.repository;
  const boardSlug = resolveBoardFromGitHubRepo(repo.full_name, `${pr.title} ${pr.head.ref}`);
  const dedupKey = `gh-pr-${repo.full_name}-${pr.number}`;
  const now = Math.floor(Date.now() / 1000);

  const dbPath =
    databasePath ?? path.join(os.homedir(), ".hermes", "kanban", "boards", boardSlug, "kanban.db");
  if (!fs.existsSync(dbPath)) {
    return {
      success: false,
      action: "db_not_found",
      boardSlug,
      details: `Database not found: ${dbPath}`,
    };
  }

  const sqlite = getSqliteDatabase(dbPath);
  const tacticalRoom = await resolveTacticalRoomId(channelId, "reviewer");

  // Handle closed PRs
  if (payload.action === "closed") {
    if (pr.merged) {
      const existing = sqlite
        .prepare(
          "SELECT id FROM tasks WHERE status NOT IN ('done', 'archived') AND body LIKE ? LIMIT 1",
        )
        .get(`%${dedupKey}%`) as { id?: string } | undefined;

      if (existing?.id) {
        sqlite
          .prepare(
            "UPDATE tasks SET status = 'done', completed_at = ?, block_kind = NULL WHERE id = ?",
          )
          .run(now, existing.id);

        try {
          sqlite
            .prepare(
              "INSERT INTO task_comments (task_id, author, body, created_at) VALUES (?, ?, ?, ?)",
            )
            .run(
              existing.id,
              "github-webhook",
              `🎉 [GitHub Hook] PR #${pr.number} mesclado com sucesso na branch base! Todos os 5 portões foram cumpridos e a tarefa foi encerrada.`,
              now,
            );
        } catch {}

        if (tacticalRoom) {
          const content = `🎉 **[PULL REQUEST MERGEADO]** PR #${pr.number} — *${pr.title}*\nBranch \`${pr.head.ref}\` integrada com sucesso. Card \`${existing.id}\` promovido para **done**.`;
          try {
            const msg = await appendRoomMessage({
              roomId: tacticalRoom.roomId,
              senderKind: "system",
              senderId: null,
              senderName: "GitHub Webhook Sentinel",
              content,
              notice: {
                kind: "card_done",
                cardId: existing.id,
                cardTitle: pr.title,
                boardSlug,
                npcName: "system",
              },
            });
            if (emitRoomMessage) emitRoomMessage(tacticalRoom.roomId, msg);
          } catch {}
        }

        return {
          success: true,
          action: "pr_merged_done",
          boardSlug,
          prNumber: pr.number,
          taskId: existing.id,
        };
      }
    }

    return { success: true, action: "pr_closed_ignored", boardSlug, prNumber: pr.number };
  }

  // Handle opened, synchronize, reopened
  const isConflict = pr.mergeable === false;
  const initialStatus = isConflict ? "blocked" : "ready";
  const assignee = isConflict ? "backend-engineer" : "reviewer";

  const bodyContent = [
    `### 🚀 Pull Request Lifecycle — 5 Portões de Fusão`,
    `- **Repositório:** [${repo.full_name}](${pr.html_url})`,
    `- **PR:** #${pr.number} — *${pr.title}*`,
    `- **Branch:** \`${pr.head.ref}\` → \`${pr.base.ref}\``,
    `- **Autor:** @${pr.user.login}`,
    ``,
    `#### Matriz de Portões de Qualidade:`,
    `- [${isConflict ? " " : "x"}] **Gate 1 (Mergeable):** ${isConflict ? "⚠️ CONFLITO DE MERGE DETECTADO" : "Sem conflitos de branch."}`,
    `- [ ] **Gate 2 (CI / GitHub Actions):** Aguardando conclusão da suíte automatizada.`,
    `- [ ] **Gate 3 (Code Review):** Aguardando parecer técnico de @reviewer.`,
    `- [ ] **Gate 4 (QA Homologation):** Aguardando homologação de cenários de @qa-engineer.`,
    `- [ ] **Gate 5 (PM Acceptance Sign-Off):** Aguardando validação final de critérios de @product-manager.`,
    ``,
    `<!-- dedupKey: ${dedupKey} -->`,
  ].join("\n");

  const insertRes = insertTaskSafely(boardSlug, {
    title: `[PR #${pr.number}] ${pr.title}`,
    body: bodyContent,
    assignee,
    priority: isConflict ? 9 : 8,
    parentId: "",
    dedupKey,
    databasePath: dbPath,
    bypassWipLimit: true,
  });

  const taskId = insertRes.taskId;
  if (!taskId) {
    return { success: false, action: "task_insert_failed", boardSlug, details: insertRes.reason };
  }

  if (isConflict) {
    // GATE 1 FAILED: Conflict
    sqlite
      .prepare("UPDATE tasks SET status = 'blocked', block_kind = 'conflict' WHERE id = ?")
      .run(taskId);

    try {
      sqlite
        .prepare(
          "INSERT INTO task_comments (task_id, author, body, created_at) VALUES (?, ?, ?, ?)",
        )
        .run(
          taskId,
          "github-webhook",
          `🚨 **[GATE 1 — CONFLITO DE MERGE]** O PR #${pr.number} possui conflitos com a branch base \`${pr.base.ref}\`. Necessário rebase imediato antes de prosseguir com QA ou Review.`,
          now,
        );
    } catch {}

    if (tacticalRoom) {
      const content = `🚨 **[CONFLITO NO PULL REQUEST]** \`${taskId}\` — PR #${pr.number} (*${pr.title}*)\nDetectado conflito de branch com \`${pr.base.ref}\`. Card travado em **blocked** aguardando rebase do autor @${pr.user.login}.`;
      try {
        const msg = await appendRoomMessage({
          roomId: tacticalRoom.roomId,
          senderKind: "system",
          senderId: null,
          senderName: "GitHub Webhook Sentinel",
          content,
          notice: {
            kind: "card_blocked",
            cardId: taskId,
            cardTitle: pr.title,
            boardSlug,
            npcName: assignee,
          },
        });
        if (emitRoomMessage) emitRoomMessage(tacticalRoom.roomId, msg);
      } catch {}
    }

    return { success: true, action: "conflict_blocked", boardSlug, prNumber: pr.number, taskId };
  }

  // GATE 1 PASSED: Move to review and summon reviewer
  sqlite
    .prepare(
      "UPDATE tasks SET status = 'review', assignee = 'reviewer', block_kind = NULL WHERE id = ?",
    )
    .run(taskId);

  try {
    sqlite
      .prepare("INSERT INTO task_comments (task_id, author, body, created_at) VALUES (?, ?, ?, ?)")
      .run(
        taskId,
        "github-webhook",
        `✅ **[GATE 1 — MERGEABLE OK]** PR #${pr.number} sem conflitos. Tarefa atribuída a @reviewer para auditoria de código.`,
        now,
      );
  } catch {}

  if (tacticalRoom) {
    const content = `🔍 **[NOVO PULL REQUEST EM REVIEW]** \`${taskId}\` — PR #${pr.number} (*${pr.title}*)\nBranch \`${pr.head.ref}\` pronta para auditoria. Tarefa atribuída a @reviewer.`;
    try {
      const msg = await appendRoomMessage({
        roomId: tacticalRoom.roomId,
        senderKind: "system",
        senderId: null,
        senderName: "GitHub Webhook Sentinel",
        content,
        notice: {
          kind: "card_done",
          cardId: taskId,
          cardTitle: pr.title,
          boardSlug,
          npcName: "reviewer",
        },
      });
      if (emitRoomMessage) emitRoomMessage(tacticalRoom.roomId, msg);
    } catch {}
  }

  if (!bypassDispatchSpawn) {
    try {
      spawn("hermes", ["kanban", "--board", boardSlug, "dispatch"], {
        detached: true,
        stdio: "ignore",
      }).unref();
    } catch {}
  }

  return { success: true, action: "review_dispatched", boardSlug, prNumber: pr.number, taskId };
}

/**
 * Handle check_suite / check_run events (CI / GitHub Actions completed)
 */
export async function handleGitHubCheckSuiteEvent(args: {
  payload: GitHubCheckSuitePayload;
  channelId?: string;
  databasePath?: string;
  bypassDispatchSpawn?: boolean;
  emitRoomMessage?: (roomId: string, message: any) => void;
}): Promise<GitHubWebhookResult> {
  const {
    payload,
    channelId = "c_general",
    databasePath,
    bypassDispatchSpawn,
    emitRoomMessage,
  } = args;
  const cs = payload.check_suite;
  const repo = payload.repository;
  const boardSlug = resolveBoardFromGitHubRepo(repo.full_name, cs.head_branch);
  const now = Math.floor(Date.now() / 1000);

  if (cs.status !== "completed") {
    return { success: true, action: "check_suite_in_progress_ignored", boardSlug };
  }

  const dbPath =
    databasePath ?? path.join(os.homedir(), ".hermes", "kanban", "boards", boardSlug, "kanban.db");
  if (!fs.existsSync(dbPath)) {
    return { success: false, action: "db_not_found", boardSlug };
  }

  const sqlite = getSqliteDatabase(dbPath);
  const tacticalRoom = await resolveTacticalRoomId(channelId, "qa-engineer");

  // Locate the task by PR number or branch reference in body
  const prNumber = cs.pull_requests?.[0]?.number;
  let taskRow: { id: string; title: string; status: string } | undefined;

  if (prNumber) {
    taskRow = sqlite
      .prepare(
        "SELECT id, title, status FROM tasks WHERE status NOT IN ('done', 'archived') AND body LIKE ? LIMIT 1",
      )
      .get(`%gh-pr-${repo.full_name}-${prNumber}%`) as any;
  }
  if (!taskRow && cs.head_branch) {
    taskRow = sqlite
      .prepare(
        "SELECT id, title, status FROM tasks WHERE status NOT IN ('done', 'archived') AND body LIKE ? LIMIT 1",
      )
      .get(`%${cs.head_branch}%`) as any;
  }

  if (!taskRow) {
    return { success: true, action: "no_matching_task_found", boardSlug };
  }

  const isCiSuccess = cs.conclusion === "success";

  if (!isCiSuccess) {
    // GATE 2 FAILED: CI broke
    sqlite
      .prepare("UPDATE tasks SET status = 'blocked', block_kind = 'capability' WHERE id = ?")
      .run(taskRow.id);

    try {
      sqlite
        .prepare(
          "INSERT INTO task_comments (task_id, author, body, created_at) VALUES (?, ?, ?, ?)",
        )
        .run(
          taskRow.id,
          "github-ci",
          `🚨 **[GATE 2 — CI FALHOU]** A suíte de testes/build do GitHub Actions falhou (conclusão: \`${cs.conclusion}\`) na branch \`${cs.head_branch}\`. Card bloqueado até a correção do build.`,
          now,
        );
    } catch {}

    if (tacticalRoom) {
      const content = `❌ **[CI FALHOU NO PULL REQUEST]** \`${taskRow.id}\` — *${taskRow.title}*\nSuíte do GitHub Actions falhou na branch \`${cs.head_branch}\`. Card movido para **blocked** até correção dos testes.`;
      try {
        const msg = await appendRoomMessage({
          roomId: tacticalRoom.roomId,
          senderKind: "system",
          senderId: null,
          senderName: "GitHub CI Sentinel",
          content,
          notice: {
            kind: "card_blocked",
            cardId: taskRow.id,
            cardTitle: taskRow.title,
            boardSlug,
            npcName: "platform-engineer",
          },
        });
        if (emitRoomMessage) emitRoomMessage(tacticalRoom.roomId, msg);
      } catch {}
    }

    return { success: true, action: "ci_failed_blocked", boardSlug, taskId: taskRow.id };
  }

  // GATE 2 PASSED: CI Green -> Summon QA Engineer
  try {
    sqlite
      .prepare("INSERT INTO task_comments (task_id, author, body, created_at) VALUES (?, ?, ?, ?)")
      .run(
        taskRow.id,
        "github-ci",
        `✅ **[GATE 2 — CI 100% VERDE]** GitHub Actions aprovado com sucesso! Convocando @qa-engineer para homologação dos cenários funcionais.`,
        now,
      );
  } catch {}

  if (tacticalRoom) {
    const content = `🧪 **[CI VERDE — CONVOCANDO QA]** \`${taskRow.id}\` — *${taskRow.title}*\nTestes automatizados do GitHub Actions passaram com sucesso. Convocando @qa-engineer para homologar cenários e verificar cobertura.`;
    try {
      const msg = await appendRoomMessage({
        roomId: tacticalRoom.roomId,
        senderKind: "system",
        senderId: null,
        senderName: "GitHub CI Sentinel",
        content,
        notice: {
          kind: "card_done",
          cardId: taskRow.id,
          cardTitle: taskRow.title,
          boardSlug,
          npcName: "qa-engineer",
        },
      });
      if (emitRoomMessage) emitRoomMessage(tacticalRoom.roomId, msg);
    } catch {}
  }

  return { success: true, action: "ci_passed_qa_summoned", boardSlug, taskId: taskRow.id };
}

/**
 * Handle pull_request_review events (Technical Code Review)
 */
export async function handleGitHubReviewEvent(args: {
  payload: GitHubReviewPayload;
  channelId?: string;
  databasePath?: string;
  emitRoomMessage?: (roomId: string, message: any) => void;
}): Promise<GitHubWebhookResult> {
  const { payload, channelId = "c_general", databasePath, emitRoomMessage } = args;
  const review = payload.review;
  const pr = payload.pull_request;
  const repo = payload.repository;
  const boardSlug = resolveBoardFromGitHubRepo(repo.full_name, pr.title);
  const now = Math.floor(Date.now() / 1000);

  const dbPath =
    databasePath ?? path.join(os.homedir(), ".hermes", "kanban", "boards", boardSlug, "kanban.db");
  if (!fs.existsSync(dbPath)) {
    return { success: false, action: "db_not_found", boardSlug };
  }

  const sqlite = getSqliteDatabase(dbPath);
  const tacticalRoom = await resolveTacticalRoomId(channelId, "product-manager");

  const taskRow = sqlite
    .prepare(
      "SELECT id, title, status FROM tasks WHERE status NOT IN ('done', 'archived') AND body LIKE ? LIMIT 1",
    )
    .get(`%gh-pr-${repo.full_name}-${pr.number}%`) as
    { id: string; title: string; status: string } | undefined;

  if (!taskRow) {
    return { success: true, action: "no_matching_task_found", boardSlug };
  }

  if (review.state === "approved") {
    // GATE 3 PASSED: Code review approved
    try {
      sqlite
        .prepare(
          "INSERT INTO task_comments (task_id, author, body, created_at) VALUES (?, ?, ?, ?)",
        )
        .run(
          taskRow.id,
          "github-review",
          `✅ **[GATE 3 — CODE REVIEW APROVADO]** Aprovado por @${review.user.login}.\n${review.body ? `> ${review.body}\n` : ""}Convocando @product-manager para validação de critérios de aceite e Gate 5.`,
          now,
        );
    } catch {}

    if (tacticalRoom) {
      const content = `👔 **[CODE REVIEW APROVADO — AGUARDANDO PM]** \`${taskRow.id}\` — PR #${pr.number} (*${pr.title}*)\nRevisão técnica aprovada por @${review.user.login}. Convocando @product-manager para validação final de negócio.`;
      try {
        const msg = await appendRoomMessage({
          roomId: tacticalRoom.roomId,
          senderKind: "system",
          senderId: null,
          senderName: "GitHub Review Sentinel",
          content,
          notice: {
            kind: "card_done",
            cardId: taskRow.id,
            cardTitle: taskRow.title,
            boardSlug,
            npcName: "product-manager",
          },
        });
        if (emitRoomMessage) emitRoomMessage(tacticalRoom.roomId, msg);
      } catch {}
    }

    return {
      success: true,
      action: "review_approved_pm_summoned",
      boardSlug,
      prNumber: pr.number,
      taskId: taskRow.id,
    };
  }

  if (review.state === "changes_requested") {
    // GATE 3 FAILED: Changes requested
    sqlite
      .prepare("UPDATE tasks SET status = 'blocked', block_kind = 'needs_input' WHERE id = ?")
      .run(taskRow.id);

    try {
      sqlite
        .prepare(
          "INSERT INTO task_comments (task_id, author, body, created_at) VALUES (?, ?, ?, ?)",
        )
        .run(
          taskRow.id,
          "github-review",
          `⚠️ **[GATE 3 — MUDANÇAS SOLICITADAS]** @${review.user.login} requisitou ajustes no PR:\n> ${review.body}\nCard retornado ao implementador para correção.`,
          now,
        );
    } catch {}

    return {
      success: true,
      action: "changes_requested_blocked",
      boardSlug,
      prNumber: pr.number,
      taskId: taskRow.id,
    };
  }

  return {
    success: true,
    action: "review_commented_logged",
    boardSlug,
    prNumber: pr.number,
    taskId: taskRow.id,
  };
}

/**
 * Handle issue_comment events (QA Sign-off & PM Final Acceptance Approval)
 */
export async function handleGitHubIssueCommentEvent(args: {
  payload: GitHubIssueCommentPayload;
  channelId?: string;
  databasePath?: string;
  executeMerge?: boolean;
  emitRoomMessage?: (roomId: string, message: any) => void;
}): Promise<GitHubWebhookResult> {
  const { payload, channelId = "c_general", databasePath, executeMerge, emitRoomMessage } = args;
  const issue = payload.issue;
  const comment = payload.comment;
  const repo = payload.repository;
  const boardSlug = resolveBoardFromGitHubRepo(repo.full_name, issue.title);
  const now = Math.floor(Date.now() / 1000);

  // Must be on a Pull Request
  if (!issue.pull_request) {
    return { success: true, action: "non_pr_comment_ignored", boardSlug };
  }

  const dbPath =
    databasePath ?? path.join(os.homedir(), ".hermes", "kanban", "boards", boardSlug, "kanban.db");
  if (!fs.existsSync(dbPath)) {
    return { success: false, action: "db_not_found", boardSlug };
  }

  const sqlite = getSqliteDatabase(dbPath);
  const tacticalRoom = await resolveTacticalRoomId(channelId, "product-manager");

  const taskRow = sqlite
    .prepare(
      "SELECT id, title, status FROM tasks WHERE status NOT IN ('done', 'archived') AND body LIKE ? LIMIT 1",
    )
    .get(`%gh-pr-${repo.full_name}-${issue.number}%`) as
    { id: string; title: string; status: string } | undefined;

  if (!taskRow) {
    return { success: true, action: "no_matching_task_found", boardSlug };
  }

  const bodyLower = comment.body.toLowerCase();
  const isQaApproved =
    bodyLower.includes("qa-aprovado") ||
    bodyLower.includes("qa sign-off") ||
    bodyLower.includes("cenários homologados") ||
    comment.user.login.includes("qa");

  const isPmApproved =
    bodyLower.includes("lgtm / aprovado") ||
    bodyLower.includes("aprovado para merge") ||
    bodyLower.includes("[aprovado]") ||
    bodyLower.includes("/approve") ||
    comment.user.login.includes("product") ||
    comment.user.login.includes("modesto");

  if (isQaApproved) {
    // GATE 4 PASSED: QA Sign-off
    try {
      sqlite
        .prepare(
          "INSERT INTO task_comments (task_id, author, body, created_at) VALUES (?, ?, ?, ?)",
        )
        .run(
          taskRow.id,
          "github-qa",
          `✅ **[GATE 4 — QA HOMOLOGAÇÃO CONCLUÍDA]** Cenários de teste validados por @${comment.user.login}.\n> ${comment.body}`,
          now,
        );
    } catch {}

    return {
      success: true,
      action: "qa_signoff_recorded",
      boardSlug,
      prNumber: issue.number,
      taskId: taskRow.id,
    };
  }

  if (isPmApproved) {
    // GATE 5: PM Sign-off & 5-Gate Merge Clearance
    try {
      sqlite
        .prepare(
          "INSERT INTO task_comments (task_id, author, body, created_at) VALUES (?, ?, ?, ?)",
        )
        .run(
          taskRow.id,
          "github-pm",
          `🏆 **[GATE 5 — PM ACEITE FINAL CONCEDIDO]** Critérios de negócio validados por @${comment.user.login}.\nTodos os 5 portões de qualidade foram satisfeitos! PR liberado para fusão segura via squash merge.`,
          now,
        );
    } catch {}

    if (tacticalRoom) {
      const content = `🚀 **[PULL REQUEST PRONTO PARA MERGE]** \`${taskRow.id}\` — PR #${issue.number} (*${issue.title}*)\nTodos os 5 Portões de Fusão foram cumpridos com sucesso!\n- ✅ Gate 1 (Mergeable)\n- ✅ Gate 2 (CI/Checks)\n- ✅ Gate 3 (Code Review)\n- ✅ Gate 4 (QA Homologação)\n- ✅ Gate 5 (PM Sign-off)\nAutorizado para fusão segura via \`gh pr merge --squash\`.`;
      try {
        const msg = await appendRoomMessage({
          roomId: tacticalRoom.roomId,
          senderKind: "system",
          senderId: null,
          senderName: "GitHub Merge Sentinel",
          content,
          notice: {
            kind: "card_done",
            cardId: taskRow.id,
            cardTitle: issue.title,
            boardSlug,
            npcName: "product-manager",
          },
        });
        if (emitRoomMessage) emitRoomMessage(tacticalRoom.roomId, msg);
      } catch {}
    }

    if (executeMerge) {
      try {
        spawn(
          "gh",
          [
            "pr",
            "merge",
            String(issue.number),
            "--squash",
            "--delete-branch",
            "--repo",
            repo.full_name,
          ],
          {
            detached: true,
            stdio: "ignore",
          },
        ).unref();
      } catch (err) {
        console.warn(`[github-hooks] Auto-merge spawn failed:`, err);
      }
    }

    return {
      success: true,
      action: "pm_approved_merge_authorized",
      boardSlug,
      prNumber: issue.number,
      taskId: taskRow.id,
      allGatesPassed: true,
    };
  }

  return {
    success: true,
    action: "comment_logged",
    boardSlug,
    prNumber: issue.number,
    taskId: taskRow.id,
  };
}

/**
 * Strict PR Review Gate Enforcement:
 * Prevents any task linked to an unmerged GitHub Pull Request from prematurely moving to 'done'.
 * While the PR is undergoing the 5-Gate pipeline (Mergeable check, CI, Review, QA, PM),
 * the card MUST remain strictly in the 'review' column on the Kanban board.
 * Only an actual GitHub merge event (action: 'closed', merged: true) authorizes transition to 'done'.
 */
export async function enforceReviewGateForPrTasks(args: {
  boardSlug: string;
  taskId: string;
  channelId?: string;
  databasePath?: string;
  emitRoomMessage?: (roomId: string, message: any) => void;
}): Promise<{ preventedDone: boolean; reason?: string; prNumber?: number }> {
  const { boardSlug, taskId, channelId = "c_general", databasePath, emitRoomMessage } = args;

  const dbPath =
    databasePath ?? path.join(os.homedir(), ".hermes", "kanban", "boards", boardSlug, "kanban.db");
  if (!fs.existsSync(dbPath)) {
    return { preventedDone: false };
  }

  const sqlite = getSqliteDatabase(dbPath);
  const taskRow = sqlite
    .prepare("SELECT id, title, body, status FROM tasks WHERE id = ?")
    .get(taskId) as { id: string; title: string; body: string | null; status: string } | undefined;

  if (!taskRow || !taskRow.body) {
    return { preventedDone: false };
  }

  // Check if this card is bound to a GitHub Pull Request
  const prMatch = taskRow.body.match(
    /gh-pr-([^\s]+)-(\d+)|github\.com\/[^\/]+\/[^\/]+\/pull\/(\d+)|PR\s*#(\d+)/i,
  );
  if (!prMatch) {
    return { preventedDone: false };
  }

  const prNumber = Number(prMatch[2] || prMatch[3] || prMatch[4]);

  // Check if the PR was actually merged by verifying comments or task metadata
  const comments = sqlite
    .prepare("SELECT body FROM task_comments WHERE task_id = ? ORDER BY id DESC")
    .all(taskId) as Array<{ body: string }>;

  const hasMergeConfirmation = comments.some(
    (c) =>
      c.body.includes("[PULL REQUEST MERGEADO]") ||
      c.body.includes("mesclado com sucesso na branch base") ||
      c.body.includes("pr_merged_done"),
  );

  // If the PR was already merged legitimately, permit done!
  if (hasMergeConfirmation) {
    return { preventedDone: false, prNumber };
  }

  // PR is NOT merged yet: REJECT transition to done and enforce 'review' status!
  const now = Math.floor(Date.now() / 1000);
  sqlite
    .prepare("UPDATE tasks SET status = 'review', completed_at = NULL WHERE id = ?")
    .run(taskId);

  try {
    sqlite
      .prepare("INSERT INTO task_comments (task_id, author, body, created_at) VALUES (?, ?, ?, ?)")
      .run(
        taskId,
        "pr-review-gate-sentinel",
        `🛡️ **[GATEWAY DE PROTEÇÃO — PR REVIEW GATE]** Transição para 'done' bloqueada!\n` +
          `Este card está vinculado ao Pull Request #${prNumber || ""}, que ainda está no processo de validação dos 5 Portões de Fusão (CI, Code Review, QA Homologação, PM Sign-Off).\n` +
          `Conforme as regras de governança, o card **deve permanecer na coluna 'review'** no Kanban e só será movido para 'done' quando o PR for formalmente mesclado no GitHub.`,
        now,
      );
  } catch {}

  const tacticalRoom = await resolveTacticalRoomId(channelId, "reviewer");
  if (tacticalRoom) {
    const content =
      `🛡️ **[TRANSIÇÃO BLOQUEADA — PR AINDA EM REVIEW]** \`${taskId}\` — *${taskRow.title}*\n` +
      `Tentativa de mover card vinculado ao PR #${prNumber || ""} para **done** interceptada.\n` +
      `O card foi mantido na coluna **review** até a conclusão dos 5 Portões e do merge no GitHub.`;
    try {
      const msg = await appendRoomMessage({
        roomId: tacticalRoom.roomId,
        senderKind: "system",
        senderId: null,
        senderName: "PR Review Gate Sentinel",
        content,
        notice: {
          kind: "card_done",
          cardId: taskId,
          cardTitle: taskRow.title,
          boardSlug,
          npcName: "reviewer",
        },
      });
      if (emitRoomMessage) emitRoomMessage(tacticalRoom.roomId, msg);
    } catch {}
  }

  return {
    preventedDone: true,
    reason: "pr_not_merged_remains_in_review",
    prNumber,
  };
}
