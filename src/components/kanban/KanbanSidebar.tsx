"use client";

import { useState, useEffect, useCallback } from "react";
import { useT } from "@/lib/i18n";
import { X, KanbanSquare } from "lucide-react";
import { createKanbanApi } from "./kanban-api";
import { useSelectedBoard } from "./ProjectPicker";
import { useProjectViewState } from "./use-project-view-state";
import { computeOperationalMetrics } from "@/lib/kanban-metrics";
import type { KanbanBoard, KanbanRunsPage, KanbanStatusTransitionsPage } from "@/lib/hermes/deskrpg-plugin-types";
import type { BoardBlocker } from "./kanban-view-model";
import KanbanListView from "./KanbanListView";
import KanbanCalendarView from "./KanbanCalendarView";
import KanbanTimeline from "./KanbanTimeline";
import KanbanMetricsPanel from "./KanbanMetricsPanel";

interface KanbanSidebarProps {
  channelId: string;
  onClose: () => void;
  onConnectGateway?: () => void;
}

export default function KanbanSidebar({ channelId, onClose, onConnectGateway }: KanbanSidebarProps) {
  const t = useT();
  const [selectedBoard, selectBoard] = useSelectedBoard(channelId);
  const api = createKanbanApi(channelId, undefined, selectedBoard ?? undefined);

  const [status, setStatus] = useState<any>(null);
  const [board, setBoard] = useState<KanbanBoard | null>(null);
  const [blocker, setBlocker] = useState<BoardBlocker | null>(null);
  const [loading, setLoading] = useState(true);
  const [runsPage, setRunsPage] = useState<KanbanRunsPage | null>(null);
  const [transitionsPage, setTransitionsPage] = useState<KanbanStatusTransitionsPage | null>(null);
  const [runsLoading, setRunsLoading] = useState(false);
  const [runsError, setRunsError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());

  const { state: viewState, update: updateView, setFilter: setViewFilter } = useProjectViewState(channelId);
  const includeArchived = viewState.filter.includeArchived;

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const nextStatus = await api.status();
      setStatus(nextStatus);

      const data = await api.board(includeArchived);
      setBoard(data);
      setBlocker(null);
    } catch (err) {
      const failure = { code: "unknown", message: String(err) };
      setBlocker(failure as any);
    } finally {
      setLoading(false);
    }
  }, [api, includeArchived]);

  useEffect(() => {
    void reload();
  }, [reload]);

  // Timeline data
  const timelineWindow = { fromMs: Date.now() - 7 * 24 * 60 * 60 * 1000, toMs: Date.now() };

  useEffect(() => {
    if (!status?.capabilities?.includes("kanban_views")) return;
    setRunsLoading(true);
    api.runs({ from: Math.floor(timelineWindow.fromMs / 1000), to: Math.ceil(timelineWindow.toMs / 1000) })
      .then(setRunsPage)
      .catch(() => setRunsPage(null))
      .finally(() => setRunsLoading(false));
  }, [api, status?.capabilities]);

  useEffect(() => {
    if (!status?.capabilities?.includes("kanban_task_events")) return;
    api.statusTransitions({ from: Math.floor(timelineWindow.fromMs / 1000), to: Math.ceil(timelineWindow.toMs / 1000) })
      .then(setTransitionsPage)
      .catch(() => setTransitionsPage(null));
  }, [api, status?.capabilities]);

  const allTasks = board ? (board.columns || []).flatMap(c => c.tasks) : [];
  const visibleRuns = runsPage?.runs || [];
  const visibleTransitions = transitionsPage?.events || [];

  const metrics = computeOperationalMetrics(visibleRuns, allTasks, new Set(), timelineWindow, visibleTransitions);

  return (
    <div className="fixed inset-y-0 right-0 w-96 bg-bg border-l border-border flex flex-col z-50">
      <div className="flex items-center justify-between px-5 py-4 border-b border-border">
        <div className="flex items-center gap-2">
          <KanbanSquare className="w-5 h-5" />
          <h2 className="font-semibold">{t("kanban.title")}</h2>
        </div>
        <button onClick={onClose} className="p-1 hover:bg-surface-raised rounded">
          <X className="w-5 h-5" />
        </button>
      </div>

      <div className="flex-1 overflow-auto">
        {loading && !board && <div className="p-4 text-text-dim">{t("common.loading")}</div>}

        {blocker ? (
          <div className="p-4 text-danger">Kanban board unavailable</div>
        ) : board ? (
          <div className="p-4 space-y-6">
            {/* View selector */}
            <div className="flex gap-2">
              {["list", "calendar", "timeline"].map(mode => (
                <button
                  key={mode}
                  onClick={() => updateView({ viewMode: mode as any })}
                  className={`px-4 py-2 rounded text-sm ${viewState.viewMode === mode ? "bg-primary text-white" : "bg-surface-raised"}`}
                >
                  {t(`kanban.view.${mode}`) || mode}
                </button>
              ))}
            </div>

            {viewState.viewMode === "timeline" && (
              <KanbanTimeline
                runs={visibleRuns}
                window={timelineWindow}
                now={now}
                onOpenTask={() => {}}
                header={<KanbanMetricsPanel metrics={metrics} />}
              />
            )}

            {viewState.viewMode === "list" && (
              <KanbanListView
                groups={[]}
                groupBy={viewState.groupBy}
                npcs={[]}
                now={now}
                selectedTaskId={null}
                onOpen={() => {}}
                childrenOf={new Map()}
                parentsOf={new Map()}
                expanded={new Set()}
                loadingChildren={new Set()}
                onToggleExpand={() => {}}
              />
            )}

            {viewState.viewMode === "calendar" && (
              <KanbanCalendarView
                boardSlug={selectedBoard || ""}
                channelId={channelId}
                tasks={allTasks}
                now={now}
                onOpenTask={() => {}}
              />
            )}

            {viewState.viewMode === "board" && (
              <div className="text-sm text-text-dim">{t("kanban.view.board")}</div>
            )}
          </div>
        ) : null}
      </div>

      <div className="border-t border-border p-4 flex gap-2">
        <button onClick={() => selectBoard(null)} className="flex-1 py-2 text-sm bg-surface-raised hover:bg-surface rounded">
          {t("kanban.changeBoard")}
        </button>
        <button onClick={onClose} className="flex-1 py-2 text-sm bg-primary text-white rounded">
          {t("common.close")}
        </button>
      </div>
    </div>
  );
}