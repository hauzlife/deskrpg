import assert from "node:assert/strict";
import test from "node:test";
import { metadata } from "./not-found";

test("not-found metadata sets noindex and follow true for 404 error resilience", () => {
  assert.equal(metadata.title, "404 — Page Not Found | DeskRPG for Hermes");
  assert.deepEqual(metadata.robots, {
    index: false,
    follow: true,
  });
  assert.ok(metadata.description.length > 0);
});
