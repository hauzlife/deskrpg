import { SignJWT, jwtVerify } from "jose";

// Setting COOKIE_SECURE=false lets secure cookies be disabled in an HTTP deployment test environment.
export function isSecureCookie(): boolean {
  if (process.env.COOKIE_SECURE === "false") return false;
  if (process.env.COOKIE_SECURE === "true") return true;
  return process.env.NODE_ENV === "production";
}

/**
 * Selects the SameSite mode used by the authentication session cookie.
 *
 * The Office can be embedded in a desktop renderer whose top-level origin is
 * not `local.office`. In that deployment shape, `Lax` cookies are not sent
 * from the iframe and a successful login immediately looks unauthenticated.
 * `SameSite=None` is valid only together with `Secure`, so it is enabled only
 * for the same HTTPS mode selected by `isSecureCookie()`.
 */
export function authCookieSameSite(): "lax" | "none" {
  return isSecureCookie() ? "none" : "lax";
}

const JWT_EXPIRY = "7d";

import { DEV_JWT_SECRET } from "./dev-constants";

function getSecret() {
  const secret =
    process.env.JWT_SECRET || (process.env.NODE_ENV !== "production" ? DEV_JWT_SECRET : "");
  if (!secret) throw new Error("Missing JWT_SECRET");
  return new TextEncoder().encode(secret);
}

export interface JWTPayload {
  userId: string;
  nickname: string;
}

export async function signJWT(payload: JWTPayload): Promise<string> {
  return new SignJWT(payload as unknown as Record<string, unknown>)
    .setProtectedHeader({ alg: "HS256" })
    .setExpirationTime(JWT_EXPIRY)
    .setIssuedAt()
    .sign(getSecret());
}

export async function verifyJWT(token: string): Promise<JWTPayload | null> {
  try {
    const { payload } = await jwtVerify(token, getSecret());
    return payload as unknown as JWTPayload;
  } catch {
    return null;
  }
}
