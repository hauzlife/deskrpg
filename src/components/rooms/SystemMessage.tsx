"use client";

import { useT } from "@/lib/i18n";
import MarkdownContent from "../ui/MarkdownContent";

interface SystemMessageProps {
  /** JSON put in by the server — of the form `{"kind":"invited","names":[…]}`. */
  content: string;
}

type SystemPayload = { kind?: string; names?: unknown; name?: unknown };

/**
 * The server writes system lines without knowing the locale. So the body is JSON,
 * and the sentence is built here. If parsing fails (old format, truncated value),
 * shows the raw content as-is — better than swallowing it.
 */
export function systemMessageText(
  content: string,
  t: (key: string, params?: Record<string, string | number>) => string,
): string {
  let payload: SystemPayload;
  try {
    payload = JSON.parse(content) as SystemPayload;
  } catch {
    return content;
  }
  if (!payload || typeof payload !== "object") return content;
  const names = Array.isArray(payload.names) ? payload.names.map(String) : [];
  const name = typeof payload.name === "string" ? payload.name : "";
  switch (payload.kind) {
    case "invited":
      return names.length > 0 ? t("room.system.invited", { names: names.join(", ") }) : content;
    case "left":
      return name ? t("room.system.left", { name }) : content;
    case "renamed":
      return name ? t("room.system.renamed", { name }) : content;
    default:
      return content;
  }
}

export default function SystemMessage({ content }: SystemMessageProps) {
  const t = useT();
  const text = systemMessageText(content, t);
  const isAlert =
    content.includes("\n") ||
    content.includes("**") ||
    content.includes("[") ||
    content.startsWith("🚨") ||
    content.startsWith("✅") ||
    content.startsWith("🔴") ||
    content.startsWith("🟢") ||
    content.startsWith("🟠");

  if (isAlert) {
    return (
      <div className="my-1.5 flex justify-start" data-system-alert="true">
        <div className="max-w-[90%] w-full px-3 py-2 rounded-lg text-body bg-surface-raised border border-border text-text shadow-sm">
          <MarkdownContent content={text} />
        </div>
      </div>
    );
  }

  return (
    <div className="py-1 text-center text-caption text-text-muted">
      {text}
    </div>
  );
}
