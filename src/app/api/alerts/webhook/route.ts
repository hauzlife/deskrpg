import { POST as alertmanagerWebhook } from "@/lib/alertmanager-webhook";

export const runtime = "nodejs";

/**
 * Alertmanager's canonical DeskRPG receiver.
 *
 * Keep the Next route as a transport-only adapter. The parser, authentication boundary, task
 * creation, and notification dispatch live in a server library so they can be exercised without
 * importing a Next route module and so the compatibility webhook can share the exact contract.
 */
export const POST = alertmanagerWebhook;
