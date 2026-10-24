import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";

const home = mkdtempSync(path.join(tmpdir(), "auto-login-route-"));
process.env.DESKRPG_HOME = home;
process.env.SQLITE_PATH = path.join(home, "test.db");
process.env.DB_TYPE = "sqlite";
process.on("exit", () => rmSync(home, { recursive: true, force: true }));

async function seedAdminUser() {
  const { db, users } = await import("@/db");
  const { hashPassword } = await import("@/lib/password");
  const [row] = await db
    .insert(users)
    .values({
      loginId: "admin-" + randomUUID(),
      nickname: `Admin-${randomUUID()}`,
      passwordHash: await hashPassword("secure-password"),
      systemRole: "system_admin",
      mustChangePassword: false,
    })
    .returning();
  return row;
}

test("GET /api/auth/auto-login redirects to office and issues session cookie", async () => {
  const { GET } = await import("./route");
  await seedAdminUser();

  const req = new NextRequest("http://localhost:3000/api/auth/auto-login", {
    method: "GET",
    headers: { host: "localhost:3000" },
  });

  const response = await GET(req);
  assert.equal(response.status, 307);
  assert.match(response.headers.get("location") || "", /\/game\?channelId=/);
  const cookie = response.headers.get("set-cookie");
  assert.ok(cookie);
  assert.match(cookie, /token=/);
});

test("POST /api/auth/auto-login returns JSON payload with channel and sets token cookie", async () => {
  const { POST } = await import("./route");

  const response = await POST();
  assert.equal(response.status, 200);
  const data = await response.json();
  assert.equal(data.ok, true);
  assert.ok(data.channelId);
  assert.match(data.redirectUrl, /\/game\?channelId=/);
  const cookie = response.headers.get("set-cookie");
  assert.ok(cookie);
  assert.match(cookie, /token=/);
});
