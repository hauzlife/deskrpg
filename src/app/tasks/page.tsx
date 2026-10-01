"use client";

import { Suspense, useEffect, useState } from "react";
import KanbanBoardModal from "@/components/kanban/KanbanBoardModal";
import { useT } from "@/lib/i18n";

export default function TasksPage() {
  const t = useT();
  return (
    <Suspense
      fallback={
        <div className="theme-web min-h-screen flex items-center justify-center bg-bg text-text">
          {t("common.loading")}
        </div>
      }
    >
      <TasksPageInner />
    </Suspense>
  );
}

function TasksPageInner() {
  const t = useT();
  const [channels, setChannels] = useState<Array<{ id: string; name: string }>>([]);
  const [selectedChannelId, setSelectedChannelId] = useState<string>("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    fetch("/api/channels")
      .then((res) => (res.ok ? res.json() : { channels: [] }))
      .then((data) => {
        if (!alive) return;
        const list = Array.isArray(data.channels) ? data.channels : [];
        setChannels(list);
        if (list.length > 0) {
          setSelectedChannelId((prev) =>
            prev && list.some((c: { id: string }) => c.id === prev) ? prev : list[0].id,
          );
        }
      })
      .catch(() => {
        if (alive) setChannels([]);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, []);

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
        <h1 className="text-2xl font-bold mb-4">{t("nav.tasks")}</h1>
        <p className="text-text-muted">{t("channels.empty") || "No offices/channels found."}</p>
      </div>
    );
  }

  return (
    <div className="theme-web workspace-page p-4 flex flex-col flex-1 h-[calc(100vh-2rem)]">
      <KanbanBoardModal
        channelId={selectedChannelId}
        channels={channels}
        onSelectChannel={setSelectedChannelId}
        embedded={true}
        onClose={() => {}}
      />
    </div>
  );
}
