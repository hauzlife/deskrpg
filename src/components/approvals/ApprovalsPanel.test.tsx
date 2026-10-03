import "../../test-setup/dom";

import assert from "node:assert/strict";
import test, { afterEach, beforeEach } from "node:test";
import { act } from "react";
import { createRoot } from "react-dom/client";

import { I18nProvider } from "@/lib/i18n";
import ApprovalsPanel from "./ApprovalsPanel";

let container: HTMLDivElement;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
});

afterEach(() => {
  container.remove();
});

test("ApprovalsPanel renders header, tabs, and loads approval items", async () => {
  const originalFetch = global.fetch;
  const mockApprovals = [
    {
      id: "app-1",
      channelId: "c1",
      type: "task_execution",
      status: "pending",
      requestedBy: "sophie",
      title: "Follow-up Tasks Approval",
      source: { kind: "meeting", id: "m1" },
      boardSlug: "default",
      targetCount: 2,
      taskIds: ["task-1", "task-2"],
      decidedBy: null,
      decidedAt: null,
      decisionNote: null,
      createdAt: new Date().toISOString(),
    },
  ];

  global.fetch = async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("/approvals")) {
      return {
        ok: true,
        json: async () => ({ ok: true, approvals: mockApprovals, total: 1 }),
      } as Response;
    }
    return { ok: false, status: 404, json: async () => ({}) } as Response;
  };

  try {
    const root = createRoot(container);
    await act(async () => {
      root.render(
        <I18nProvider initialLocale="en">
          <ApprovalsPanel channelId="c1" />
        </I18nProvider>,
      );
    });

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });

    // Check header exists
    const title = container.querySelector("h2");
    assert.ok(title);
    assert.equal(title.textContent, "Approvals");

    // Check item rendered
    const item = container.querySelector("h4");
    assert.ok(item);
    assert.equal(item.textContent, "Follow-up Tasks Approval");

    // Check pending count badge
    const badge = container.querySelector("span.rounded-full");
    assert.ok(badge);
    assert.equal(badge.textContent, "1");

    root.unmount();
  } finally {
    global.fetch = originalFetch;
  }
});
