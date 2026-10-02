import assert from "node:assert/strict";
import test from "node:test";

test("useWorkspaceChannels module exports the hook function", async () => {
  const mod = await import("./use-workspace-channels");
  assert.equal(typeof mod.useWorkspaceChannels, "function");
});
