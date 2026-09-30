import type { KanbanReviewPolicy } from "@/lib/hermes/deskrpg-plugin-types";

/**
 * Company-wide swarm and approval defaults. These are profile names rather than NPC ids
 * because each channel has its own NPC row for the same Hermes employee.
 */
export const DEFAULT_SWARM_WORKERS = [
  { profileName: "backend-engineer", title: "Backend implementation" },
  { profileName: "frontend-engineer", title: "Frontend implementation" },
] as const;

export const DEFAULT_SWARM_VERIFIER_PROFILE = "ml-engineer";
export const DEFAULT_SWARM_SYNTHESIZER_PROFILE = "orchestrator";
export const DEFAULT_REVIEWER_PROFILE = "reviewer";

export const DEFAULT_REVIEW_POLICY: KanbanReviewPolicy = {
  version: 1,
  mode: "agent",
  reviewer_profile: DEFAULT_REVIEWER_PROFILE,
};
