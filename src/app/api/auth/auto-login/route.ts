import { db, users, channels } from "@/db";
import { signJWT, isSecureCookie, authCookieSameSite } from "@/lib/jwt";
import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";

const PRIMARY_USER_ID = "18d2b828-f0ea-414b-9222-2ed5001fb774";
const PRIMARY_CHANNEL_ID = "104c62be-838c-48ad-8351-368b1493a304";

export async function POST() {
  let [user] = await db.select().from(users).where(eq(users.id, PRIMARY_USER_ID)).limit(1);

  if (!user) {
    [user] = await db.select().from(users).limit(1);
  }

  if (!user) {
    return NextResponse.json({ errorCode: "no_user_found", error: "No user found in database" }, { status: 404 });
  }

  const token = await signJWT({ userId: user.id, nickname: user.nickname });

  const [channel] = await db
    .select({ id: channels.id })
    .from(channels)
    .where(eq(channels.ownerId, user.id))
    .limit(1);

  const targetChannelId = channel?.id || PRIMARY_CHANNEL_ID;

  const response = NextResponse.json({
    ok: true,
    user: { id: user.id, nickname: user.nickname },
    channelId: targetChannelId,
    redirectUrl: `/game?channelId=${targetChannelId}`,
  });

  response.cookies.set("token", token, {
    httpOnly: true,
    secure: isSecureCookie(),
    sameSite: authCookieSameSite(),
    maxAge: 60 * 60 * 24 * 7,
    path: "/",
  });

  return response;
}

export async function GET(req: import("next/server").NextRequest) {
  let [user] = await db.select().from(users).where(eq(users.id, PRIMARY_USER_ID)).limit(1);

  if (!user) {
    [user] = await db.select().from(users).limit(1);
  }

  if (!user) {
    return NextResponse.redirect(new URL("/auth", req.url));
  }

  const token = await signJWT({ userId: user.id, nickname: user.nickname });

  const [channel] = await db
    .select({ id: channels.id })
    .from(channels)
    .where(eq(channels.ownerId, user.id))
    .limit(1);

  const targetChannelId = channel?.id || PRIMARY_CHANNEL_ID;

  const response = NextResponse.redirect(new URL(`/game?channelId=${targetChannelId}`, req.url));

  response.cookies.set("token", token, {
    httpOnly: true,
    secure: isSecureCookie(),
    sameSite: authCookieSameSite(),
    maxAge: 60 * 60 * 24 * 7,
    path: "/",
  });

  return response;
}
