import { db, users } from "@/db";
import { count } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";
import { verifyJWT } from "@/lib/jwt";

export async function GET(req: NextRequest) {
  const [{ value: userCount }] = await db.select({ value: count() }).from(users);
  const token = req.cookies.get("token")?.value;
  const payload = token ? await verifyJWT(token) : null;
  return NextResponse.json({
    hasUsers: Number(userCount) > 0,
    authenticated: Boolean(payload),
    user: payload ? { id: payload.userId, nickname: payload.nickname } : null,
  });
}
