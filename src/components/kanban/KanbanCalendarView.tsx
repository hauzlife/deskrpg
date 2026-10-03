"use client";

import { useMemo, useState, useEffect } from "react";
import {
  ChevronLeft,
  ChevronRight,
  Calendar as CalendarIcon,
  CheckCircle2,
  AlertTriangle,
  PlayCircle,
  Users,
} from "lucide-react";
import type { KanbanTask } from "@/lib/hermes/deskrpg-plugin-types";
import { taskTimeMs } from "@/lib/plugin-time";

export type CalendarPreset = "today" | "yesterday" | "7days" | "this_week" | "month";
export type CalendarViewMode = "month" | "week" | "schedule";

export interface CalendarMeetingItem {
  id: string;
  topic: string;
  createdAt: string;
  totalTurns?: number;
  durationSeconds?: number | null;
  participants?: Array<{ id: string; name: string }>;
}

export interface KanbanCalendarViewProps {
  boardSlug: string;
  channelId: string;
  tasks: readonly KanbanTask[];
  now: number;
  onOpenTask: (taskId: string) => void;
  onOpenMeeting?: (meetingId: string) => void;
  defaultFilters?: {
    showDone?: boolean;
    showMeetings?: boolean;
    showBlocked?: boolean;
    showRunning?: boolean;
  };
}

const WEEKDAYS = ["Seg", "Ter", "Qua", "Qui", "Sex", "Sáb", "Dom"];

function getStartOfWeek(date: Date): Date {
  const d = new Date(date);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1); // adjust when day is sunday
  d.setDate(diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

function formatDateKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export default function KanbanCalendarView({
  boardSlug: _boardSlug,
  channelId,
  tasks,
  now,
  onOpenTask,
  onOpenMeeting,
  defaultFilters,
}: KanbanCalendarViewProps) {
  const nowDate = useMemo(() => new Date(now), [now]);
  const [currentDate, setCurrentDate] = useState<Date>(() => new Date(now));
  const [preset, setPreset] = useState<CalendarPreset>("month");
  const [viewMode, setViewMode] = useState<CalendarViewMode>("month");

  // Filter toggles
  const [showDone, setShowDone] = useState(defaultFilters?.showDone ?? true);
  const [showMeetings, setShowMeetings] = useState(defaultFilters?.showMeetings ?? true);
  const [showBlocked, setShowBlocked] = useState(defaultFilters?.showBlocked ?? true);
  const [showRunning, setShowRunning] = useState(defaultFilters?.showRunning ?? true);

  // Meetings data
  const [meetings, setMeetings] = useState<CalendarMeetingItem[]>([]);

  // Selected Day Detail Modal
  const [selectedDayKey, setSelectedDayKey] = useState<string | null>(null);

  useEffect(() => {
    if (!channelId) return;
    fetch(`/api/meetings?channelId=${encodeURIComponent(channelId)}`)
      .then((r) => r.json())
      .then((data) => {
        const raw = Array.isArray(data.minutes) ? data.minutes : [];
        setMeetings(
          raw.map((m: any) => ({
            id: m.id,
            topic: m.topic || "Reunião DeskRPG",
            createdAt: m.createdAt || m.created_at || new Date().toISOString(),
            totalTurns: m.totalTurns || m.total_turns || 0,
            durationSeconds: m.durationSeconds || m.duration_seconds || null,
            participants: m.participants || [],
          })),
        );
      })
      .catch(() => {});
  }, [channelId]);

  // Handle Preset changes
  const applyPreset = (newPreset: CalendarPreset) => {
    setPreset(newPreset);
    const d = new Date(now);
    if (newPreset === "today") {
      setCurrentDate(d);
      setViewMode("schedule");
    } else if (newPreset === "yesterday") {
      d.setDate(d.getDate() - 1);
      setCurrentDate(d);
      setViewMode("schedule");
    } else if (newPreset === "7days") {
      setCurrentDate(d);
      setViewMode("schedule");
    } else if (newPreset === "this_week") {
      setCurrentDate(getStartOfWeek(d));
      setViewMode("week");
    } else if (newPreset === "month") {
      setCurrentDate(new Date(d.getFullYear(), d.getMonth(), 1));
      setViewMode("month");
    }
  };

  // Navigate forward/back
  const navigateDate = (dir: -1 | 1) => {
    const next = new Date(currentDate);
    if (viewMode === "month") {
      next.setMonth(next.getMonth() + dir);
    } else if (viewMode === "week") {
      next.setDate(next.getDate() + dir * 7);
    } else {
      next.setDate(next.getDate() + dir);
    }
    setCurrentDate(next);
  };

  const jumpToToday = () => {
    setCurrentDate(new Date(now));
  };

  // Group events by YYYY-MM-DD
  const eventsByDay = useMemo(() => {
    const map = new Map<
      string,
      Array<{
        type: "task" | "meeting";
        id: string;
        title: string;
        status?: string;
        assignee?: string;
        priority?: number;
        time?: string;
        item: any;
      }>
    >();

    const addEvent = (key: string, ev: any) => {
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(ev);
    };

    // Index tasks
    for (const t of tasks) {
      if (t.status === "archived") continue;

      const fullTask = t as any;
      let targetTimeMs: number | null = null;
      if (t.status === "done" && showDone) {
        targetTimeMs =
          taskTimeMs(fullTask.completed_at) ?? taskTimeMs(t.started_at) ?? taskTimeMs(t.created_at);
      } else if (t.status === "blocked" && showBlocked) {
        targetTimeMs = taskTimeMs(t.started_at) ?? taskTimeMs(t.created_at);
      } else if (t.status === "running" && showRunning) {
        targetTimeMs = taskTimeMs(t.started_at) ?? taskTimeMs(t.created_at);
      } else if (showRunning) {
        targetTimeMs = taskTimeMs(t.created_at);
      }

      if (targetTimeMs) {
        const d = new Date(targetTimeMs);
        const key = formatDateKey(d);
        const timeStr = d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
        addEvent(key, {
          type: "task",
          id: t.id,
          title: t.title,
          status: t.status,
          assignee: t.assignee || undefined,
          priority: t.priority,
          time: timeStr,
          item: t,
        });
      }
    }

    // Index meetings
    if (showMeetings) {
      for (const m of meetings) {
        const d = new Date(m.createdAt);
        const key = formatDateKey(d);
        const timeStr = d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
        addEvent(key, {
          type: "meeting",
          id: m.id,
          title: m.topic,
          time: timeStr,
          item: m,
        });
      }
    }

    return map;
  }, [tasks, meetings, showDone, showMeetings, showBlocked, showRunning]);

  // Month grid dates calculation (Monday to Sunday)
  const monthDays = useMemo(() => {
    const year = currentDate.getFullYear();
    const month = currentDate.getMonth();

    const firstDayOfMonth = new Date(year, month, 1);
    const startOfGrid = getStartOfWeek(firstDayOfMonth);

    const days: Date[] = [];
    const curr = new Date(startOfGrid);

    // Build 6 weeks (42 days)
    for (let i = 0; i < 42; i++) {
      days.push(new Date(curr));
      curr.setDate(curr.getDate() + 1);
    }
    return days;
  }, [currentDate]);

  // Week days calculation
  const weekDays = useMemo(() => {
    const start = getStartOfWeek(currentDate);
    const days: Date[] = [];
    const curr = new Date(start);
    for (let i = 0; i < 7; i++) {
      days.push(new Date(curr));
      curr.setDate(curr.getDate() + 1);
    }
    return days;
  }, [currentDate]);

  // Schedule list dates calculation
  const scheduleDays = useMemo(() => {
    const days: Date[] = [];
    if (preset === "today") {
      days.push(new Date(now));
    } else if (preset === "yesterday") {
      const d = new Date(now);
      d.setDate(d.getDate() - 1);
      days.push(d);
    } else if (preset === "7days") {
      for (let i = 6; i >= 0; i--) {
        const d = new Date(now);
        d.setDate(d.getDate() - i);
        days.push(d);
      }
    } else {
      // Default to 14 days around current date
      const start = new Date(currentDate);
      start.setDate(start.getDate() - 3);
      for (let i = 0; i < 14; i++) {
        const d = new Date(start);
        d.setDate(d.getDate() + i);
        days.push(d);
      }
    }
    return days;
  }, [preset, currentDate, now]);

  // Header period title
  const periodTitle = useMemo(() => {
    const monthNames = [
      "Janeiro",
      "Fevereiro",
      "Março",
      "Abril",
      "Maio",
      "Junho",
      "Julho",
      "Agosto",
      "Setembro",
      "Outubro",
      "Novembro",
      "Dezembro",
    ];
    if (viewMode === "month") {
      return `${monthNames[currentDate.getMonth()]} ${currentDate.getFullYear()}`;
    }
    if (viewMode === "week") {
      const start = weekDays[0];
      const end = weekDays[6];
      return `${start.getDate()} ${monthNames[start.getMonth()].slice(0, 3)} – ${end.getDate()} ${monthNames[end.getMonth()].slice(0, 3)} ${end.getFullYear()}`;
    }
    return `${currentDate.getDate()} de ${monthNames[currentDate.getMonth()]} de ${currentDate.getFullYear()}`;
  }, [currentDate, viewMode, weekDays]);

  const todayKey = formatDateKey(nowDate);

  return (
    <div className="flex h-full flex-col overflow-hidden bg-surface text-text">
      {/* Top Controls Header */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border bg-surface-raised px-4 py-2 text-xs">
        {/* Navigation & Period */}
        <div className="flex items-center gap-2">
          <div className="flex items-center rounded border border-border bg-surface shadow-xs">
            <button
              type="button"
              onClick={() => navigateDate(-1)}
              className="p-1 hover:bg-surface-hover text-text"
              aria-label="Período anterior"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={jumpToToday}
              className="border-x border-border px-2.5 py-1 font-medium hover:bg-surface-hover text-text"
            >
              Hoje
            </button>
            <button
              type="button"
              onClick={() => navigateDate(1)}
              className="p-1 hover:bg-surface-hover text-text"
              aria-label="Próximo período"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
          <span className="text-sm font-semibold tracking-tight text-text pl-1">{periodTitle}</span>
        </div>

        {/* Quick Presets */}
        <div className="flex items-center rounded-md border border-border bg-surface p-0.5">
          {(["today", "yesterday", "7days", "this_week", "month"] as CalendarPreset[]).map((p) => {
            const labels: Record<CalendarPreset, string> = {
              today: "Hoje",
              yesterday: "Ontem",
              "7days": "Últimos 7d",
              this_week: "Semana",
              month: "Mês",
            };
            return (
              <button
                key={p}
                type="button"
                onClick={() => applyPreset(p)}
                className={`rounded px-2.5 py-1 text-xs transition-colors ${
                  preset === p
                    ? "bg-primary text-primary-foreground font-medium shadow-xs"
                    : "text-text-muted hover:text-text hover:bg-surface-hover"
                }`}
              >
                {labels[p]}
              </button>
            );
          })}
        </div>

        {/* View Mode Toggle */}
        <div className="flex items-center gap-1.5">
          <div className="flex items-center rounded border border-border bg-surface p-0.5">
            <button
              type="button"
              onClick={() => setViewMode("month")}
              className={`rounded px-2 py-0.5 text-xs ${
                viewMode === "month"
                  ? "bg-primary text-primary-foreground font-medium"
                  : "text-text-muted hover:text-text"
              }`}
            >
              Mês
            </button>
            <button
              type="button"
              onClick={() => setViewMode("week")}
              className={`rounded px-2 py-0.5 text-xs ${
                viewMode === "week"
                  ? "bg-primary text-primary-foreground font-medium"
                  : "text-text-muted hover:text-text"
              }`}
            >
              Semana
            </button>
            <button
              type="button"
              onClick={() => setViewMode("schedule")}
              className={`rounded px-2 py-0.5 text-xs ${
                viewMode === "schedule"
                  ? "bg-primary text-primary-foreground font-medium"
                  : "text-text-muted hover:text-text"
              }`}
            >
              Agenda
            </button>
          </div>
        </div>

        {/* Layer Filters */}
        <div className="flex items-center gap-3 text-xs">
          <label className="flex items-center gap-1 cursor-pointer select-none text-emerald-400">
            <input
              type="checkbox"
              checked={showDone}
              onChange={(e) => setShowDone(e.target.checked)}
              className="rounded border-emerald-500/40 text-emerald-500 focus:ring-0"
            />
            <span>Entregas</span>
          </label>
          <label className="flex items-center gap-1 cursor-pointer select-none text-amber-400">
            <input
              type="checkbox"
              checked={showMeetings}
              onChange={(e) => setShowMeetings(e.target.checked)}
              className="rounded border-amber-500/40 text-amber-500 focus:ring-0"
            />
            <span>Reuniões</span>
          </label>
          <label className="flex items-center gap-1 cursor-pointer select-none text-rose-400">
            <input
              type="checkbox"
              checked={showBlocked}
              onChange={(e) => setShowBlocked(e.target.checked)}
              className="rounded border-rose-500/40 text-rose-500 focus:ring-0"
            />
            <span>Bloqueios</span>
          </label>
          <label className="flex items-center gap-1 cursor-pointer select-none text-blue-400">
            <input
              type="checkbox"
              checked={showRunning}
              onChange={(e) => setShowRunning(e.target.checked)}
              className="rounded border-blue-500/40 text-blue-500 focus:ring-0"
            />
            <span>Execução</span>
          </label>
        </div>
      </div>

      {/* Main Calendar View Area */}
      <div className="flex-1 overflow-auto p-3">
        {viewMode === "month" && (
          <div className="flex h-full flex-col rounded-lg border border-border bg-surface shadow-xs">
            {/* Weekday Labels Header */}
            <div className="grid grid-cols-7 border-b border-border bg-surface-raised text-center text-xs font-medium text-text-muted">
              {WEEKDAYS.map((wd) => (
                <div key={wd} className="py-1.5 border-r border-border last:border-r-0">
                  {wd}
                </div>
              ))}
            </div>

            {/* 42 Day Cells Grid */}
            <div className="grid flex-1 grid-cols-7 grid-rows-6 border-collapse">
              {monthDays.map((d, idx) => {
                const dayKey = formatDateKey(d);
                const isCurrentMonth = d.getMonth() === currentDate.getMonth();
                const isToday = dayKey === todayKey;
                const events = eventsByDay.get(dayKey) || [];

                return (
                  <div
                    key={idx}
                    onClick={() => setSelectedDayKey(dayKey)}
                    className={`flex flex-col border-b border-r border-border p-1.5 transition-colors cursor-pointer ${
                      !isCurrentMonth ? "bg-surface-dim/40 opacity-40" : "hover:bg-surface-hover/40"
                    } ${isToday ? "bg-primary/5 ring-1 ring-inset ring-primary/40" : ""}`}
                  >
                    {/* Day number & indicators */}
                    <div className="flex items-center justify-between mb-1">
                      <span
                        className={`text-xs font-semibold px-1.5 py-0.5 rounded-full ${
                          isToday
                            ? "bg-primary text-primary-foreground"
                            : isCurrentMonth
                              ? "text-text"
                              : "text-text-muted"
                        }`}
                      >
                        {d.getDate()}
                      </span>
                      {events.length > 0 && (
                        <span className="text-[10px] text-text-muted font-mono">
                          {events.length}
                        </span>
                      )}
                    </div>

                    {/* Event badges (capped at 3 items) */}
                    <div className="flex-1 space-y-1 overflow-hidden">
                      {events.slice(0, 3).map((ev, eIdx) => {
                        const isTask = ev.type === "task";
                        const isDone = isTask && ev.status === "done";
                        const isBlocked = isTask && ev.status === "blocked";
                        const isRunning = isTask && ev.status === "running";
                        const isMeeting = ev.type === "meeting";

                        let badgeColor = "bg-zinc-800 text-zinc-300 border-zinc-700";
                        if (isDone)
                          badgeColor = "bg-emerald-950/80 text-emerald-300 border-emerald-500/40";
                        else if (isBlocked)
                          badgeColor = "bg-rose-950/80 text-rose-300 border-rose-500/40";
                        else if (isRunning)
                          badgeColor = "bg-blue-950/80 text-blue-300 border-blue-500/40";
                        else if (isMeeting)
                          badgeColor = "bg-amber-950/80 text-amber-300 border-amber-500/40";

                        return (
                          <div
                            key={eIdx}
                            onClick={(e) => {
                              e.stopPropagation();
                              if (isTask) onOpenTask(ev.id);
                              else if (onOpenMeeting) onOpenMeeting(ev.id);
                            }}
                            className={`flex items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] leading-tight truncate transition-transform hover:scale-[1.02] shadow-2xs ${badgeColor}`}
                            title={`${ev.time ? `[${ev.time}] ` : ""}${ev.title}`}
                          >
                            {isDone && (
                              <CheckCircle2 className="h-2.5 w-2.5 shrink-0 text-emerald-400" />
                            )}
                            {isBlocked && (
                              <AlertTriangle className="h-2.5 w-2.5 shrink-0 text-rose-400" />
                            )}
                            {isRunning && (
                              <PlayCircle className="h-2.5 w-2.5 shrink-0 text-blue-400" />
                            )}
                            {isMeeting && <Users className="h-2.5 w-2.5 shrink-0 text-amber-400" />}
                            <span className="truncate">{ev.title}</span>
                          </div>
                        );
                      })}

                      {events.length > 3 && (
                        <div className="text-[10px] text-primary hover:underline font-medium pt-0.5">
                          +{events.length - 3} mais
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Weekly View Mode */}
        {viewMode === "week" && (
          <div className="flex h-full flex-col rounded-lg border border-border bg-surface shadow-xs">
            <div className="grid grid-cols-7 border-b border-border bg-surface-raised text-center text-xs font-medium text-text-muted">
              {weekDays.map((d, idx) => {
                const dayKey = formatDateKey(d);
                const isToday = dayKey === todayKey;
                return (
                  <div
                    key={idx}
                    className={`py-2 border-r border-border last:border-r-0 ${isToday ? "bg-primary/10 text-primary font-bold" : ""}`}
                  >
                    <div>{WEEKDAYS[idx]}</div>
                    <div className="text-sm font-semibold">{d.getDate()}</div>
                  </div>
                );
              })}
            </div>

            <div className="grid flex-1 grid-cols-7 divide-x divide-border overflow-y-auto">
              {weekDays.map((d, idx) => {
                const dayKey = formatDateKey(d);
                const isToday = dayKey === todayKey;
                const events = eventsByDay.get(dayKey) || [];

                return (
                  <div
                    key={idx}
                    className={`flex flex-col p-2 space-y-1.5 ${isToday ? "bg-primary/5" : ""}`}
                  >
                    {events.length === 0 ? (
                      <div className="py-6 text-center text-[11px] text-text-muted/50 italic">
                        Sem eventos
                      </div>
                    ) : (
                      events.map((ev, eIdx) => (
                        <div
                          key={eIdx}
                          onClick={() => {
                            if (ev.type === "task") onOpenTask(ev.id);
                            else if (onOpenMeeting) onOpenMeeting(ev.id);
                          }}
                          className="flex flex-col gap-1 rounded-md border border-border bg-surface-raised p-2 text-xs hover:border-primary/50 transition-all cursor-pointer shadow-xs"
                        >
                          <div className="flex items-center justify-between text-[10px] text-text-muted">
                            <span className="font-mono">{ev.time || "--:--"}</span>
                            {ev.priority !== undefined && (
                              <span
                                className={`px-1 rounded font-bold ${
                                  ev.priority >= 9
                                    ? "bg-rose-500/20 text-rose-400"
                                    : "bg-zinc-700/50 text-zinc-300"
                                }`}
                              >
                                P{ev.priority}
                              </span>
                            )}
                          </div>
                          <div className="font-medium leading-snug line-clamp-2">{ev.title}</div>
                          <div className="flex items-center justify-between pt-1 text-[10px] text-text-muted border-t border-border/50">
                            <span>
                              {ev.assignee
                                ? `@${ev.assignee}`
                                : ev.type === "meeting"
                                  ? "🏛️ Reunião"
                                  : "Sistema"}
                            </span>
                            <span className="capitalize">{ev.status || "concluído"}</span>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Schedule / Agenda View Mode */}
        {viewMode === "schedule" && (
          <div className="max-w-4xl mx-auto space-y-4 py-2">
            {scheduleDays.map((d, idx) => {
              const dayKey = formatDateKey(d);
              const isToday = dayKey === todayKey;
              const events = eventsByDay.get(dayKey) || [];

              return (
                <div
                  key={idx}
                  className={`rounded-lg border border-border bg-surface p-4 shadow-xs ${
                    isToday ? "ring-2 ring-primary/40 border-primary" : ""
                  }`}
                >
                  <div className="flex items-center justify-between border-b border-border pb-2 mb-3">
                    <div className="flex items-center gap-2">
                      <span
                        className={`text-sm font-bold px-2 py-0.5 rounded ${
                          isToday
                            ? "bg-primary text-primary-foreground"
                            : "bg-surface-raised text-text"
                        }`}
                      >
                        {d.toLocaleDateString("pt-BR", {
                          weekday: "long",
                          day: "numeric",
                          month: "long",
                        })}
                      </span>
                      {isToday && (
                        <span className="text-xs font-semibold text-primary">(Hoje)</span>
                      )}
                    </div>
                    <span className="text-xs text-text-muted font-mono">
                      {events.length} {events.length === 1 ? "registro" : "registros"}
                    </span>
                  </div>

                  {events.length === 0 ? (
                    <div className="text-xs text-text-muted italic py-1">
                      Nenhuma atividade registrada neste dia.
                    </div>
                  ) : (
                    <div className="grid gap-2 sm:grid-cols-2">
                      {events.map((ev, eIdx) => {
                        const isTask = ev.type === "task";
                        const isDone = isTask && ev.status === "done";
                        const isBlocked = isTask && ev.status === "blocked";
                        const isRunning = isTask && ev.status === "running";
                        const isMeeting = ev.type === "meeting";

                        return (
                          <div
                            key={eIdx}
                            onClick={() => {
                              if (isTask) onOpenTask(ev.id);
                              else if (onOpenMeeting) onOpenMeeting(ev.id);
                            }}
                            className="flex flex-col justify-between rounded-md border border-border bg-surface-raised p-2.5 hover:border-primary/50 transition-colors cursor-pointer"
                          >
                            <div className="flex items-start gap-2 mb-1.5">
                              {isDone && (
                                <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-400 mt-0.5" />
                              )}
                              {isBlocked && (
                                <AlertTriangle className="h-4 w-4 shrink-0 text-rose-400 mt-0.5" />
                              )}
                              {isRunning && (
                                <PlayCircle className="h-4 w-4 shrink-0 text-blue-400 mt-0.5" />
                              )}
                              {isMeeting && (
                                <Users className="h-4 w-4 shrink-0 text-amber-400 mt-0.5" />
                              )}
                              <div className="flex-1 min-w-0">
                                <span className="text-xs font-medium text-text line-clamp-2">
                                  {ev.title}
                                </span>
                              </div>
                            </div>
                            <div className="flex items-center justify-between text-[11px] text-text-muted pt-1 border-t border-border/40">
                              <span className="font-mono">{ev.time}</span>
                              <span className="truncate max-w-[120px]">
                                {ev.assignee
                                  ? `@${ev.assignee}`
                                  : isMeeting
                                    ? "Reunião de Squad"
                                    : ""}
                              </span>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Selected Day Full Overview Modal / Drawer */}
      {selectedDayKey && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-xs">
          <div className="w-full max-w-lg rounded-xl border border-border bg-surface p-4 shadow-xl space-y-3">
            <div className="flex items-center justify-between border-b border-border pb-2">
              <div className="flex items-center gap-2">
                <CalendarIcon className="h-4 w-4 text-primary" />
                <h3 className="text-sm font-bold text-text">Atividades de {selectedDayKey}</h3>
              </div>
              <button
                type="button"
                onClick={() => setSelectedDayKey(null)}
                className="rounded p-1 text-text-muted hover:bg-surface-hover hover:text-text"
              >
                ✕
              </button>
            </div>

            <div className="max-h-96 overflow-y-auto space-y-2 pr-1">
              {(eventsByDay.get(selectedDayKey) || []).length === 0 ? (
                <div className="text-xs text-text-muted italic py-4 text-center">
                  Nenhum evento gravado nesta data.
                </div>
              ) : (
                (eventsByDay.get(selectedDayKey) || []).map((ev, idx) => (
                  <div
                    key={idx}
                    onClick={() => {
                      setSelectedDayKey(null);
                      if (ev.type === "task") onOpenTask(ev.id);
                      else if (onOpenMeeting) onOpenMeeting(ev.id);
                    }}
                    className="flex flex-col gap-1 rounded border border-border bg-surface-raised p-2 hover:border-primary/50 cursor-pointer"
                  >
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-semibold text-text truncate">{ev.title}</span>
                      <span className="text-[10px] font-mono text-text-muted">{ev.time}</span>
                    </div>
                    <div className="flex items-center justify-between text-[11px] text-text-muted">
                      <span>
                        {ev.assignee
                          ? `@${ev.assignee}`
                          : ev.type === "meeting"
                            ? "Ata de Reunião"
                            : "Card"}
                      </span>
                      <span className="capitalize">{ev.status || "concluído"}</span>
                    </div>
                  </div>
                ))
              )}
            </div>

            <div className="border-t border-border pt-2 flex justify-end">
              <button
                type="button"
                onClick={() => setSelectedDayKey(null)}
                className="rounded bg-surface-raised border border-border px-3 py-1 text-xs text-text hover:bg-surface-hover"
              >
                Fechar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
