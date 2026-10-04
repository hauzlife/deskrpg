import "../../test-setup/dom";
import test from "node:test";
import assert from "node:assert/strict";
import { act } from "react";
import { createRoot } from "react-dom/client";
import AgentTerminalModal from "./AgentTerminalModal";

type SocketListener = (...args: any[]) => void;

function createMockSocket() {
  const listeners = new Map<string, Set<SocketListener>>();
  const emitted: Array<{ event: string; data: any }> = [];

  return {
    id: "socket-test-1",
    connected: true,
    emitted,
    on(event: string, fn: SocketListener) {
      if (!listeners.has(event)) listeners.set(event, new Set());
      listeners.get(event)!.add(fn);
      return this;
    },
    off(event: string, fn: SocketListener) {
      listeners.get(event)?.delete(fn);
      return this;
    },
    emit(event: string, data: any) {
      emitted.push({ event, data });
      return this;
    },
    trigger(event: string, ...args: any[]) {
      listeners.get(event)?.forEach((fn) => fn(...args));
    },
  };
}

test("AgentTerminalModal renders terminal header, banner, and CLI prompt", async () => {
  const socket = createMockSocket();
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);

  let closed = false;

  await act(async () => {
    root.render(
      <AgentTerminalModal
        npcId="npc-hermes-1"
        npcName="Dante"
        socket={socket as any}
        onClose={() => {
          closed = true;
        }}
      />,
    );
  });

  try {
    assert.match(host.textContent!, /DESKRPG WORKSTATION CONSOLE/);
    assert.match(host.textContent!, /DANTE/);
    assert.match(host.textContent!, /dante@deskrpg:~\$/);
    assert.match(host.textContent!, /IDLE/);

    // Initial history request was emitted
    const histReq = socket.emitted.find((e) => e.event === "npc:history");
    assert.ok(histReq);
    assert.equal(histReq.data.npcId, "npc-hermes-1");
  } finally {
    await act(async () => root.unmount());
    host.remove();
  }
});

test("AgentTerminalModal updates activity badge and logs when tool runs", async () => {
  const socket = createMockSocket();
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);

  await act(async () => {
    root.render(
      <AgentTerminalModal
        npcId="npc-hermes-1"
        npcName="Dante"
        socket={socket as any}
        onClose={() => {}}
      />,
    );
  });

  try {
    await act(async () => {
      socket.trigger("npc:activity", {
        npcId: "npc-hermes-1",
        activityKey: "npc.activity.runningCommand",
      });
    });

    assert.match(host.textContent!, /RUNNINGCOMMAND/);
    assert.match(host.textContent!, /npc\.activity\.runningCommand/);

    // Stream response chunk
    await act(async () => {
      socket.trigger("npc:response", {
        npcId: "npc-hermes-1",
        chunk: "Hello from Hermes agent runtime!",
      });
    });

    assert.match(host.textContent!, /Hello from Hermes agent runtime!/);
  } finally {
    await act(async () => root.unmount());
    host.remove();
  }
});

test("AgentTerminalModal dispatches command when submitted from prompt", async () => {
  const socket = createMockSocket();
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);

  await act(async () => {
    root.render(
      <AgentTerminalModal
        npcId="npc-hermes-1"
        npcName="Dante"
        socket={socket as any}
        characterId="char-1"
        onClose={() => {}}
      />,
    );
  });

  try {
    const input = host.querySelector("input") as HTMLInputElement;
    const form = host.querySelector("form") as HTMLFormElement;
    assert.ok(input);
    assert.ok(form);

    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        "value",
      )?.set;
      setter?.call(input, "git status");
      input.dispatchEvent(new Event("input", { bubbles: true }));
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });

    // Chat dispatch was emitted
    const chatReq = socket.emitted.find((e) => e.event === "npc:chat");
    assert.ok(chatReq);
    assert.equal(chatReq.data.npcId, "npc-hermes-1");
    assert.equal(chatReq.data.message, "git status");
    assert.equal(chatReq.data.characterId, "char-1");
  } finally {
    await act(async () => root.unmount());
    host.remove();
  }
});
