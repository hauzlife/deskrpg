// GET /api/channels/:id/approvals — list channel approvals
// POST /api/channels/:id/approvals — create an approval batch
import type { NextRequest } from "next/server";

import { createApproval, listApprovals, type ChannelParams } from "@/lib/approval-routes";

export async function GET(req: NextRequest, { params }: ChannelParams) {
  const { id } = await params;
  return listApprovals(req, id);
}

export async function POST(req: NextRequest, { params }: ChannelParams) {
  const { id } = await params;
  return createApproval(req, id);
}
