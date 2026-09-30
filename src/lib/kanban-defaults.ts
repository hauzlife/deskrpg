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

/**
 * Card creation never leaves work unassigned. Prefer the canonical DeskRPG backend profile and
 * accept the legacy Kanban profile name while existing boards migrate.
 */
export const DEFAULT_TASK_ASSIGNEE_PROFILES = ["backend-engineer", "dev_backend"] as const;
export const DEFAULT_TASK_PRIORITY = "5";

export const DEFAULT_REVIEW_POLICY: KanbanReviewPolicy = {
  version: 1,
  mode: "agent",
  reviewer_profile: DEFAULT_REVIEWER_PROFILE,
};
