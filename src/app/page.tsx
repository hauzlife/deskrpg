import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { verifyJWT } from "@/lib/jwt";
import AuthPageClient from "./auth/AuthPageClient";
import JsonLd from "@/components/JsonLd";
import { createPublicShareMetadata, isPublicLandingEnabled } from "./social-preview";

export function generateMetadata(): Metadata {
  return isPublicLandingEnabled(process.env)
    ? createPublicShareMetadata()
    : { robots: { index: false, follow: false } };
}

import { db, channels } from "@/db";
import { eq } from "drizzle-orm";

const PRIMARY_CHANNEL_ID = "104c62be-838c-48ad-8351-368b1493a304";

export default async function Home() {
  if (isPublicLandingEnabled(process.env)) {
    return (
      <>
        <JsonLd />
        <AuthPageClient isComingSoon />
      </>
    );
  }

  const cookieStore = await cookies();
  const token = cookieStore.get("token")?.value;

  if (token) {
    const payload = await verifyJWT(token);
    if (payload) {
      const [channel] = await db
        .select({ id: channels.id })
        .from(channels)
        .where(eq(channels.ownerId, payload.userId))
        .limit(1);

      const targetChannelId = channel?.id || PRIMARY_CHANNEL_ID;
      redirect(`/game?channelId=${targetChannelId}`);
    }
  }

  redirect("/api/auth/auto-login");
}

