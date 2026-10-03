// GET /api/channels/:id/approvals/:approvalId — detailed view of an approval
import type { NextRequest } from "next/server";

import { getApprovalDetail, type ApprovalParams } from "@/lib/approval-routes";

export async function GET(req: NextRequest, { params }: ApprovalParams) {
  const { id, approvalId } = await params;
  return getApprovalDetail(req, id, approvalId);
}
