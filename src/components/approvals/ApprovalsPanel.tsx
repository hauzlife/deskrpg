"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Check,
  ChevronDown,
  ChevronRight,
  Clock,
  Layers,
  Plus,
  RefreshCw,
  RotateCcw,
  ShieldCheck,
  Trash2,
  X,
} from "lucide-react";

import { useT } from "@/lib/i18n";
import {
  createApprovalBatch,
  fetchApprovalDetail,
  fetchApprovals,
  submitApprovalDecision,
  type ApprovalDetail,
  type ApprovalSummary,
} from "./approvals-api";

type Props = {
  channelId: string;
  onOpenCard?: (taskId: string) => void;
  onClose?: () => void;
  embedded?: boolean;
};

export default function ApprovalsPanel({
  channelId,
  onOpenCard,
  onClose,
  embedded = false,
}: Props) {
  const t = useT();
  const [tab, setTab] = useState<"pending" | "decided" | "all">("pending");
  const [approvals, setApprovals] = useState<ApprovalSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Selected approval for full inspection
  const [selectedApprovalId, setSelectedApprovalId] = useState<string | null>(null);
  const [detail, setDetail] = useState<ApprovalDetail | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);

  // Action states
  const [actionBusyId, setActionBusyId] = useState<string | null>(null);
  const [decisionNotes, setDecisionNotes] = useState<Record<string, string>>({});

  // Create Modal
  const [showCreateModal, setShowCreateModal] = useState(false);

  const loadApprovals = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchApprovals(channelId, tab);
      setApprovals(data.approvals);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to load approvals");
    } finally {
      setLoading(false);
    }
  }, [channelId, tab]);

  useEffect(() => {
    loadApprovals();
  }, [loadApprovals]);

  const loadDetail = useCallback(
    async (id: string, overrideChannelId?: string) => {
      setSelectedApprovalId(id);
      setLoadingDetail(true);
      try {
        const item = approvals.find((a) => a.id === id);
        const targetChannel = overrideChannelId || item?.channelId || channelId;
        const data = await fetchApprovalDetail(targetChannel, id);
        setDetail(data.approval);
      } catch {
        setDetail(null);
      } finally {
        setLoadingDetail(false);
      }
    },
    [channelId, approvals],
  );

  const handleDecision = async (
    approvalId: string,
    decision: "approve" | "reject" | "request_revision",
  ) => {
    setActionBusyId(approvalId);
    try {
      const item = approvals.find((a) => a.id === approvalId);
      const targetChannel = item?.channelId || channelId;
      const note = decisionNotes[approvalId] || "";
      await submitApprovalDecision(targetChannel, approvalId, decision, note);
      await loadApprovals();
      if (selectedApprovalId === approvalId) {
        await loadDetail(approvalId, targetChannel);
      }
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : "Decision failed");
    } finally {
      setActionBusyId(null);
    }
  };

  const pendingCount = approvals.filter((a) => a.status === "pending").length;

  return (
    <div
      className={`flex flex-col ${
        embedded ? "h-full" : "max-h-[85vh] min-h-[500px]"
      } bg-bg text-text`}
    >
      {/* Top Header */}
      <div className="flex items-center justify-between border-b border-border p-4">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <ShieldCheck size={20} />
          </div>
          <div>
            <h2 className="text-base font-bold text-text">{t("approvals.title") || "Approvals"}</h2>
            <p className="text-xs text-text-muted">
              {t("approvals.subtitle") ||
                "Pre-execution gate holding blocked cards until authorized."}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setShowCreateModal(true)}
            className="flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-semibold text-white hover:bg-primary-hover"
          >
            <Plus size={14} />
            <span>{t("approvals.create.button") || "New Batch"}</span>
          </button>
          <button
            type="button"
            onClick={loadApprovals}
            title={t("common.refresh") || "Refresh"}
            className="rounded-md border border-border p-1.5 text-text-secondary hover:bg-surface-raised"
          >
            <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
          </button>
          {onClose && (
            <button
              type="button"
              onClick={onClose}
              className="rounded-md border border-border p-1.5 text-text-secondary hover:bg-surface-raised"
            >
              <X size={14} />
            </button>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-2 border-b border-border px-4 py-2 text-xs">
        <button
          type="button"
          onClick={() => setTab("pending")}
          className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 font-medium ${
            tab === "pending"
              ? "bg-surface-raised font-bold text-primary shadow-sm"
              : "text-text-muted hover:text-text"
          }`}
        >
          <span>{t("approvals.tabs.pending") || "Pending"}</span>
          {pendingCount > 0 && (
            <span className="rounded-full bg-primary/20 px-1.5 py-0.2 text-[10px] font-bold text-primary">
              {pendingCount}
            </span>
          )}
        </button>
        <button
          type="button"
          onClick={() => setTab("decided")}
          className={`rounded-md px-3 py-1.5 font-medium ${
            tab === "decided"
              ? "bg-surface-raised font-bold text-primary shadow-sm"
              : "text-text-muted hover:text-text"
          }`}
        >
          {t("approvals.tabs.decided") || "Decided"}
        </button>
        <button
          type="button"
          onClick={() => setTab("all")}
          className={`rounded-md px-3 py-1.5 font-medium ${
            tab === "all"
              ? "bg-surface-raised font-bold text-primary shadow-sm"
              : "text-text-muted hover:text-text"
          }`}
        >
          {t("approvals.tabs.all") || "All"}
        </button>
      </div>

      {/* Body: Split View (List + Detail) */}
      <div className="flex flex-1 min-h-0 overflow-hidden">
        {/* List of approvals */}
        <div className="w-1/2 flex-1 overflow-y-auto border-r border-border p-3 space-y-2.5">
          {loading && approvals.length === 0 ? (
            <div className="py-12 text-center text-xs text-text-muted">
              {t("common.loading") || "Loading approvals…"}
            </div>
          ) : error ? (
            <div className="py-8 text-center text-xs text-danger">{error}</div>
          ) : approvals.length === 0 ? (
            <div className="py-12 text-center text-xs text-text-muted">
              {t("approvals.empty") || "No approvals found in this view."}
            </div>
          ) : (
            approvals.map((app) => {
              const isSelected = selectedApprovalId === app.id;
              const isBusy = actionBusyId === app.id;
              return (
                <div
                  key={app.id}
                  onClick={() => loadDetail(app.id)}
                  className={`cursor-pointer rounded-lg border p-3 transition-colors ${
                    isSelected
                      ? "border-primary bg-primary/5 shadow-sm"
                      : "border-border bg-surface hover:bg-surface-raised/70"
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span
                          className={`rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${
                            app.status === "pending"
                              ? "bg-npc/15 text-npc-dark"
                              : app.status === "approved"
                                ? "bg-success/15 text-success"
                                : app.status === "rejected"
                                  ? "bg-danger/15 text-danger"
                                  : "bg-info/15 text-info"
                          }`}
                        >
                          {app.status}
                        </span>
                        <span className="text-[11px] text-text-dim">
                          {app.type.replace(/_/g, " ")}
                        </span>
                      </div>
                      <h4 className="mt-1 text-sm font-semibold text-text line-clamp-2">
                        {app.title}
                      </h4>
                    </div>
                    <ChevronRight
                      size={16}
                      className={`shrink-0 transition-transform ${
                        isSelected ? "translate-x-0.5 text-primary" : "text-text-muted"
                      }`}
                    />
                  </div>

                  <div className="mt-2.5 flex items-center justify-between text-[11px] text-text-dim border-t border-border/50 pt-2">
                    <div className="flex items-center gap-3">
                      <span className="flex items-center gap-1">
                        <Layers size={12} />
                        {app.targetCount} {app.targetCount === 1 ? "card" : "cards"}
                      </span>
                      <span>By: {app.requestedBy}</span>
                    </div>
                    <span className="flex items-center gap-1">
                      <Clock size={11} />
                      {new Date(app.createdAt).toLocaleDateString()}
                    </span>
                  </div>

                  {/* Inline Decision Actions for Pending */}
                  {app.status === "pending" && (
                    <div
                      className="mt-3 flex flex-col gap-2 pt-2 border-t border-border/60"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <input
                        type="text"
                        placeholder="Add decision note or reason…"
                        value={decisionNotes[app.id] ?? ""}
                        onChange={(e) =>
                          setDecisionNotes({
                            ...decisionNotes,
                            [app.id]: e.target.value,
                          })
                        }
                        className="w-full rounded border border-border bg-bg px-2.5 py-1 text-xs text-text placeholder:text-text-muted focus:border-primary focus:outline-none"
                      />
                      <div className="flex gap-2 justify-end">
                        <button
                          type="button"
                          disabled={isBusy}
                          onClick={() => handleDecision(app.id, "reject")}
                          className="flex items-center gap-1 rounded bg-danger/10 px-2.5 py-1 text-xs font-semibold text-danger hover:bg-danger/20 disabled:opacity-50"
                        >
                          <X size={12} />
                          <span>Reject</span>
                        </button>
                        <button
                          type="button"
                          disabled={isBusy}
                          onClick={() => handleDecision(app.id, "request_revision")}
                          className="flex items-center gap-1 rounded bg-npc/10 px-2.5 py-1 text-xs font-semibold text-npc-dark hover:bg-npc/20 disabled:opacity-50"
                        >
                          <RotateCcw size={12} />
                          <span>Revision</span>
                        </button>
                        <button
                          type="button"
                          disabled={isBusy}
                          onClick={() => handleDecision(app.id, "approve")}
                          className="flex items-center gap-1 rounded bg-primary px-3 py-1 text-xs font-semibold text-white hover:bg-primary-hover disabled:opacity-50"
                        >
                          <Check size={12} />
                          <span>Approve & Unblock</span>
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>

        {/* Detail View */}
        <div className="w-1/2 flex-1 overflow-y-auto p-4 bg-surface/30">
          {!selectedApprovalId ? (
            <div className="flex h-full flex-col items-center justify-center text-center text-xs text-text-muted p-8">
              <ShieldCheck size={40} className="mb-2 text-text-dim opacity-40" />
              <p>Select an approval from the list to inspect its targets and history.</p>
            </div>
          ) : loadingDetail ? (
            <div className="py-12 text-center text-xs text-text-muted">
              {t("common.loading") || "Loading details…"}
            </div>
          ) : !detail ? (
            <div className="py-8 text-center text-xs text-danger">Failed to load details.</div>
          ) : (
            <div className="space-y-4">
              <div>
                <span
                  className={`inline-block rounded px-2 py-0.5 text-xs font-semibold uppercase tracking-wider mb-2 ${
                    detail.status === "pending"
                      ? "bg-npc/15 text-npc-dark"
                      : detail.status === "approved"
                        ? "bg-success/15 text-success"
                        : detail.status === "rejected"
                          ? "bg-danger/15 text-danger"
                          : "bg-info/15 text-info"
                  }`}
                >
                  {detail.status}
                </span>
                <h3 className="text-lg font-bold text-text">{detail.title}</h3>
                <div className="mt-1 text-xs text-text-dim">
                  Type: <span className="text-text font-medium">{detail.type}</span> · Requested by:{" "}
                  <span className="text-text font-medium">{detail.requestedBy}</span>
                </div>
              </div>

              {detail.decisionNote && (
                <div className="rounded-lg border border-border bg-surface p-3 text-xs">
                  <div className="font-semibold text-text-dim mb-1">Decision Note:</div>
                  <div className="text-text whitespace-pre-wrap">{detail.decisionNote}</div>
                  {detail.decidedAt && (
                    <div className="mt-1 text-[10px] text-text-dim">
                      Decided on {new Date(detail.decidedAt).toLocaleString()}
                    </div>
                  )}
                </div>
              )}

              {/* Target Cards */}
              <div className="space-y-2">
                <h4 className="text-xs font-bold uppercase tracking-wider text-text-dim">
                  Target Tasks ({detail.targets.length})
                </h4>
                {detail.targets.length === 0 ? (
                  <div className="rounded border border-border bg-surface p-3 text-xs text-text-muted">
                    No target cards attached (e.g. project registration).
                  </div>
                ) : (
                  detail.targets.map((target) => (
                    <div
                      key={target.taskId}
                      className="flex items-center justify-between rounded-lg border border-border bg-surface p-3 text-xs"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="font-semibold text-text truncate">
                          {target.task?.title || `Task ${target.taskId}`}
                        </div>
                        <div className="mt-0.5 flex items-center gap-2 text-[11px] text-text-dim">
                          <span>Status: {target.task?.status || "blocked"}</span>
                          {target.task?.assignee && <span>· {target.task.assignee}</span>}
                          {target.decision && (
                            <span className="font-semibold text-primary">
                              · Decision: {target.decision}
                            </span>
                          )}
                        </div>
                      </div>
                      {onOpenCard && (
                        <button
                          type="button"
                          onClick={() => onOpenCard(target.taskId)}
                          className="ml-2 rounded px-2 py-1 text-caption font-semibold text-primary hover:bg-primary/10"
                        >
                          Open Card
                        </button>
                      )}
                    </div>
                  ))
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Create Modal */}
      {showCreateModal && (
        <CreateApprovalModal
          channelId={channelId}
          onClose={() => setShowCreateModal(false)}
          onCreated={() => {
            setShowCreateModal(false);
            loadApprovals();
          }}
        />
      )}
    </div>
  );
}

function CreateApprovalModal({
  channelId,
  onClose,
  onCreated,
}: {
  channelId: string;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [title, setTitle] = useState("");
  const [items, setItems] = useState<Array<{ title: string; body: string }>>([
    { title: "", body: "" },
  ]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const addItem = () => {
    setItems([...items, { title: "", body: "" }]);
  };

  const removeItem = (index: number) => {
    setItems(items.filter((_, i) => i !== index));
  };

  const updateItem = (index: number, field: "title" | "body", value: string) => {
    const next = [...items];
    next[index][field] = value;
    setItems(next);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) {
      setError("Please provide a batch title.");
      return;
    }
    const validItems = items.filter((item) => item.title.trim().length > 0);
    if (validItems.length === 0) {
      setError("Add at least one valid card to the batch.");
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      await createApprovalBatch(channelId, {
        title: title.trim(),
        items: validItems.map((item) => ({
          title: item.title.trim(),
          body: item.body.trim() || undefined,
        })),
      });
      onCreated();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to create approval batch");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="w-full max-w-lg rounded-xl border border-border bg-surface p-5 shadow-2xl">
        <div className="flex items-center justify-between border-b border-border pb-3">
          <h3 className="text-base font-bold text-text">New Pre-execution Approval Batch</h3>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 text-text-muted hover:text-text"
          >
            <X size={16} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="mt-4 space-y-4">
          {error && (
            <div className="rounded-md bg-danger/10 p-2.5 text-xs text-danger">{error}</div>
          )}

          <div>
            <label className="block text-xs font-semibold text-text mb-1">Batch Title</label>
            <input
              type="text"
              required
              placeholder="e.g. Q4 Growth Architecture Initiative"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full rounded-md border border-border bg-bg px-3 py-1.5 text-sm text-text focus:border-primary focus:outline-none"
            />
          </div>

          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-xs font-semibold text-text">
                Target Cards (created as blocked)
              </label>
              <button
                type="button"
                onClick={addItem}
                className="flex items-center gap-1 text-xs font-medium text-primary hover:underline"
              >
                <Plus size={12} /> Add Card
              </button>
            </div>

            <div className="max-h-60 overflow-y-auto space-y-2 pr-1">
              {items.map((item, idx) => (
                <div
                  key={idx}
                  className="rounded-lg border border-border/80 bg-bg/50 p-2.5 space-y-2"
                >
                  <div className="flex items-center justify-between gap-2">
                    <input
                      type="text"
                      placeholder={`Card #${idx + 1} Title`}
                      value={item.title}
                      onChange={(e) => updateItem(idx, "title", e.target.value)}
                      className="flex-1 rounded border border-border bg-bg px-2.5 py-1 text-xs text-text focus:border-primary focus:outline-none"
                    />
                    {items.length > 1 && (
                      <button
                        type="button"
                        onClick={() => removeItem(idx)}
                        className="rounded p-1 text-text-muted hover:text-danger"
                      >
                        <Trash2 size={13} />
                      </button>
                    )}
                  </div>
                  <textarea
                    rows={2}
                    placeholder="Description / body (optional)"
                    value={item.body}
                    onChange={(e) => updateItem(idx, "body", e.target.value)}
                    className="w-full rounded border border-border bg-bg px-2.5 py-1 text-xs text-text focus:border-primary focus:outline-none resize-none"
                  />
                </div>
              ))}
            </div>
          </div>

          <div className="flex justify-end gap-2 border-t border-border pt-3">
            <button
              type="button"
              onClick={onClose}
              className="rounded-md px-3 py-1.5 text-xs font-medium text-text-secondary hover:bg-surface-raised"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="rounded-md bg-primary px-4 py-1.5 text-xs font-semibold text-white hover:bg-primary-hover disabled:opacity-50"
            >
              {submitting ? "Creating…" : "Create Approval"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
