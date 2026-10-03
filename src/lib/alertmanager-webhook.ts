import { NextRequest, NextResponse } from "next/server";
import {
  insertTaskSafely,
  resolveTacticalRoomId,
  getSqliteDatabase,
} from "@/lib/autonomous-lifecycle-hooks";
import { appendRoomMessage } from "@/lib/chat-rooms";
import { requestEmitRoomMessage } from "@/lib/automation-registry";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";
import { createHash, timingSafeEqual } from "node:crypto";

export interface AlertManagerAlert {
  status: "firing" | "resolved";
  labels: Record<string, string>;
  annotations: Record<string, string>;
  startsAt?: string;
  endsAt?: string;
  generatorURL?: string;
  fingerprint?: string;
}

export interface AlertManagerWebhookPayload {
  version?: string;
  groupKey?: string;
  status: "firing" | "resolved";
  receiver?: string;
  alerts: AlertManagerAlert[];
  commonLabels?: Record<string, string>;
  commonAnnotations?: Record<string, string>;
  externalURL?: string;
}

const ALERT_STATUSES = new Set<AlertManagerAlert["status"]>(["firing", "resolved"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isStringRecord(value: unknown): value is Record<string, string> {
  return isRecord(value) && Object.values(value).every((entry) => typeof entry === "string");
}

/** Runtime validation for the Alertmanager v4 webhook schema. */
export function isAlertManagerWebhookPayload(value: unknown): value is AlertManagerWebhookPayload {
  if (!isRecord(value) || !ALERT_STATUSES.has(value.status as AlertManagerAlert["status"]))
    return false;
  if (!Array.isArray(value.alerts)) return false;

  return value.alerts.every((alert) => {
    if (!isRecord(alert) || !ALERT_STATUSES.has(alert.status as AlertManagerAlert["status"]))
      return false;
    if (!isStringRecord(alert.labels) || !isStringRecord(alert.annotations)) return false;
    return ["startsAt", "endsAt", "generatorURL", "fingerprint"].every(
      (field) => alert[field] === undefined || typeof alert[field] === "string",
    );
  });
}

const ALERT_FINGERPRINT_PREFIX = "alertmanager-fingerprint:";
const TARGET_LABEL_KEYS = [
  "target",
  "service",
  "endpoint",
  "instance",
  "server",
  "host",
  "namespace",
  "bot",
  "group",
];

function normalizeFingerprintPart(value: string | undefined, fallback: string): string {
  const normalized = value?.trim().toLowerCase().replace(/\s+/g, " ");
  return normalized || fallback;
}

function resolveAlertTarget(labels: Record<string, string>): string {
  const targetParts = TARGET_LABEL_KEYS.filter((key) => labels[key]?.trim()).map(
    (key) => `${key}=${normalizeFingerprintPart(labels[key], "unknown")}`,
  );
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
 * An incident is equivalent when alert name, tier, target and evaluation window
 * are equivalent. Excludes volatile summary/description to ensure idempotent updates.
 */
export function buildAlertFingerprint(alert: AlertManagerAlert): string {
  const labels = alert.labels || {};
  const source = alert.fingerprint?.trim()
    ? `alertmanager:${normalizeFingerprintPart(alert.fingerprint, "unknown-fingerprint")}`
    : [
        normalizeFingerprintPart(labels.alertname, "unknown-alert"),
        normalizeFingerprintPart(labels.tier || labels.service_tier, "default-tier"),
        normalizeFingerprintPart(resolveAlertTarget(labels), "global"),
        normalizeFingerprintPart(resolveAlertWindow(alert), "default"),
      ].join("\u001f");
  return createHash("sha256").update(source, "utf8").digest("hex").slice(0, 24);
}

export function fingerprintMarker(fingerprint: string): string {
  return `<!-- ${ALERT_FINGERPRINT_PREFIX}${fingerprint} -->`;
}

function isSafeBoardSlug(value: string): boolean {
  return /^[a-z0-9](?:[a-z0-9_-]{0,62})$/.test(value);
}

/**
 * Resolves target operational Kanban board slug based on alert labels.
 * Routes infrastructure/host/platform alerts to infra-ops and traffic/bot/telegram alerts to hot-telegram.
 * Explicit labels are constrained to slugs so an untrusted webhook cannot select a filesystem path.
 */
export function resolveBoardSlug(labels: Record<string, string>): string {
  const tier = (labels.tier || "").toLowerCase();
  const alertname = (labels.alertname || "").toLowerCase();
  const job = (labels.job || "").toLowerCase();
  const component = (labels.component || "").toLowerCase();

  const isInfra =
    alertname.includes("pm2") ||
    alertname.includes("crash") ||
    alertname.includes("cluster") ||
    alertname.includes("stderr") ||
    alertname.includes("restart") ||
    alertname.includes("error_burst") ||
    alertname.includes("error_ratio") ||
    alertname.includes("warning_burst") ||
    alertname.includes("node") ||
    alertname.includes("host") ||
    alertname.includes("disk") ||
    alertname.includes("memory") ||
    alertname.includes("cpu") ||
    alertname.includes("endpointdown") ||
    alertname.includes("sslcert") ||
    tier.includes("infra") ||
    tier.includes("platform") ||
    tier.includes("system") ||
    tier.includes("host") ||
    tier.includes("network") ||
    job.includes("node") ||
    job.includes("infra") ||
    job.includes("system") ||
    component.includes("node") ||
    component.includes("system");

  const fallback = isInfra
    ? "infra-ops"
    : tier.includes("traffic") ||
        tier.includes("billing") ||
        tier.includes("telegram") ||
        labels.bot
      ? "hot-telegram"
      : tier.includes("mystelia") || tier.includes("esoteric")
        ? "mystelia"
        : tier.includes("crypto") || tier.includes("bloopu")
          ? "bloopu"
          : tier.includes("social")
            ? "social"
            : "hot-telegram";

  const explicit = (labels.project || labels.board || "").trim().toLowerCase();
  return explicit && isSafeBoardSlug(explicit) ? explicit : fallback;
}

/**
 * Resolves specialist profile assignee based on alert domain and board.
 */
export function resolveAssignee(labels: Record<string, string>, boardSlug?: string): string {
  if (labels.assignee) return labels.assignee;
  const alertName = (labels.alertname || "").toLowerCase();
  const tier = (labels.tier || "").toLowerCase();
  const severity = (labels.severity || "").toLowerCase();
  const board = (boardSlug || "").toLowerCase();

  if (board === "infra-ops" || tier.includes("infra") || tier.includes("platform")) {
    if (
      alertName.includes("ssl") ||
      alertName.includes("cert") ||
      alertName.includes("disk") ||
      alertName.includes("node")
    ) {
      return "platform-engineer";
    }
    return "site-reliability-engineer";
  }

  if (
    alertName.includes("login") ||
    alertName.includes("mtproto") ||
    alertName.includes("session")
  ) {
    return "site-reliability-engineer";
  }
  if (severity === "critical" || alertName.includes("halted") || alertName.includes("delivery")) {
    return "backend-engineer";
  }
  return "backend-engineer";
}

/**
 * Validates authentication/authorization for Alertmanager webhook requests.
 * Supports:
 * - Bearer token in Authorization header
 * - X-Alertmanager-Secret or X-Webhook-Secret header
 * - token or secret query parameter
 * When ALERTMANAGER_WEBHOOK_SECRET is set, enforces credentials.
 * When not set, allows requests (open internal network mode).
 */
export function validateWebhookAuth(req: NextRequest): { authorized: boolean; reason?: string } {
  const configuredSecret =
    process.env.ALERTMANAGER_WEBHOOK_SECRET || process.env.ALERTMANAGER_SECRET;
  if (!configuredSecret) {
    return { authorized: true };
  }

  const matchesSecret = (candidate: string | null): boolean => {
    if (!candidate) return false;
    const expected = Buffer.from(configuredSecret, "utf8");
    const actual = Buffer.from(candidate, "utf8");
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  };

  const authHeader = req.headers.get("authorization");
  if (authHeader) {
    const bearer = authHeader.match(/^Bearer\s+(.+)$/i);
    if (bearer && matchesSecret(bearer[1])) {
      return { authorized: true };
    }
  }

  const customSecret =
    req.headers.get("x-alertmanager-secret") || req.headers.get("x-webhook-secret");
  if (matchesSecret(customSecret)) {
    return { authorized: true };
  }

  try {
    const url = new URL(req.url);
    const querySecret = url.searchParams.get("token") || url.searchParams.get("secret");
    if (matchesSecret(querySecret)) {
      return { authorized: true };
    }
  } catch {}

  return { authorized: false, reason: "Invalid or missing webhook authentication credentials" };
}

/**
 * Validates network-level access restrictions if ALERTMANAGER_ALLOWED_IPS is configured.
 */
export function validateNetworkSecurity(req: NextRequest): { allowed: boolean; reason?: string } {
  const allowedIpsStr = process.env.ALERTMANAGER_ALLOWED_IPS;
  if (!allowedIpsStr) {
    return { allowed: true };
  }
  const allowedIps = allowedIpsStr
    .split(",")
    .map((ip) => ip.trim())
    .filter(Boolean);
  if (allowedIps.length === 0) {
    return { allowed: true };
  }

  const forwardedFor = req.headers.get("x-forwarded-for");
  const forwardedIp = forwardedFor
    ? forwardedFor.split(",")[0].trim()
    : req.headers.get("x-real-ip");
  let clientIp = forwardedIp?.trim() || "";
  if (!clientIp) {
    try {
      const hostname = new URL(req.url).hostname;
      if (hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]") {
        clientIp = "127.0.0.1";
      }
    } catch {
      // Treat an unparseable request URL as an unknown client, not as loopback.
    }
  }

  const isLocal = clientIp === "127.0.0.1" || clientIp === "::1" || clientIp === "localhost";
  if (isLocal || allowedIps.includes(clientIp)) {
    return { allowed: true };
  }

  return { allowed: false, reason: `Client IP ${clientIp} not in allowed network range` };
}

/**
 * Synchronizes incoming alerts directly with the local Artifact Pyramid.
 * Ensures zero data loss, strict idempotency, and full traceability.
 */
export function syncAlertToArtifactPyramid(
  alert: AlertManagerAlert,
  boardSlug: string,
  isResolved = false,
): void {
  try {
    const pyramidDir = path.join(
      os.homedir(),
      "Projects",
      "hauzhouse",
      "hot-operation",
      "hot-traffic",
      "artifacts",
      "infra-health-dashboard",
    );
    const dossiersDir = path.join(pyramidDir, "03-dossiers");
    const historyPath = path.join(dossiersDir, "telemetry-events-history.json");

    if (!fs.existsSync(historyPath)) return;

    const raw = fs.readFileSync(historyPath, "utf-8");
    const history = JSON.parse(raw);
    const nowIso = new Date().toISOString();
    const fp = buildAlertFingerprint(alert);
    const alertname = alert.labels.alertname || "UnknownAlert";
    const server = alert.labels.instance || alert.labels.server || "187.77.141.106";
    const worker = alert.labels.bot || alert.labels.worker || alert.labels.group || "cluster";

    const existing = history.events.find(
      (e: any) => e.fingerprint === fp || e.alertname === alertname,
    );
    if (existing) {
      existing.last_seen = nowIso;
      existing.status = isResolved ? "resolved" : "firing";
      if (!isResolved) {
        existing.occurrences = (existing.occurrences || 1) + 1;
      } else {
        existing.resolved_at = nowIso;
      }
    } else if (!isResolved) {
      history.events.push({
        fingerprint: fp,
        alertname,
        server,
        worker,
        severity: alert.labels.severity || "warning",
        first_seen: nowIso,
        last_seen: nowIso,
        occurrences: 1,
        status: "firing",
        notes:
          alert.annotations.summary ||
          alert.annotations.description ||
          "Alerta registrado no pyramid",
      });
    }

    history.updated_at = nowIso;
    fs.writeFileSync(historyPath, JSON.stringify(history, null, 2), "utf-8");
  } catch (err) {
    // Non-fatal logging
    console.warn("[alertmanager-webhook] Failed to sync to artifact pyramid:", err);
  }
}

export async function POST(req: NextRequest) {
  try {
    // 1. Network security check
    const networkCheck = validateNetworkSecurity(req);
    if (!networkCheck.allowed) {
      return NextResponse.json(
        { error: "forbidden", message: networkCheck.reason },
        { status: 403 },
      );
    }

    // 2. Authentication check
    const authCheck = validateWebhookAuth(req);
    if (!authCheck.authorized) {
      return NextResponse.json(
        { error: "unauthorized", message: authCheck.reason },
        { status: 401 },
      );
    }

    let rawBody: unknown;
    try {
      rawBody = await req.json();
    } catch {
      return NextResponse.json(
        { error: "invalid_payload", message: "Payload must be valid JSON" },
        { status: 400 },
      );
    }

    if (!isRecord(rawBody)) {
      return NextResponse.json(
        { error: "invalid_payload", message: "Expected Alertmanager or Langfuse webhook payload" },
        { status: 400 },
      );
    }

    // Support Langfuse Monitor Alerts
    if (rawBody.type === "monitor-alert") {
      const monitorPayload = isRecord(rawBody.payload) ? rawBody.payload : {};
      const monitorMessage = isRecord(monitorPayload.message) ? monitorPayload.message : {};
      const severityValue =
        typeof monitorPayload.severity === "string" ? monitorPayload.severity : "ALERT";
      const severity = severityValue.toUpperCase();
      const priority = severity === "ALERT" ? 10 : 8;
      const title = `[LANGFUSE-${severity}] ${typeof monitorMessage.title === "string" ? monitorMessage.title : "Qualidade/Custo Comprometido"}`;
      const permalink =
        typeof monitorPayload.permalink === "string"
          ? monitorPayload.permalink
          : "https://us.cloud.langfuse.com";
      const monitorBody =
        typeof monitorMessage.body === "string"
          ? monitorMessage.body
          : "Métrica ultrapassou o limiar de qualidade/custo.";
      const monitorId =
        typeof monitorPayload.monitorId === "string" ? monitorPayload.monitorId : "desconhecido";
      const window = typeof monitorPayload.window === "string" ? monitorPayload.window : "1h";
      const body = [
        `### 🚨 Alerta de Observabilidade — Langfuse`,
        `- **Monitor ID:** \`${monitorId}\``,
        `- **Gravidade:** \`${severity}\``,
        `- **Mensagem:** ${monitorBody}`,
        `- **Janela:** \`${window}\``,
        `- **Painel Langfuse:** [Acessar Monitor](${permalink})`,
        `\n> **Ação Autônoma:** Incidente aberto via Webhook de Alertas do Langfuse.`,
      ].join("\n");

      const boardSlug = "eng-ops";
      const assignee = "backend-engineer";
      const testDbPath = req.headers.get("x-test-database-path") || process.env.TEST_KANBAN_DB_PATH;

      const result = insertTaskSafely(boardSlug, {
        title,
        body,
        assignee,
        priority,
        parentId: "langfuse-alert",
        initialStatus: "ready",
        databasePath: testDbPath || undefined,
      });

      try {
        const tactical = await resolveTacticalRoomId(
          "1586d6fd-d570-4c19-9b98-bde557e95589",
          "backend-engineer",
        );
        if (tactical) {
          const message = await appendRoomMessage({
            roomId: tactical.roomId,
            senderId: null,
            senderName: "Langfuse Sentinel",
            senderKind: "system",
            content: `🚨 **[ALERTA LANGFUSE ${severity}]** ${title}\n${monitorBody}\n🔗 [Abrir no Langfuse](${permalink})`,
          });
          requestEmitRoomMessage(tactical.roomId, message);
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

    if (!isAlertManagerWebhookPayload(rawBody)) {
      return NextResponse.json(
        { error: "invalid_payload", message: "Expected Alertmanager or Langfuse webhook payload" },
        { status: 400 },
      );
    }
    const payload = rawBody;

    const createdTasks: Array<{ taskId: string; board: string; title: string }> = [];
    const updatedTasks: Array<{ taskId: string; board: string; title: string }> = [];
    const resolvedTasks: Array<{ taskId: string; board: string; title: string }> = [];
    const notificationPromises: Promise<void>[] = [];

    const testDbPath = req.headers.get("x-test-database-path") || process.env.TEST_KANBAN_DB_PATH;

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
      const assignee = resolveAssignee(labels, boardSlug);
      const severity = labels.severity?.toUpperCase() ?? "HIGH";
      const priority = severity === "CRITICAL" ? 10 : 8;
      const summary =
        annotations.summary ||
        annotations.title ||
        annotations.message ||
        labels.alertname ||
        "Incidente Operacional Detectado";

      if (alert.status === "resolved") {
        try {
          const dbPath =
            testDbPath ||
            path.join(os.homedir(), ".hermes", "kanban", "boards", boardSlug, "kanban.db");
          if (fs.existsSync(dbPath)) {
            const sqlite = getSqliteDatabase(dbPath);
            const searchKeyword = labels.alertname || summary;

            // Search by fingerprint marker first, then fallback to alertname/summary
            let tasks = sqlite
              .prepare(
                "SELECT id, title, assignee FROM tasks WHERE status NOT IN ('done', 'archived') AND title NOT LIKE '%Infra Health Dashboard%' AND title NOT LIKE '%Incident Sentinel%' AND body LIKE ?",
              )
              .all(`%${dedupKey}%`) as Array<{ id: string; title: string; assignee: string }>;

            if (tasks.length === 0) {
              tasks = sqlite
                .prepare(
                  "SELECT id, title, assignee FROM tasks WHERE status NOT IN ('done', 'archived') AND title NOT LIKE '%Infra Health Dashboard%' AND title NOT LIKE '%Incident Sentinel%' AND (title LIKE ? OR body LIKE ?)",
                )
                .all(`%${searchKeyword}%`, `%${searchKeyword}%`) as Array<{
                id: string;
                title: string;
                assignee: string;
              }>;
            }

            // Also notify active master card if present, without closing it
            const activeMaster = sqlite
              .prepare(
                "SELECT id, title FROM tasks WHERE status NOT IN ('done', 'archived') AND (title LIKE '%Infra Health Dashboard%' OR title LIKE '%Incident Sentinel%') LIMIT 1",
              )
              .get() as { id: string; title: string } | undefined;

            const now = Math.floor(Date.now() / 1000);
            if (activeMaster) {
              const masterComment = `✅ [TELEMETRIA NORMALIZADA] O alerta '${summary}' foi resolvido no Grafana/Alertmanager em ${alert.endsAt || new Date().toISOString()}. Sub-evento normalizado no dashboard.`;
              try {
                sqlite
                  .prepare(
                    "INSERT INTO task_comments (task_id, author, body, created_at) VALUES (?, 'sre-grafana-alertmanager', ?, ?)",
                  )
                  .run(activeMaster.id, masterComment, now);
              } catch {}
            }

            for (const t of tasks) {
              const resolveComment = `✅ [AUTO-RESOLVED] O alerta '${summary}' foi resolvido no Grafana/Alertmanager em ${alert.endsAt || new Date().toISOString()}. Telemetria normalizada.`;
              try {
                sqlite
                  .prepare(
                    "INSERT INTO task_comments (task_id, author, body, created_at) VALUES (?, 'sre-grafana-alertmanager', ?, ?)",
                  )
                  .run(t.id, resolveComment, now);
              } catch {}

              sqlite
                .prepare(
                  "UPDATE tasks SET status = 'done', completed_at = ?, result = ? WHERE id = ?",
                )
                .run(now, "auto-resolved by telemetry monitor", t.id);

              try {
                sqlite
                  .prepare(
                    "INSERT INTO task_events (task_id, run_id, kind, payload, created_at) VALUES (?, NULL, 'completed', ?, ?)",
                  )
                  .run(t.id, JSON.stringify({ summary: resolveComment }), now);
              } catch {}

              resolvedTasks.push({ taskId: t.id, board: boardSlug, title: t.title });
              syncAlertToArtifactPyramid(alert, boardSlug, true);

              // Post resolution notice asynchronously to tactical room
              notificationPromises.push(
                (async () => {
                  try {
                    const tactical = await resolveTacticalRoomId(
                      "1586d6fd-d570-4c19-9b98-bde557e95589",
                      "site-reliability-engineer",
                    );
                    if (tactical) {
                      const resolveNotice = [
                        `🟢 **[INCIDENTE RESOLVIDO — TELEMETRIA]** \`${t.id}\``,
                        `**Assunto:** ${t.title}`,
                        `👤 Notificando: @${t.assignee || assignee}`,
                        `📋 Board: \`${boardSlug}\``,
                        `*Status:* Resolvido no Grafana/Alertmanager. Card encerrado automaticamente.`,
                      ].join("\n");

                      const message = await appendRoomMessage({
                        roomId: tactical.roomId,
                        senderId: null,
                        senderName: "Alertmanager Sentinel",
                        senderKind: "system",
                        content: resolveNotice,
                      });
                      requestEmitRoomMessage(tactical.roomId, message);
                    }
                  } catch (noticeErr) {
                    console.warn(
                      "[alertmanager-webhook] Failed to post resolution notice:",
                      noticeErr,
                    );
                  }
                })(),
              );
            }
          }
        } catch (resolveErr) {
          console.error("[alertmanager-webhook] Error auto-resolving task:", resolveErr);
        }
        continue;
      }

      if (alert.status !== "firing") continue;

      const description =
        annotations.description ||
        annotations.message ||
        annotations.summary ||
        labels.description ||
        "Alerta recebido do Alertmanager / Vector telemetry pipeline.";

      const title = `[INCIDENT-${severity}][${boardSlug.toUpperCase()}] ${summary}`;
      const body = [
        dedupKey,
        `### 🚨 Alerta de Produção — Alertmanager [P0-EMERGENCY]`,
        `- **Alerta:** \`${labels.alertname || "Desconhecido"}\``,
        `- **Gravidade:** \`${severity}\``,
        `- **Prioridade:** \`${priority === 10 ? "P0 (Crítica)" : "P1 (Alta)"}\``,
        `- **Tier:** \`${labels.tier || "N/A"}\``,
        labels.instance ? `- **Instância/Host:** \`${labels.instance}\`` : null,
        labels.bot ? `- **Bot Afetado:** \`${labels.bot}\`` : null,
        labels.group ? `- **Grupo:** \`${labels.group}\`` : null,
        `- **Descrição:** ${description}`,
        `- **Gerado em:** \`${alert.startsAt || new Date().toISOString()}\``,
        `\n> **Ação Autônoma:** Criado automaticamente pelo Webhook de Telemetria do DeskRPG (Zero Gambiarra).`,
      ]
        .filter(Boolean)
        .join("\n");

      // Sync incoming alert event immediately to the local Artifact Pyramid (Zero Data Loss)
      syncAlertToArtifactPyramid(alert, boardSlug, false);

      // Check if an active Master Sentinel / Infra Health Dashboard card exists on this board
      const dbPath =
        testDbPath ||
        path.join(os.homedir(), ".hermes", "kanban", "boards", boardSlug, "kanban.db");
      let masterCard: { id: string; title: string; assignee: string } | undefined;
      if (fs.existsSync(dbPath)) {
        try {
          const sqlite = getSqliteDatabase(dbPath);
          masterCard = sqlite
            .prepare(
              "SELECT id, title, assignee FROM tasks WHERE status NOT IN ('done', 'archived') AND (title LIKE '%Infra Health Dashboard%' OR title LIKE '%Incident Sentinel%') LIMIT 1",
            )
            .get() as { id: string; title: string; assignee: string } | undefined;
        } catch {}
      }

      let result: ReturnType<typeof insertTaskSafely>;

      if (masterCard) {
        // CONSOLIDATION: Divert alert telemetry into the master card instead of creating duplicate cards!
        try {
          const sqlite = getSqliteDatabase(dbPath);
          const now = Math.floor(Date.now() / 1000);
          const updateText = `🚨 [TELEMETRIA CAPTADA] Alerta '${summary}' (severidade: ${severity}, worker/alvo: ${labels.bot || labels.instance || "cluster"}). Registrado no dashboard consolidado.`;
          sqlite
            .prepare(
              "INSERT INTO task_comments (task_id, author, body, created_at) VALUES (?, 'alertmanager-sentinel', ?, ?)",
            )
            .run(masterCard.id, updateText, now);
          sqlite
            .prepare(
              "INSERT INTO task_events (task_id, run_id, kind, payload, created_at) VALUES (?, NULL, 'updated', ?, ?)",
            )
            .run(
              masterCard.id,
              JSON.stringify({ alertname: labels.alertname, severity, summary }),
              now,
            );
        } catch {}

        result = {
          success: true,
          taskId: masterCard.id,
          reason: "updated_existing",
        };
      } else {
        // No master card exists: insert safely (creates new card or deduplicates via fingerprint)
        result = insertTaskSafely(boardSlug, {
          title,
          body,
          assignee,
          priority,
          parentId: "root-incident",
          initialStatus: "ready",
          wipLimit: priority >= 9 ? 100 : 50,
          dedupKey,
          databasePath: testDbPath || undefined,
          updateComment: `🔁 [ALERTA DUPLICADO INIBIDO] O evento '${summary}' foi recebido novamente para o mesmo alerta/tier/alvo/janela (fingerprint ${fingerprint}). Card ativo mantido e evento registrado.`,
        });
      }

      if (result.success && result.taskId && result.reason === "updated_existing") {
        updatedTasks.push({ taskId: result.taskId, board: boardSlug, title });
      } else if (result.success && result.taskId && result.reason !== "already_exists") {
        createdTasks.push({ taskId: result.taskId, board: boardSlug, title });

        // Non-blocking asynchronous tactical room dispatch and red banner broadcast
        notificationPromises.push(
          (async () => {
            try {
              const infraChannelId = "1586d6fd-d570-4c19-9b98-bde557e95589";
              const tactical = await resolveTacticalRoomId(infraChannelId, assignee);
              if (tactical) {
                const noticeContent = [
                  `🚨 **[INCIDENTE DE PRODUÇÃO DETECTADO — P0]** \`${result.taskId}\``,
                  `**Assunto:** ${title}`,
                  `👤 Atribuído a: @${assignee}`,
                  `📋 Board: \`${boardSlug}\``,
                  `⚠️ Gravidade: \`${severity}\` (Prioridade: ${priority})`,
                  `*Origem: Vector ➔ Prometheus ➔ Alertmanager ➔ DeskRPG Webhook*`,
                ].join("\n");

                const message = await appendRoomMessage({
                  roomId: tactical.roomId,
                  senderId: null,
                  senderName: "Alertmanager Sentinel",
                  senderKind: "system",
                  content: noticeContent,
                });
                requestEmitRoomMessage(tactical.roomId, message);
              }
            } catch (noticeErr) {
              console.warn(
                "[alertmanager-webhook] Failed to post tactical room notice:",
                noticeErr,
              );
            }
          })(),
        );
      }
    }

    // Do not make Alertmanager wait for the room database/socket path. Each promise catches its
    // own broadcast failure, while the task creation result is returned immediately.
    if (notificationPromises.length > 0) {
      void Promise.allSettled(notificationPromises);
    }

    return NextResponse.json({
      ok: true,
      processed: payload.alerts.length,
      tasksCreated: createdTasks,
      tasksUpdated: updatedTasks,
      tasksResolved: resolvedTasks,
    });
  } catch (err: unknown) {
    console.error("[alertmanager-webhook] Error processing webhook:", err);
    return NextResponse.json(
      { error: "internal_error", message: "Webhook processing failed" },
      { status: 500 },
    );
  }
}
