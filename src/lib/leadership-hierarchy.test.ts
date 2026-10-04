import test from "node:test";
import assert from "node:assert/strict";

import {
  isCommanderEscalation,
  resolveSquadLead,
  type NpcRosterItem,
} from "./leadership-hierarchy";

const createNpc = (
  id: string,
  name: string,
  profileName: string,
  posX = 10,
  posY = 10,
  active = true,
): NpcRosterItem => ({
  id,
  name,
  profileName,
  role: profileName,
  active,
  positionX: posX,
  positionY: posY,
});

test("backend-engineer resolves to technical-architect as primary lead", () => {
  const dev = createNpc("dev-1", "Dev Backend", "backend-engineer");
  const architect = createNpc("arch-1", "Tech Lead", "technical-architect", 15, 12);
  const pm = createNpc("pm-1", "PM Lead", "product-manager", 20, 20);

  const roster = [dev, architect, pm];
  const lead = resolveSquadLead(dev, roster);

  assert.equal(lead?.id, "arch-1");
  assert.equal(lead?.name, "Tech Lead");
});

test("backend-engineer falls back to cto if technical-architect is absent", () => {
  const dev = createNpc("dev-1", "Dev Backend", "backend-engineer");
  const cto = createNpc("cto-1", "CTO", "cto", 18, 14);
  const pm = createNpc("pm-1", "PM Lead", "product-manager", 20, 20);

  const roster = [dev, cto, pm];
  const lead = resolveSquadLead(dev, roster);

  assert.equal(lead?.id, "cto-1");
});

test("qa-engineer resolves to reviewer as primary lead", () => {
  const qa = createNpc("qa-1", "QA Engineer", "qa-engineer");
  const reviewer = createNpc("rev-1", "Code Reviewer", "reviewer", 14, 16);
  const pm = createNpc("pm-1", "PM Lead", "product-manager", 20, 20);

  const roster = [qa, reviewer, pm];
  const lead = resolveSquadLead(qa, roster);

  assert.equal(lead?.id, "rev-1");
});

test("qa-engineer falls back to product-manager if reviewer is absent", () => {
  const qa = createNpc("qa-1", "QA Engineer", "qa-engineer");
  const pm = createNpc("pm-1", "PM Lead", "product-manager", 20, 20);

  const roster = [qa, pm];
  const lead = resolveSquadLead(qa, roster);

  assert.equal(lead?.id, "pm-1");
});

test("inactive NPCs or NPCs with null positions are never chosen as leads", () => {
  const dev = createNpc("dev-1", "Dev Backend", "backend-engineer");
  const inactiveArch = createNpc("arch-1", "Tech Lead", "technical-architect", 15, 12, false);
  const nullPosCto = createNpc("cto-1", "CTO", "cto", null as unknown as number, null as unknown as number, true);
  const activePm = createNpc("pm-1", "PM Lead", "product-manager", 20, 20, true);

  const roster = [dev, inactiveArch, nullPosCto, activePm];
  const lead = resolveSquadLead(dev, roster);

  assert.equal(lead?.id, "pm-1");
});

test("general fallback routes to orchestrator when available", () => {
  const dev = createNpc("dev-1", "Specialist", "unknown-specialist");
  const orch = createNpc("orch-1", "Orchestrator", "orchestrator", 25, 25);

  const roster = [dev, orch];
  const lead = resolveSquadLead(dev, roster);

  assert.equal(lead?.id, "orch-1");
});

test("isCommanderEscalation flags P0 and critical alerts correctly", () => {
  assert.equal(isCommanderEscalation("P0: Database connection pool exhausted", "Out of memory"), true);
  assert.equal(isCommanderEscalation("[CRITICAL] Payment gateway down", "Webhook timeout"), true);
  assert.equal(isCommanderEscalation("Normal task", "BLOCKED:HUMAN approval needed"), true);
  assert.equal(isCommanderEscalation("Fix margin top avoid cloud", "Regular CSS fix"), false);
  assert.equal(isCommanderEscalation("Card MYS-01 Done", "Finished forecast composer"), false);
});
