import "../test-setup/dom";
import assert from "node:assert/strict";
import test from "node:test";
import { getSocketServerUrl } from "./socket-url";

test.afterEach(() => {
  delete process.env.NEXT_PUBLIC_SOCKET_URL;
});

test("returns explicit NEXT_PUBLIC_SOCKET_URL when configured", () => {
  process.env.NEXT_PUBLIC_SOCKET_URL = "wss://realtime.example.com";
  assert.equal(getSocketServerUrl(), "wss://realtime.example.com");
});

test("returns currentPort + 1 when running standalone on localhost:3000", () => {
  const originalLocation = globalThis.window?.location;
  globalThis.window = {
    location: {
      protocol: "http:",
      hostname: "localhost",
      port: "3000",
    },
  } as unknown as Window & typeof globalThis;

  assert.equal(getSocketServerUrl(), "http://localhost:3001");

  globalThis.window = (originalLocation ? { location: originalLocation } : undefined) as unknown as Window & typeof globalThis;
});

test("returns currentPort + 1 when running standalone on 127.0.0.1:3000", () => {
  const originalLocation = globalThis.window?.location;
  globalThis.window = {
    location: {
      protocol: "http:",
      hostname: "127.0.0.1",
      port: "3000",
    },
  } as unknown as Window & typeof globalThis;

  assert.equal(getSocketServerUrl(), "http://127.0.0.1:3001");

  globalThis.window = (originalLocation ? { location: originalLocation } : undefined) as unknown as Window & typeof globalThis;
});

test("returns undefined on other hosts/ports to connect through reverse proxy origin", () => {
  const originalLocation = globalThis.window?.location;
  globalThis.window = {
    location: {
      protocol: "https:",
      hostname: "office.mycompany.com",
      port: "443",
    },
  } as unknown as Window & typeof globalThis;

  assert.equal(getSocketServerUrl(), undefined);

  globalThis.window = (originalLocation ? { location: originalLocation } : undefined) as unknown as Window & typeof globalThis;
});

