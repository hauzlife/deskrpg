"use client";

import { Suspense } from "react";
import ApprovalsPanel from "@/components/approvals/ApprovalsPanel";
import { useWorkspaceChannels } from "@/components/workspace/use-workspace-channels";
import { useT } from "@/lib/i18n";

export default function ApprovalsPage() {
  const t = useT();
  return (
    <Suspense
      fallback={
        <div className="theme-web min-h-screen flex items-center justify-center bg-bg text-text">
          {t("common.loading")}
        </div>
      }
    >
      <ApprovalsPageInner />
    </Suspense>
  );
}

function ApprovalsPageInner() {
  const t = useT();
  const { channels, selectedChannelId, setSelectedChannelId, loading } = useWorkspaceChannels();

  if (loading) {
    return (
      <div className="theme-web workspace-page flex items-center justify-center p-8 text-text-dim text-sm min-h-[400px]">
        {t("common.loading")}
      </div>
    );
  }

  if (channels.length === 0) {
    return (
      <div className="theme-web workspace-page p-8">
        <h1 className="text-2xl font-bold mb-4">{t("nav.approvals") || "Approvals"}</h1>
        <p className="text-text-muted">{t("channels.empty") || "No offices/channels found."}</p>
      </div>
    );
  }

  return (
    <div className="theme-web workspace-page p-4 flex flex-col flex-1 h-[calc(100vh-2rem)]">
      {channels.length > 1 && (
        <div className="mb-3 flex items-center gap-2">
          <label className="text-xs font-semibold text-text-dim">Office:</label>
          <select
            value={selectedChannelId}
            onChange={(e) => setSelectedChannelId(e.target.value)}
            className="rounded border border-border bg-surface px-2.5 py-1 text-xs font-medium text-text focus:border-primary focus:outline-none"
          >
            {channels.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
      )}

      <div className="flex-1 rounded-xl border border-border bg-surface overflow-hidden shadow-sm">
        <ApprovalsPanel channelId={selectedChannelId} embedded={true} />
      </div>
    </div>
  );
}
