import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_REVIEW_POLICY,
  DEFAULT_REVIEWER_PROFILE,
  DEFAULT_SWARM_SYNTHESIZER_PROFILE,
  DEFAULT_SWARM_VERIFIER_PROFILE,
  DEFAULT_SWARM_WORKERS,
} from "./kanban-defaults";

test("the company swarm defaults name the implementation, verification, synthesis, and approval profiles", () => {
  assert.deepEqual(DEFAULT_SWARM_WORKERS, [
    { profileName: "backend-engineer", title: "Backend implementation" },
    { profileName: "frontend-engineer", title: "Frontend implementation" },
  ]);
  assert.equal(DEFAULT_SWARM_VERIFIER_PROFILE, "ml-engineer");
  assert.equal(DEFAULT_SWARM_SYNTHESIZER_PROFILE, "orchestrator");
  assert.equal(DEFAULT_REVIEWER_PROFILE, "reviewer");
  assert.deepEqual(DEFAULT_REVIEW_POLICY, {
    version: 1,
    mode: "agent",
    reviewer_profile: "reviewer",
  });
});
