export type ApprovalSummary = {
  id: string;
  channelId: string;
  type: string;
  status: "pending" | "approved" | "rejected" | "revision_requested" | string;
  requestedBy: string;
  title: string;
  source: { kind: string; id: string } | null;
  boardSlug: string | null;
  targetCount: number;
  taskIds: string[];
  decidedBy: string | null;
  decidedAt: string | null;
  decisionNote: string | null;
  createdAt: string;
};

export type ApprovalTargetItem = {
  taskId: string;
  decision: string | null;
  task?: {
    title?: string;
    status?: string;
    priority?: string | number | null;
    assignee?: string | null;
  } | null;
};

export type ApprovalDetail = {
  id: string;
  channelId: string;
  type: string;
  status: string;
  requestedBy: string;
  title: string;
  source: { kind: string; id: string } | null;
  boardSlug: string | null;
  targets: ApprovalTargetItem[];
  decidedBy: string | null;
  decidedAt: string | null;
  decisionNote: string | null;
  createdAt: string;
};

export type CreateApprovalInput = {
  title: string;
  type?: string;
  boardSlug?: string;
  items: Array<{
    title: string;
    body?: string;
    npcId?: string;
    tenant?: string;
  }>;
};

export async function fetchApprovals(
  channelId: string,
  status?: string,
): Promise<{ ok: boolean; approvals: ApprovalSummary[]; total: number }> {
  const query = status && status !== "all" ? `?status=${encodeURIComponent(status)}` : "";
  const res = await fetch(`/api/channels/${encodeURIComponent(channelId)}/approvals${query}`);
  if (!res.ok) {
    const errorData = await res.json().catch(() => ({}));
    throw new Error(errorData.error || `Failed to fetch approvals (${res.status})`);
  }
  return res.json();
}

export async function fetchApprovalDetail(
  channelId: string,
  approvalId: string,
): Promise<{ ok: boolean; approval: ApprovalDetail }> {
  const res = await fetch(
    `/api/channels/${encodeURIComponent(channelId)}/approvals/${encodeURIComponent(approvalId)}`,
  );
  if (!res.ok) {
    const errorData = await res.json().catch(() => ({}));
    throw new Error(errorData.error || `Failed to fetch approval detail (${res.status})`);
  }
  return res.json();
}

export async function submitApprovalDecision(
  channelId: string,
  approvalId: string,
  decision: "approve" | "reject" | "request_revision",
  note?: string,
  targets?: Array<{ task_id: string; decision: string }>,
): Promise<{ ok: boolean; status: string; unblocked?: string[] }> {
  const res = await fetch(
    `/api/channels/${encodeURIComponent(channelId)}/approvals/${encodeURIComponent(approvalId)}/decide`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        decision,
        note: note || undefined,
        targets: targets || undefined,
      }),
    },
  );
  if (!res.ok) {
    const errorData = await res.json().catch(() => ({}));
    throw new Error(errorData.error || `Decision failed (${res.status})`);
  }
  return res.json();
}

export async function createApprovalBatch(
  channelId: string,
  input: CreateApprovalInput,
): Promise<{ ok: boolean; approvalId: string; taskIds: (string | null)[] }> {
  const res = await fetch(`/api/channels/${encodeURIComponent(channelId)}/approvals`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    const errorData = await res.json().catch(() => ({}));
    throw new Error(errorData.error || `Create approval batch failed (${res.status})`);
  }
  return res.json();
}
