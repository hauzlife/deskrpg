"use client";

import { Suspense } from "react";
import ArtifactsModal from "@/components/artifacts/ArtifactsModal";
import { useWorkspaceChannels } from "@/components/workspace/use-workspace-channels";
import { useT } from "@/lib/i18n";

export default function ArtifactsPage() {
  const t = useT();
  return (
    <Suspense
      fallback={
        <div className="theme-web min-h-screen flex items-center justify-center bg-bg text-text">
          {t("common.loading")}
        </div>
      }
    >
      <ArtifactsPageInner />
    </Suspense>
  );
}

function ArtifactsPageInner() {
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
        <h1 className="text-2xl font-bold mb-4">{t("nav.artifacts")}</h1>
        <p className="text-text-muted">{t("channels.empty") || "No offices/channels found."}</p>
      </div>
    );
  }

  return (
    <div className="theme-web workspace-page p-4 flex flex-col flex-1 h-[calc(100vh-2rem)]">
      <ArtifactsModal
        channelId={selectedChannelId}
        channels={channels}
        onSelectChannel={setSelectedChannelId}
        embedded={true}
      />
    </div>
  );
}
