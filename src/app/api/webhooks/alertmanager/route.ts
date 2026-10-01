import { POST as alertmanagerWebhook } from "@/lib/alertmanager-webhook";

export const runtime = "nodejs";

/** Compatibility path for deployments that expose webhooks under /api/webhooks. */
export const POST = alertmanagerWebhook;
