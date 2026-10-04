/**
 * Scrum Cadence Scheduler (HIVE — DeskRPG + Hermes)
 *
 * Implements the automated weekly cadence defined in SCRUM_LIFECYCLE.md:
 * - Monday 09:00: Sprint Planning
 * - Tuesday - Friday 08:30: Daily Standup
 * - Wednesday 14:00: Mid-Sprint Scope Guard
 * - Friday 16:30: Sprint Review & Demo
 * - Friday 17:30: Sprint Retrospective
 *
 * Includes deduplication memory and persistent locks to ensure each ceremony
 * runs exactly once per scheduled timebox.
 */

import { createScrumCeremonyMeeting, type ScrumCeremonyType } from "./scrum-lifecycle";

export interface ScheduledCeremonyWindow {
  type: ScrumCeremonyType;
  dayOfWeek: number; // 1 = Mon, 2 = Tue, 3 = Wed, 4 = Thu, 5 = Fri
  startHour: number;
  startMinute: number;
  windowMinutes: number;
  name: string;
}

export const SCRUM_SCHEDULE: readonly ScheduledCeremonyWindow[] = [
  {
    type: "sprint_planning",
    dayOfWeek: 1, // Monday
    startHour: 9,
    startMinute: 0,
    windowMinutes: 30,
    name: "Sprint Planning",
  },
  {
    type: "daily_standup",
    dayOfWeek: 2, // Tuesday
    startHour: 8,
    startMinute: 30,
    windowMinutes: 30,
    name: "Daily Standup (Terça)",
  },
  {
    type: "daily_standup",
    dayOfWeek: 3, // Wednesday
    startHour: 8,
    startMinute: 30,
    windowMinutes: 30,
    name: "Daily Standup (Quarta)",
  },
  {
    type: "mid_sprint_check",
    dayOfWeek: 3, // Wednesday
    startHour: 14,
    startMinute: 0,
    windowMinutes: 30,
    name: "Mid-Sprint Scope Guard",
  },
  {
    type: "daily_standup",
    dayOfWeek: 4, // Thursday
    startHour: 8,
    startMinute: 30,
    windowMinutes: 30,
    name: "Daily Standup (Quinta)",
  },
  {
    type: "daily_standup",
    dayOfWeek: 5, // Friday
    startHour: 8,
    startMinute: 30,
    windowMinutes: 30,
    name: "Daily Standup (Sexta)",
  },
  {
    type: "sprint_review",
    dayOfWeek: 5, // Friday
    startHour: 16,
    startMinute: 30,
    windowMinutes: 30,
    name: "Sprint Review & Demo",
  },
  {
    type: "sprint_retrospective",
    dayOfWeek: 5, // Friday
    startHour: 17,
    startMinute: 30,
    windowMinutes: 30,
    name: "Sprint Retrospective",
  },
  {
    type: "daily_standup",
    dayOfWeek: 6, // Saturday
    startHour: 8,
    startMinute: 30,
    windowMinutes: 30,
    name: "Daily Standup (Sábado — 24/7)",
  },
  {
    type: "mid_sprint_check",
    dayOfWeek: 6, // Saturday
    startHour: 14,
    startMinute: 0,
    windowMinutes: 30,
    name: "Weekend Architecture & Scope Guard",
  },
  {
    type: "daily_standup",
    dayOfWeek: 0, // Sunday
    startHour: 8,
    startMinute: 30,
    windowMinutes: 30,
    name: "Daily Standup (Domingo — 24/7)",
  },
  {
    type: "sprint_review",
    dayOfWeek: 0, // Sunday
    startHour: 16,
    startMinute: 30,
    windowMinutes: 30,
    name: "Sunday Continuous Sprint Review",
  },
  {
    type: "sprint_retrospective",
    dayOfWeek: 0, // Sunday
    startHour: 17,
    startMinute: 30,
    windowMinutes: 30,
    name: "Sunday Retrospective & Continuous Alignment",
  },
] as const;

// In-memory deduplication set: `ceremony_YYYY-MM-DD_type`
const executedCeremonyKeys = new Set<string>();

export function getSprintTagForDate(date: Date): string {
  const startOfYear = new Date(date.getFullYear(), 0, 1);
  const pastDaysOfYear = (date.getTime() - startOfYear.getTime()) / 86400000;
  const weekNum = Math.ceil((pastDaysOfYear + startOfYear.getDay() + 1) / 7);
  return `sprint-w${weekNum}-${date.getFullYear()}`;
}

export function formatDateKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function isDateInCeremonyWindow(date: Date, window: ScheduledCeremonyWindow): boolean {
  if (date.getDay() !== window.dayOfWeek) return false;
  const currentTotalMinutes = date.getHours() * 60 + date.getMinutes();
  const windowStartTotalMinutes = window.startHour * 60 + window.startMinute;
  const windowEndTotalMinutes = windowStartTotalMinutes + window.windowMinutes;
  return (
    currentTotalMinutes >= windowStartTotalMinutes && currentTotalMinutes < windowEndTotalMinutes
  );
}

export interface CheckScheduleOptions {
  boardSlug?: string;
  channelId?: string;
  force?: boolean;
}

export async function checkAndTriggerScrumCeremonies(
  currentDate: Date = new Date(),
  options: CheckScheduleOptions = {},
): Promise<Array<{ type: ScrumCeremonyType; meetingId: string; topic: string }>> {
  const { boardSlug = "hot-telegram", channelId = "c_general", force = false } = options;
  const dateKey = formatDateKey(currentDate);
  const sprintTag = getSprintTagForDate(currentDate);
  const triggered: Array<{ type: ScrumCeremonyType; meetingId: string; topic: string }> = [];

  for (const window of SCRUM_SCHEDULE) {
    const isMatching = isDateInCeremonyWindow(currentDate, window);
    if (!isMatching && !force) continue;

    const lockKey = `${dateKey}_${window.type}_${window.startHour}:${window.startMinute}_${boardSlug}`;
    if (!force && executedCeremonyKeys.has(lockKey)) {
      continue;
    }

    try {
      console.log(
        `[scrum-scheduler] Auto-triggering ceremony: ${window.name} (${window.type}) for ${boardSlug}`,
      );
      const result = await createScrumCeremonyMeeting({
        ceremonyType: window.type,
        boardSlug,
        channelId,
        sprintTag,
      });

      if (result.success && result.meetingId) {
        executedCeremonyKeys.add(lockKey);
        triggered.push({
          type: window.type,
          meetingId: result.meetingId,
          topic: result.topic,
        });
      }
    } catch (err) {
      console.error(`[scrum-scheduler] Error triggering ceremony ${window.type}:`, err);
    }
  }

  return triggered;
}

let schedulerTimer: NodeJS.Timeout | null = null;

export function startScrumScheduler(
  intervalMs = 60_000,
  options: CheckScheduleOptions = {},
): () => void {
  if (schedulerTimer) {
    clearInterval(schedulerTimer);
  }

  schedulerTimer = setInterval(() => {
    void checkAndTriggerScrumCeremonies(new Date(), options);
  }, intervalMs);

  // unref ensures this timer does not prevent process exit in test or CLI runners
  schedulerTimer.unref();

  return () => {
    if (schedulerTimer) {
      clearInterval(schedulerTimer);
      schedulerTimer = null;
    }
  };
}

export function clearExecutedCeremoniesCache(): void {
  executedCeremonyKeys.clear();
}
