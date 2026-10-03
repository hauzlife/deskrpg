"use client";

/**
 * The header's project (= board) picker.
 *
 * If a channel has only one board, this **renders nothing** — a picker with nothing to pick from
 * just clutters the screen. It only appears with two or more.
 *
 * The chosen value persists per-user in `localStorage` (decision B-1). It isn't kept on the
 * server because people viewing the same channel need to be able to have different projects open.
 * Switching devices resets to the default project — that's an accepted trade-off.
 */

import { useCallback, useState } from "react";
import { Archive, FolderKanban } from "lucide-react";

import { useT } from "@/lib/i18n";

import { KanbanApiError } from "./kanban-api";

export type ProjectOption = {
  id: string;
  boardSlug: string;
  name: string | null;
  status: string;
  isEventCarrier: boolean;
  /**
   * `YYYY-MM-DD` or null. The picker doesn't use this, but it comes in the same response, and the
   * timeline's target-date line reads this value. The server (`ProjectView`) had been sending it
   * from the start.
   */
  targetDate?: string | null;
};

const STORAGE_PREFIX = "deskrpg:kanban:board:";

/** Browser storage throws in private mode or with blocked settings. The screen must still render even if this can't be read. */
function readStored(channelId: string): string | null {
  try {
    return window.localStorage.getItem(STORAGE_PREFIX + channelId);
  } catch {
    return null;
  }
}

function writeStored(channelId: string, boardSlug: string | null) {
  try {
    if (boardSlug === null) window.localStorage.removeItem(STORAGE_PREFIX + channelId);
    else window.localStorage.setItem(STORAGE_PREFIX + channelId, boardSlug);
  } catch {
    // Even if this can't be saved, the choice still shows correctly for this session.
  }
}

/**
 * Returns the chosen board. If the stored value isn't in the current list (the board disappeared,
 * or it's a value from another device), falls back to the default board and clears the stored
 * value — continuing to request a nonexistent board only yields 404s.
 */
export function useSelectedBoard(channelId: string, options: ProjectOption[]) {
  // Storage is read once, on the first render. The chosen value must survive even while the list
  // is still empty — that way, reopening the modal doesn't briefly flash the default board before
  // showing the project you'd been viewing.
  const [stored, setStored] = useState<string | null>(() =>
    typeof window === "undefined" ? null : readStored(channelId),
  );
  const [channel, setChannel] = useState(channelId);
  if (channel !== channelId) {
    // When the channel changes, switch to that channel's value (state swap during render — one beat ahead of an effect).
    setChannel(channelId);
    setStored(typeof window === "undefined" ? null : readStored(channelId));
  }

  // "all" is a valid choice only for the all-offices aggregation.
  const isAll = channelId === "all" && (stored === "all" || stored === null);
  const known =
    isAll ||
    (stored !== "all" && (options.length === 0 || options.some((o) => o.boardSlug === stored)));

  const select = useCallback(
    (boardSlug: string | null) => {
      setStored(boardSlug);
      writeStored(channelId, boardSlug);
    },
    [channelId],
  );

  const effective = known
    ? (stored ?? (channelId === "all" ? "all" : null))
    : (channelId === "all" ? "all" : null);

  return { selected: effective, select };
}

/** Our "done" statuses — mirrors `ARCHIVED_STATUSES` in `project-registry.ts` (server code the client can't import). */
const ARCHIVED_STATUSES: ReadonlySet<string> = new Set(["completed", "cancelled"]);

export function isArchivedProject(option: Pick<ProjectOption, "status">): boolean {
  return ARCHIVED_STATUSES.has(option.status);
}

/**
 * The header's project picker, plus the owner's archive/reopen actions.
 *
 * Archived projects stay out of the list until the "archived" filter is on — except the one that
 * is selected, which must not silently vanish from under the user.
 */
export function ProjectPicker({
  options,
  selected,
  onSelect,
  canManage = false,
  onArchive,
  onReopen,
  allowAll = false,
}: {
  options: ProjectOption[];
  /** null or "all" means all boards / default */
  selected: string | null;
  onSelect(boardSlug: string | null): void;
  /** Channel owner — the archive routes answer 403 to anyone else. */
  canManage?: boolean;
  onArchive?(projectId: string): Promise<void>;
  onReopen?(projectId: string): Promise<void>;
  allowAll?: boolean;
}) {
  const t = useT();
  const [showArchived, setShowArchived] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const active = options.filter((o) => !isArchivedProject(o));
  const archivedCount = options.length - active.length;
  if ((!allowAll && options.length < 2) || (options.length === 0 && !allowAll)) return null;

  const fallback = active.find((o) => o.isEventCarrier) ?? active[0];
  const isAllSelected = allowAll && (selected === "all" || selected === null);
  const value = isAllSelected ? "all" : (selected ?? fallback?.boardSlug);
  const current = options.find((o) => o.boardSlug === value) ?? (isAllSelected ? undefined : fallback);
  const visible = options.filter(
    (o) => !isArchivedProject(o) || showArchived || o.boardSlug === value,
  );
  const listedActive = visible.filter((o) => !isArchivedProject(o));
  const listedArchived = visible.filter(isArchivedProject);
  const currentArchived = current ? isArchivedProject(current) : false;

  const run = async (action: () => Promise<void>, failureKey: string) => {
    setBusy(true);
    setError(null);
    try {
      await action();
      setConfirming(false);
    } catch (err) {
      setError(describeFailure(t, err, failureKey));
    } finally {
      setBusy(false);
    }
  };

  const renderOption = (option: ProjectOption) => (
    <option key={option.boardSlug} value={option.boardSlug} className="bg-bg text-text">
      {option.name ?? option.boardSlug}
    </option>
  );

  return (
    <div className="flex items-center gap-1 text-xs text-text-secondary">
      <label className="flex items-center gap-1">
        <FolderKanban className="w-3.5 h-3.5" aria-hidden />
        <span className="sr-only">{t("kanban.project.pick")}</span>
        <select
          data-project-picker
          value={value}
          onChange={(e) => {
            const next = e.target.value;
            setConfirming(false);
            setError(null);
            onSelect(next);
          }}
          className="bg-surface-raised text-text-primary rounded-md px-2 py-1 max-w-[180px] truncate"
        >
          {allowAll && (
            <option value="all" className="bg-bg text-text font-semibold">
              {t("kanban.project.allBoards") || "All Boards"}
            </option>
          )}
          {listedActive.map(renderOption)}
          {listedArchived.length > 0 ? (
            <optgroup label={t("kanban.project.archivedGroup")}>
              {listedArchived.map(renderOption)}
            </optgroup>
          ) : null}
        </select>
      </label>
      {archivedCount > 0 ? (
        <button
          type="button"
          data-project-archived-filter
          aria-pressed={showArchived}
          onClick={() => setShowArchived((on) => !on)}
          className={`flex items-center gap-1 px-2 py-1 rounded-md ${
            showArchived ? "bg-surface-raised text-text-primary" : "hover:bg-surface-raised"
          }`}
        >
          <Archive className="w-3.5 h-3.5" aria-hidden />
          {t("kanban.project.showArchived", { count: archivedCount })}
        </button>
      ) : null}
      {canManage && current && currentArchived && onReopen ? (
        <button
          type="button"
          data-project-reopen
          disabled={busy}
          onClick={() => void run(() => onReopen(current.id), "kanban.project.reopenFailed")}
          className="px-2 py-1 rounded-md bg-surface-raised hover:brightness-125 disabled:opacity-50"
        >
          {t("kanban.project.reopen")}
        </button>
      ) : null}
      {canManage && current && !currentArchived && active.length > 1 && onArchive ? (
        confirming ? (
          <span className="flex items-center gap-1">
            <span>{t("kanban.project.archiveConfirm")}</span>
            <button
              type="button"
              data-project-archive-confirm
              disabled={busy}
              onClick={() => void run(() => onArchive(current.id), "kanban.project.archiveFailed")}
              className="px-2 py-1 rounded-md bg-danger text-white font-semibold disabled:opacity-50"
            >
              {t("kanban.project.archive")}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => setConfirming(false)}
              className="px-2 py-1 rounded-md hover:bg-surface-raised disabled:opacity-50"
            >
              {t("common.cancel")}
            </button>
          </span>
        ) : (
          <button
            type="button"
            data-project-archive
            onClick={() => {
              setError(null);
              setConfirming(true);
            }}
            className="flex items-center gap-1 px-2 py-1 rounded-md hover:bg-surface-raised"
          >
            <Archive className="w-3.5 h-3.5" aria-hidden />
            {t("kanban.project.archive")}
          </button>
        )
      ) : null}
      {error ? (
        <span role="alert" className="text-danger max-w-[260px]">
          {error}
        </span>
      ) : null}
    </div>
  );
}

function describeFailure(t: ReturnType<typeof useT>, err: unknown, failureKey: string): string {
  if (err instanceof KanbanApiError) {
    if (err.code === "board_has_running_cards") {
      const running = typeof err.extra.running === "number" ? err.extra.running : 1;
      return t("kanban.project.archiveRunning", { count: running });
    }
    if (err.code === "last_board") return t("kanban.project.archiveLast");
  }
  return t(failureKey, { error: err instanceof Error ? err.message : String(err) });
}
