import assert from "node:assert/strict";
import test from "node:test";

import {
  OFFICIAL_SENTINELS,
  healSentinelOrigins,
  type CronJobLike,
} from "./cron-sentinel-discovery";

test("OFFICIAL_SENTINELS defines the 4 core HIVE sentinels", () => {
  assert.equal(OFFICIAL_SENTINELS.sre.profileName, "site-reliability-engineer");
  assert.equal(OFFICIAL_SENTINELS.qa.profileName, "qa-engineer");
  assert.equal(OFFICIAL_SENTINELS.planner.profileName, "implementation-planner");
  assert.equal(OFFICIAL_SENTINELS.seo.profileName, "seo-specialist");
});

test("healSentinelOrigins identifies matching jobs and returns healed list", async () => {
  const fakeJobs: CronJobLike[] = [
    { id: "dynamic_job_1", profile: "site-reliability-engineer", title: "SRE Health Watchdog" },
    { id: "dynamic_job_2", profile: "qa-engineer", title: "QA Test Runner" },
    { id: "random_job_3", profile: "custom-user-bot", title: "Custom Bot" },
  ];

  const recorded: Array<any> = [];
  const mockRecorder = async (entry: any) => {
    recorded.push(entry);
  };

  const result = await healSentinelOrigins("gw_test_123", fakeJobs, "c_general", mockRecorder);
  assert.equal(result.healedCount, 2);
  assert.equal(recorded.length, 2);
  assert.equal(recorded[0].jobId, "dynamic_job_1");
  assert.equal(
    result.sentinels.some((s) => s.sentinelKey === "sre" && s.jobId === "dynamic_job_1"),
    true,
  );
  assert.equal(
    result.sentinels.some((s) => s.sentinelKey === "qa" && s.jobId === "dynamic_job_2"),
    true,
  );
});
