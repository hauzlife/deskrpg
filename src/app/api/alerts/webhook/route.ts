import { NextRequest, NextResponse } from "next/server";
import { insertTaskSafely, resolveTacticalRoomId } from "@/lib/autonomous-lifecycle-hooks";
import { appendRoomMessage } from "@/lib/chat-rooms";
import { db, chatRooms } from "@/db";
import { eq, and } from "drizzle-orm";

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
    const payload = (await req.json()) as AlertManagerWebhookPayload;
    if (!payload || !Array.isArray(payload.alerts)) {
      return NextResponse.json({ error: "invalid_payload", message: "Expected Alertmanager webhook payload" }, { status: 400 });
    }

    const createdTasks: Array<{ taskId: string; board: string; title: string }> = [];

    for (const alert of payload.alerts) {
      if (alert.status !== "firing") continue;

      const labels = alert.labels || {};
      const annotations = alert.annotations || {};
      const boardSlug = resolveBoardSlug(labels);
      const assignee = resolveAssignee(labels);
      const severity = labels.severity?.toUpperCase() ?? "HIGH";
      const priority = severity === "CRITICAL" ? 10 : 8;

      const summary = annotations.summary || labels.alertname || "Incidente Operacional Detectado";
      const description = annotations.description || "Alerta recebido do Alertmanager / Vector telemetry pipeline.";

      const title = `[INCIDENT-${severity}][${boardSlug.toUpperCase()}] ${summary}`;
      const body = [
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

      // Insert safely into the target board DB
      const result = insertTaskSafely(boardSlug, {
        title,
        body,
        assignee,
        priority,
        parentId: "root-incident",
        initialStatus: "ready",
      });

      if (result.success && result.taskId && result.reason !== "already_exists") {
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
    });
  } catch (err: any) {
    console.error("[alertmanager-webhook] Error processing webhook:", err);
    return NextResponse.json({ error: "internal_error", message: err.message }, { status: 500 });
  }
}
