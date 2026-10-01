import { NextRequest, NextResponse } from "next/server";
import { insertTaskSafely, resolveTacticalRoomId, getSqliteDatabase } from "@/lib/autonomous-lifecycle-hooks";
import { appendRoomMessage } from "@/lib/chat-rooms";
import { db, chatRooms } from "@/db";
import { eq, and } from "drizzle-orm";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";
import { createHash } from "node:crypto";

interface AlertManagerAlert {
  status: "firing" | "resolved";
  labels: Record<string, string>;
  annotations: Record<string, string>;
  startsAt?: string;
  endsAt?: string;
  generatorURL?: string;
  fingerprint?: string;
}

interface AlertManagerWebhookPayload {
  version?: string;
  groupKey?: string;
  status: "firing" | "resolved";
  receiver?: string;
  alerts: AlertManagerAlert[];
  commonLabels?: Record<string, string>;
  commonAnnotations?: Record<string, string>;
}

const ALERT_FINGERPRINT_PREFIX = "alertmanager-fingerprint:";
const TARGET_LABEL_KEYS = ["target", "service", "endpoint", "instance", "server", "host", "namespace", "bot", "group"];

function normalizeFingerprintPart(value: string | undefined, fallback: string): string {
  const normalized = value?.trim().toLowerCase().replace(/\s+/g, " ");
  return normalized || fallback;
}

function resolveAlertTarget(labels: Record<string, string>): string {
  const targetParts = TARGET_LABEL_KEYS
    .filter((key) => labels[key]?.trim())
    .map((key) => `${key}=${normalizeFingerprintPart(labels[key], "unknown")}`);
  return targetParts.length > 0 ? targetParts.join("|") : "global";
}

function resolveAlertWindow(alert: AlertManagerAlert): string {
  const labels = alert.labels || {};
  const annotations = alert.annotations || {};
  return (
    labels.window ||
    labels.evaluation_window ||
    labels.alert_window ||
    labels.for ||
    annotations.window ||
    annotations.evaluation_window ||
    "default"
  );
}

/**
 * Stable incident identity for Alertmanager retries.
 *
 * The source deliberately excludes summary/description because those can be enriched between
 * retries. An incident is equivalent when alert name, tier, target and evaluation window
 * are equivalent. The fallback window is intentionally stable when a producer omits a window label.
 * The digest keeps the marker compact enough for SQLite body matching.
 */
export function buildAlertFingerprint(alert: AlertManagerAlert): string {
  const labels = alert.labels || {};
  const source = [
    normalizeFingerprintPart(labels.alertname, "unknown-alert"),
    normalizeFingerprintPart(labels.tier || labels.service_tier, "default-tier"),
    normalizeFingerprintPart(resolveAlertTarget(labels), "global"),
    normalizeFingerprintPart(resolveAlertWindow(alert), "default"),
  ].join("\u001f");
  return createHash("sha256").update(source, "utf8").digest("hex").slice(0, 24);
}

function fingerprintMarker(fingerprint: string): string {
  return `<!-- ${ALERT_FINGERPRINT_PREFIX}${fingerprint} -->`;
}

// Map alert tier/project to canonical Kanban board slug
function resolveBoardSlug(labels: Record<string, string>): string {
  if (labels.project) return labels.project.toLowerCase();
  if (labels.board) return labels.board.toLowerCase();
  const tier = labels.tier?.toLowerCase() ?? "";
  if (tier.includes("traffic") || tier.includes("billing") || tier.includes("telegram")) {
    return "hot-telegram";
  }
  if (tier.includes("mystelia") || tier.includes("esoteric")) {
    return "mystelia";
  }
  if (tier.includes("crypto") || tier.includes("bloopu")) {
    return "bloopu";
  }
  if (tier.includes("social")) {
    return "social";
  }
  return "hot-telegram"; // default fallback for business traffic
}

function resolveAssignee(labels: Record<string, string>): string {
  if (labels.assignee) return labels.assignee;
  const severity = labels.severity?.toLowerCase() ?? "";
  const alertName = labels.alertname?.toLowerCase() ?? "";
  if (alertName.includes("login") || alertName.includes("mtproto") || alertName.includes("session")) {
    return "site-reliability-engineer";
  }
  if (severity === "critical" || alertName.includes("halted") || alertName.includes("delivery")) {
    return "backend-engineer";
  }
  return "backend-engineer";
}

export async function POST(req: NextRequest) {
  try {
    const rawBody = await req.json();

    // Support both Langfuse Monitor Alerts and Prometheus/Alertmanager
    if (rawBody && rawBody.type === "monitor-alert") {
      const payload = rawBody.payload || {};
      const msg = payload.message || {};
      const severity = payload.severity?.toUpperCase() ?? "ALERT";
      const priority = severity === "ALERT" ? 10 : 8;
      const title = `[LANGFUSE-${severity}] ${msg.title || "Qualidade/Custo Comprometido"}`;
      const permalink = payload.permalink || "https://us.cloud.langfuse.com";
      const body = [
        `### 🚨 Alerta de Observabilidade — Langfuse`,
        `- **Monitor ID:** \`${payload.monitorId || "desconhecido"}\``,
        `- **Gravidade:** \`${severity}\``,
        `- **Mensagem:** ${msg.body || "Métrica ultrapassou o limiar de qualidade/custo."}`,
        `- **Janela:** \`${payload.window || "1h"}\``,
        `- **Painel Langfuse:** [Acessar Monitor](${permalink})`,
        `\n> **Ação Autônoma:** Incidente aberto via Webhook de Alertas do Langfuse.`,
      ].join("\n");

      const boardSlug = "eng-ops";
      const assignee = "backend-engineer";

      const result = insertTaskSafely(boardSlug, {
        title,
        body,
        assignee,
        priority,
        parentId: "langfuse-alert",
        initialStatus: "ready",
      });

      try {
        const tactical = await resolveTacticalRoomId("1586d6fd-d570-4c19-9b98-bde557e95589", "backend-engineer");
        if (tactical) {
          await appendRoomMessage({
            roomId: tactical.roomId,
            senderId: null,
            senderName: "Langfuse Sentinel",
            senderKind: "system",
            content: `🚨 **[ALERTA LANGFUSE ${severity}]** ${title}\n${msg.body || ""}\n🔗 [Abrir no Langfuse](${permalink})`,
          });
        }
      } catch (e) {
        console.warn("[langfuse-webhook] Failed to post tactical room alert:", e);
      }

      return NextResponse.json({
        ok: true,
        type: "langfuse-monitor-alert",
        taskId: result.taskId,
      });
    }

    const payload = rawBody as AlertManagerWebhookPayload;
    if (!payload || !Array.isArray(payload.alerts)) {
      return NextResponse.json({ error: "invalid_payload", message: "Expected Alertmanager or Langfuse webhook payload" }, { status: 400 });
    }

    const createdTasks: Array<{ taskId: string; board: string; title: string }> = [];
    const updatedTasks: Array<{ taskId: string; board: string; title: string }> = [];
    const resolvedTasks: Array<{ taskId: string; board: string; title: string }> = [];

    for (const alert of payload.alerts) {
      const labels = alert.labels || {};
      const annotations = alert.annotations || {};
      const alertName = (labels.alertname || "").trim();
      const rawSeverity = (labels.severity || "").toLowerCase().trim();

      // Sentinel alerts (Watchdog / DeadMansSwitch) continuously fire by design to verify
      // alerting pipeline health and must never create incident cards.
      if (
        alertName === "Watchdog" ||
        alertName === "DeadMansSwitch" ||
        alertName === "KubeWatchdog" ||
        rawSeverity === "none" ||
        rawSeverity === "info"
      ) {
        continue;
      }

      const fingerprint = buildAlertFingerprint(alert);
      const dedupKey = fingerprintMarker(fingerprint);
      const boardSlug = resolveBoardSlug(labels);
      const assignee = resolveAssignee(labels);
      const severity = labels.severity?.toUpperCase() ?? "HIGH";
      const priority = severity === "CRITICAL" ? 10 : 8;
      const summary = annotations.summary || labels.alertname || "Incidente Operacional Detectado";

      if (alert.status === "resolved") {
        try {
          const dbPath = path.join(os.homedir(), ".hermes", "kanban", "boards", boardSlug, "kanban.db");
          if (fs.existsSync(dbPath)) {
            const sqlite = getSqliteDatabase(dbPath);
            const searchKeyword = labels.alertname || summary;
            const tasks = (
              labels.window ||
              labels.evaluation_window ||
              labels.alert_window ||
              labels.for ||
              annotations.window ||
              annotations.evaluation_window
                ? sqlite
                    .prepare(
                      "SELECT id, title, assignee FROM tasks WHERE status NOT IN ('done', 'archived') AND body LIKE ?"
                    )
                    .all(`%${dedupKey}%`)
                : sqlite
                    .prepare(
                      "SELECT id, title, assignee FROM tasks WHERE status NOT IN ('done', 'archived') AND (title LIKE ? OR body LIKE ?)"
                    )
                    .all(`%${searchKeyword}%`, `%${searchKeyword}%`)
            ) as Array<{ id: string; title: string; assignee: string }>;

            const now = Math.floor(Date.now() / 1000);
            for (const t of tasks) {
              const resolveComment = `✅ [AUTO-RESOLVED] O alerta '${summary}' foi resolvido no Grafana/Alertmanager em ${alert.endsAt || new Date().toISOString()}. Telemetria normalizada.`;
              try {
                sqlite.prepare(
                  "INSERT INTO task_comments (task_id, author, body, created_at) VALUES (?, 'sre-grafana-alertmanager', ?, ?)"
                ).run(t.id, resolveComment, now);
              } catch {}

              sqlite.prepare(
                "UPDATE tasks SET status = 'done', completed_at = ?, result = ? WHERE id = ?"
              ).run(now, "auto-resolved by telemetry monitor", t.id);

              try {
                sqlite.prepare(
                  "INSERT INTO task_events (task_id, run_id, kind, payload, created_at) VALUES (?, NULL, 'completed', ?, ?)"
                ).run(t.id, JSON.stringify({ summary: resolveComment }), now);
              } catch {}

              resolvedTasks.push({ taskId: t.id, board: boardSlug, title: t.title });

              // Post resolution notice to tactical room
              try {
                const tactical = await resolveTacticalRoomId("1586d6fd-d570-4c19-9b98-bde557e95589", "site-reliability-engineer");
                if (tactical) {
                  const resolveNotice = [
                    `🟢 **[INCIDENTE RESOLVIDO — TELEMETRIA]** \`${t.id}\``,
                    `**Assunto:** ${t.title}`,
                    `👤 Notificando: @${t.assignee || assignee}`,
                    `📋 Board: \`${boardSlug}\``,
                    `*Status:* Resolvido no Grafana/Alertmanager. Card encerrado automaticamente.`,
                  ].join("\n");

                  await appendRoomMessage({
                    roomId: tactical.roomId,
                    senderId: null,
                    senderName: "Alertmanager Sentinel",
                    senderKind: "system",
                    content: resolveNotice,
                  });
                }
              } catch (noticeErr) {
                console.warn("[alertmanager-webhook] Failed to post resolution notice:", noticeErr);
              }
            }
          }
        } catch (resolveErr) {
          console.error("[alertmanager-webhook] Error auto-resolving task:", resolveErr);
        }
        continue;
      }

      if (alert.status !== "firing") continue;

      const description = annotations.description || "Alerta recebido do Alertmanager / Vector telemetry pipeline.";

      const title = `[INCIDENT-${severity}][${boardSlug.toUpperCase()}] ${summary}`;
      const body = [
        dedupKey,
        `### 🚨 Alerta de Produção — Alertmanager`,
        `- **Alerta:** \`${labels.alertname || "Desconhecido"}\``,
        `- **Gravidade:** \`${severity}\``,
        `- **Tier:** \`${labels.tier || "N/A"}\``,
        labels.bot ? `- **Bot Afetado:** \`${labels.bot}\`` : null,
        labels.group ? `- **Grupo:** \`${labels.group}\`` : null,
        `- **Descrição:** ${description}`,
        `- **Gerado em:** \`${alert.startsAt || new Date().toISOString()}\``,
        `\n> **Ação Autônoma:** Criado automaticamente pelo Webhook de Telemetria do DeskRPG (Zero Gambiarra).`,
      ]
        .filter(Boolean)
        .join("\n");

      // Insert safely into the target board DB (bypass default WIP of 5 for P0 critical incidents)
      const result = insertTaskSafely(boardSlug, {
        title,
        body,
        assignee,
        priority,
        parentId: "root-incident",
        initialStatus: "ready",
        wipLimit: priority >= 9 ? 100 : 50,
        dedupKey,
        updateComment: `🔁 [ALERTA DUPLICADO INIBIDO] O evento '${summary}' foi recebido novamente para o mesmo alerta/tier/alvo/janela (fingerprint ${fingerprint}). Card ativo mantido e evento registrado.`,
      });

      if (result.success && result.taskId && result.reason === "updated_existing") {
        updatedTasks.push({ taskId: result.taskId, board: boardSlug, title });
      } else if (result.success && result.taskId && result.reason !== "already_exists") {
        createdTasks.push({ taskId: result.taskId, board: boardSlug, title });

        // Dispatch alert to DeskRPG Tactical Room (NOC / War Room)
        try {
          const tactical = await resolveTacticalRoomId("1586d6fd-d570-4c19-9b98-bde557e95589", "site-reliability-engineer");
          if (tactical) {
            const noticeContent = [
              `🚨 **[INCIDENTE DE PRODUÇÃO DETECTADO]** \`${result.taskId}\``,
              `**Assunto:** ${title}`,
              `👤 Atribuído a: @${assignee}`,
              `📋 Board: \`${boardSlug}\``,
              `*Origem: Vector ➔ Prometheus ➔ Alertmanager ➔ DeskRPG Webhook*`,
            ].join("\n");

            await appendRoomMessage({
              roomId: tactical.roomId,
              senderId: null,
              senderName: "Alertmanager Sentinel",
              senderKind: "system",
              content: noticeContent,
            });
          }
        } catch (noticeErr) {
          console.warn("[alertmanager-webhook] Failed to post tactical room notice:", noticeErr);
        }
      }
    }

    return NextResponse.json({
      ok: true,
      processed: payload.alerts.length,
      tasksCreated: createdTasks,
      tasksUpdated: updatedTasks,
      tasksResolved: resolvedTasks,
    });
  } catch (err: any) {
    console.error("[alertmanager-webhook] Error processing webhook:", err);
    return NextResponse.json({ error: "internal_error", message: err.message }, { status: 500 });
  }
}
