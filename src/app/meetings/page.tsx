"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { CalendarDays, RefreshCw, Sparkles } from "lucide-react";
import KanbanCalendarView from "@/components/kanban/KanbanCalendarView";
import MinutesModal from "@/components/MinutesModal";
import ScrumCeremonyModal from "@/components/kanban/ScrumCeremonyModal";
import {
  ProjectPicker,
  useSelectedBoard,
  type ProjectOption,
} from "@/components/kanban/ProjectPicker";
import { createKanbanApi } from "@/components/kanban/kanban-api";
import { flattenTasks, orderColumns } from "@/components/kanban/kanban-view-model";
import { useWorkspaceChannels } from "@/components/workspace/use-workspace-channels";
import type { KanbanTask } from "@/lib/hermes/deskrpg-plugin-types";
import { useT } from "@/lib/i18n";

export default function MeetingsPage() {
  const t = useT();
  return (
    <Suspense
      fallback={
        <div className="theme-web min-h-screen flex items-center justify-center bg-bg text-text">
          {t("common.loading")}
        </div>
      }
    >
      <MeetingsPageInner />
    </Suspense>
  );
}

function MeetingsPageInner() {
  const t = useT();
  const router = useRouter();
  const {
    channels,
    selectedChannelId,
    setSelectedChannelId,
    loading: channelsLoading,
  } = useWorkspaceChannels();

  const [projects, setProjects] = useState<ProjectOption[]>([]);
  const [tasks, setTasks] = useState<readonly KanbanTask[]>([]);
  const [loadingTasks, setLoadingTasks] = useState(false);
  const [refreshTick, setRefreshTick] = useState(0);
  const [selectedMeetingId, setSelectedMeetingId] = useState<string | null>(null);
  const [ceremonyModalOpen, setCeremonyModalOpen] = useState(false);

  const { selected: selectedBoard, select: selectBoard } = useSelectedBoard(
    selectedChannelId,
    projects,
  );

  // Fetch projects/boards for selected channel
  useEffect(() => {
    if (!selectedChannelId) {
      setProjects([]);
      return;
    }
    let alive = true;
    if (selectedChannelId === "all") {
      Promise.all(
        channels.map(async (ch) => {
          try {
            const api = createKanbanApi(ch.id);
            const data = await api.projects();
            return Array.isArray(data?.projects) ? data.projects : [];
          } catch {
            return [];
          }
        }),
      ).then((res) => {
        if (!alive) return;
        const seen = new Set<string>();
        const merged: ProjectOption[] = [];
        for (const p of res.flat()) {
          if (!seen.has(p.boardSlug)) {
            seen.add(p.boardSlug);
            merged.push(p);
          }
        }
        setProjects(merged);
      });
      return () => {
        alive = false;
      };
    }
    const api = createKanbanApi(selectedChannelId);
    api
      .projects()
      .then((data) => {
        if (!alive) return;
        setProjects(Array.isArray(data?.projects) ? data.projects : []);
      })
      .catch(() => {
        if (alive) setProjects([]);
      });
    return () => {
      alive = false;
    };
  }, [selectedChannelId, channels]);

  // Fetch tasks for calendar display
  const loadTasks = useCallback(async () => {
    if (!selectedChannelId) {
      setTasks([]);
      return;
    }
    setLoadingTasks(true);
    try {
      if (selectedChannelId === "all") {
        const results = await Promise.all(
          channels.map(async (ch) => {
            try {
              const api = createKanbanApi(ch.id, undefined, selectedBoard ?? undefined);
              const res = await api.board(true);
              return flattenTasks(orderColumns(res.columns, true)).map((t) => ({
                ...t,
                _channelId: ch.id,
              }));
            } catch {
              return [];
            }
          }),
        );
        setTasks(results.flat());
      } else {
        const api = createKanbanApi(selectedChannelId, undefined, selectedBoard ?? undefined);
        const res = await api.board(true);
        setTasks(flattenTasks(orderColumns(res.columns, true)));
      }
    } catch {
      setTasks([]);
    } finally {
      setLoadingTasks(false);
    }
  }, [selectedChannelId, selectedBoard, channels]);

  useEffect(() => {
    void loadTasks();
  }, [loadTasks, refreshTick]);

  const handleOpenTask = useCallback(
    (taskId: string) => {
      router.push(`/tasks?taskId=${encodeURIComponent(taskId)}`);
    },
    [router],
  );

  if (channelsLoading) {
    return (
      <div className="theme-web workspace-page flex items-center justify-center p-8 text-text-dim text-sm min-h-[400px]">
        {t("common.loading")}
      </div>
    );
  }

  if (channels.length === 0) {
    return (
      <div className="theme-web workspace-page p-8">
        <h1 className="text-2xl font-bold mb-4">{t("nav.meetings")}</h1>
        <p className="text-text-muted">{t("channels.empty") || "No offices/channels found."}</p>
      </div>
    );
  }

  return (
    <div className="theme-web workspace-page p-4 flex flex-col flex-1 h-[calc(100vh-2rem)]">
      <div className="bg-bg border border-border rounded-xl shadow-xs w-full h-full flex flex-col overflow-hidden">
        {/* Header matching Tasks and Artifacts */}
        <div className="flex items-center justify-between gap-2 px-5 py-3 border-b border-border flex-shrink-0">
          <h2 className="text-sm font-bold flex items-center gap-1.5 text-text">
            <CalendarDays className="w-4 h-4 text-primary" />
            {t("nav.meetings")}
          </h2>
          <div className="flex items-center gap-2 text-xs">
            {channels.length > 0 && (
              <div className="flex items-center gap-1 bg-surface-raised px-2.5 py-1 rounded-md border border-border">
                <span className="text-text-muted font-medium">{t("nav.channels")}:</span>
                <select
                  value={selectedChannelId}
                  onChange={(e) => setSelectedChannelId(e.target.value)}
                  className="bg-transparent text-text font-semibold focus:outline-none cursor-pointer text-xs"
                >
                  <option value="all" className="bg-bg text-text">
                    {t("common.all") || "All Offices"}
                  </option>
                  {channels.map((ch) => (
                    <option key={ch.id} value={ch.id} className="bg-bg text-text">
                      {ch.name}
                    </option>
                  ))}
                </select>
              </div>
            )}
            <ProjectPicker options={projects} selected={selectedBoard} onSelect={selectBoard} />
            <button
              type="button"
              onClick={() => setCeremonyModalOpen(true)}
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-md border border-primary/40 bg-primary/10 hover:bg-primary/20 text-primary font-semibold text-xs shadow-2xs transition-colors cursor-pointer"
              title="Instanciar Cerimônia Scrum 3D"
            >
              <Sparkles className="w-3.5 h-3.5" />
              <span>Cerimônia Scrum</span>
            </button>
            <button
              type="button"
              onClick={() => setRefreshTick((n) => n + 1)}
              disabled={loadingTasks}
              title={t("common.retry") || "Refresh"}
              className="p-1 rounded-md border border-border bg-surface-raised hover:bg-surface text-text-muted hover:text-text disabled:opacity-50"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loadingTasks ? "animate-spin" : ""}`} />
            </button>
          </div>
        </div>

        {/* Calendar Body */}
        <div className="flex-1 min-h-0 overflow-y-auto">
          <KanbanCalendarView
            boardSlug={selectedBoard ?? ""}
            channelId={selectedChannelId}
            tasks={tasks}
            now={Date.now()}
            onOpenTask={handleOpenTask}
            onOpenMeeting={(meetingId) => setSelectedMeetingId(meetingId)}
            defaultFilters={{
              showMeetings: true,
              showDone: false,
              showBlocked: false,
              showRunning: false,
            }}
          />
        </div>
      </div>

      {selectedMeetingId && (
        <MinutesModal
          channelId={selectedChannelId}
          npcs={[]}
          initialMinutesId={selectedMeetingId}
          onClose={() => setSelectedMeetingId(null)}
        />
      )}

      <ScrumCeremonyModal
        isOpen={ceremonyModalOpen}
        onClose={() => setCeremonyModalOpen(false)}
        channelId={selectedChannelId}
        boardSlug={selectedBoard ?? ""}
        onCeremonyCreated={(meetingId) => {
          setRefreshTick((n) => n + 1);
          setSelectedMeetingId(meetingId);
        }}
      />
    </div>
  );
}
