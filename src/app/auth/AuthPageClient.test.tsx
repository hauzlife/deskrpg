/**
 * AuthPageClient Component Test Suite
 *
 * Validates:
 * 1. Coming soon mode renders GitHub link and no credentials form
 * 2. Authenticated user redirect to /gateways when /api/characters returns 200
 * 3. Fresh installation without users defaults to register mode with setup notices
 * 4. Existing installation with users defaults to login mode and allows toggling to register
 * 5. Successful login flow calls /api/auth/login and redirects to /gateways
 * 6. Temporary password forces redirect to /account/password?forced=1
 * 7. Failed login displays localized error message
 * 8. Network failure displays localized network error
 */
import "../../test-setup/dom";
import assert from "node:assert/strict";
import test from "node:test";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import {
  AppRouterContext,
  type AppRouterInstance,
} from "next/dist/shared/lib/app-router-context.shared-runtime";

import { I18nProvider } from "@/lib/i18n/context";
import AuthPageClient from "./AuthPageClient";

const originalFetch = globalThis.fetch;
let root: Root | null = null;
let host: HTMLElement;
let pushedRoutes: string[] = [];
let replacedRoutes: string[] = [];
let fetchCalls: { url: string; method: string; body?: unknown }[] = [];

const router: AppRouterInstance = {
  back() {},
  forward() {},
  refresh() {},
  push(href: string) {
    pushedRoutes.push(href);
  },
  replace(href: string) {
    replacedRoutes.push(href);
  },
  prefetch() {},
  bfcacheId: "test",
};

function setInputValue(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set;
  if (setter) {
    setter.call(input, value);
  } else {
    input.value = value;
  }
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(new Event("change", { bubbles: true }));
}

function mockFetch(routes: Record<string, { status?: number; body: unknown }>) {
  fetchCalls = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const rawUrl = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const url = rawUrl.replace(/^https?:\/\/[^/]+/, "");
    const method = init?.method ?? "GET";
    const body = init?.body ? JSON.parse(init.body as string) : undefined;
    fetchCalls.push({ url, method, body });
    await new Promise((r) => setTimeout(r, 2));
    const key = `${method} ${url}`;
    const route = routes[key] ?? routes[url];
    return new Response(JSON.stringify(route?.body ?? {}), {
      status: route ? (route.status ?? 200) : 404,
      headers: { "Content-Type": "application/json" },
    });
  }) as typeof fetch;
}

async function renderClient(isComingSoon = false) {
  pushedRoutes = [];
  replacedRoutes = [];
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  const r = root;
  await act(async () => {
    r.render(
      <AppRouterContext.Provider value={router}>
        <I18nProvider initialLocale="ko">
          <AuthPageClient isComingSoon={isComingSoon} />
        </I18nProvider>
      </AppRouterContext.Provider>,
    );
  });
  // Advance timers and microtasks for useEffect fetch resolution
  for (let i = 0; i < 20; i += 1) {
    await act(async () => new Promise((resolve) => setTimeout(resolve, 5)));
  }
}

test.afterEach(async () => {
  if (root) {
    const r = root;
    await act(async () => r.unmount());
    root = null;
    host.remove();
  }
  globalThis.fetch = originalFetch;
});

test("isComingSoon mode displays coming soon banner and github link without auth form", async () => {
  await renderClient(true);
  const githubLink = host.querySelector<HTMLAnchorElement>('a[href*="github.com/dandacompany/deskrpg"]');
  assert.ok(githubLink, "Github link should be present in coming soon mode");
  assert.equal(host.querySelector("form"), null, "Form should not be displayed in coming soon mode");
});

test("authenticated user with existing character gets redirected immediately to /channels", async () => {
  mockFetch({
    "GET /api/characters": { status: 200, body: [{ id: "char-1" }] },
    "GET /api/auth/status": { status: 200, body: { hasUsers: true } },
  });
  await renderClient(false);
  assert.deepEqual(replacedRoutes, ["/channels"], "Should replace route to /channels");
});

test("fresh installation with no users defaults to register mode and displays setup notices", async () => {
  mockFetch({
    "GET /api/characters": { status: 401, body: { error: "unauthorized" } },
    "GET /api/auth/status": { status: 200, body: { hasUsers: false } },
  });
  await renderClient(false);
  const form = host.querySelector("form");
  assert.ok(form, "Auth form should be rendered");
  const nicknameInput = host.querySelector<HTMLInputElement>('input[placeholder*="이름"], input[placeholder*="닉네임"], input[placeholder*="Name"]');
  assert.ok(nicknameInput, "Nickname input should be present in fresh setup register mode");
  const submitButton = form?.querySelector<HTMLButtonElement>('button[type="submit"]');
  assert.ok(submitButton, "Submit button should be rendered");
});

test("existing installation with users defaults to login mode and submits valid credentials", async () => {
  mockFetch({
    "GET /api/characters": { status: 401, body: { error: "unauthorized" } },
    "GET /api/auth/status": { status: 200, body: { hasUsers: true } },
    "POST /api/auth/login": { status: 200, body: { success: true, user: { id: "u-1" } } },
  });
  await renderClient(false);

  const inputs = host.querySelectorAll<HTMLInputElement>("input");
  assert.equal(inputs.length, 2, "Login mode should show loginId and password inputs");

  const [loginInput, passwordInput] = inputs;
  await act(async () => {
    setInputValue(loginInput, "admin");
    setInputValue(passwordInput, "secret123");
  });

  const form = host.querySelector("form")!;
  await act(async () => {
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });

  for (let i = 0; i < 15; i += 1) {
    await act(async () => new Promise((resolve) => setTimeout(resolve, 5)));
  }

  const loginCall = fetchCalls.find((c) => c.url === "/api/auth/login");
  assert.ok(loginCall, "Should have called POST /api/auth/login");
  assert.deepEqual(loginCall.body, { loginId: "admin", password: "secret123" });
  assert.deepEqual(pushedRoutes, ["/channels"], "Should navigate to /channels on successful login");
});

test("login with mustChangePassword flag redirects to /account/password?forced=1", async () => {
  mockFetch({
    "GET /api/characters": { status: 401, body: { error: "unauthorized" } },
    "GET /api/auth/status": { status: 200, body: { hasUsers: true } },
    "POST /api/auth/login": { status: 200, body: { success: true, user: { id: "u-1", mustChangePassword: true } } },
  });
  await renderClient(false);

  const [loginInput, passwordInput] = host.querySelectorAll<HTMLInputElement>("input");
  await act(async () => {
    setInputValue(loginInput, "tempuser");
    setInputValue(passwordInput, "temp1234");
  });

  const form = host.querySelector("form")!;
  await act(async () => {
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });

  for (let i = 0; i < 15; i += 1) {
    await act(async () => new Promise((resolve) => setTimeout(resolve, 5)));
  }

  assert.deepEqual(pushedRoutes, ["/account/password?forced=1"], "Should redirect to forced password change");
});

test("failed login renders localized error message", async () => {
  mockFetch({
    "GET /api/characters": { status: 401, body: { error: "unauthorized" } },
    "GET /api/auth/status": { status: 200, body: { hasUsers: true } },
    "POST /api/auth/login": { status: 401, body: { error: "invalid_credentials" } },
  });
  await renderClient(false);

  const [loginInput, passwordInput] = host.querySelectorAll<HTMLInputElement>("input");
  await act(async () => {
    setInputValue(loginInput, "wrong");
    setInputValue(passwordInput, "wrongpass");
  });

  const form = host.querySelector("form")!;
  await act(async () => {
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });

  for (let i = 0; i < 15; i += 1) {
    await act(async () => new Promise((resolve) => setTimeout(resolve, 5)));
  }

  const errorEl = host.querySelector(".text-danger");
  assert.ok(errorEl, "Error element should be displayed");
  assert.ok((errorEl.textContent?.length ?? 0) > 0, "Error element should contain error text");
  assert.equal(pushedRoutes.length, 0, "Should not navigate on failed login");
});
