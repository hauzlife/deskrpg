/**
 * Cron Sentinel Dynamic Auto-Discovery & Self-Healing (HIVE — DeskRPG + Hermes)
 *
 * Resolves the 4 official autonomous sentinels dynamically by profile name and role,
 * replacing static hexadecimal job IDs (e.g. 0b680dab507a) with self-healing discovery.
 */

import { recordCronOrigin } from "./cron-origins";

export interface SentinelDefinition {
  profileName: string;
  role: string;
  defaultChannelId: string;
  frequencyHint: string;
}

export const OFFICIAL_SENTINELS: Record<string, SentinelDefinition> = {
  sre: {
    profileName: "site-reliability-engineer",
    role: "SRE Infrastructure Watchdog",
    defaultChannelId: "c_infra",
    frequencyHint: "1h",
  },
  qa: {
    profileName: "qa-engineer",
    role: "QA Test Suite Watchdog",
    defaultChannelId: "c_operations",
    frequencyHint: "2h",
  },
  planner: {
    profileName: "implementation-planner",
    role: "Backlog Starvation Sentinel",
    defaultChannelId: "c_operations",
    frequencyHint: "6h",
  },
  seo: {
    profileName: "seo-specialist",
    role: "GTM / Funnel Sentinel",
    defaultChannelId: "c_creative",
    frequencyHint: "12h",
  },
} as const;

export interface CronJobLike {
  id: string;
  profile: string;
  schedule?: string;
  title?: string;
  active?: boolean;
}

export interface SentinelHealingResult {
  healedCount: number;
  sentinels: Array<{
    sentinelKey: string;
    profileName: string;
    jobId: string;
    channelId: string;
  }>;
}

export type OriginRecorderFn = (input: {
  gatewayId: string;
  profileName: string;
  jobId: string;
  channelId: string;
  createdByUserId: string | null;
}) => Promise<unknown>;

/**
 * Scans a list of Hermes cron jobs, identifies jobs corresponding to official sentinels,
 * and records or updates their origin in `cron_job_origins`.
 */
export async function healSentinelOrigins(
  gatewayId: string,
  cronJobs: readonly CronJobLike[],
  fallbackChannelId = "c_general",
  recorder: OriginRecorderFn = recordCronOrigin,
): Promise<SentinelHealingResult> {
  const result: SentinelHealingResult = {
    healedCount: 0,
    sentinels: [],
  };

  const sentinelEntries = Object.entries(OFFICIAL_SENTINELS);

  for (const [key, sentinel] of sentinelEntries) {
    // Find matching job by profile name
    const matchingJob = cronJobs.find(
      (job) => job.profile.toLowerCase() === sentinel.profileName.toLowerCase(),
    );

    if (matchingJob) {
      try {
        await recorder({
          gatewayId,
          profileName: matchingJob.profile,
          jobId: matchingJob.id,
          channelId: sentinel.defaultChannelId || fallbackChannelId,
          createdByUserId: null,
        });

        result.healedCount++;
        result.sentinels.push({
          sentinelKey: key,
          profileName: matchingJob.profile,
          jobId: matchingJob.id,
          channelId: sentinel.defaultChannelId || fallbackChannelId,
        });

        console.log(
          `[sentinel-discovery] Healed sentinel origin for ${sentinel.profileName} -> jobId: ${matchingJob.id} on ${gatewayId}`,
        );
      } catch (err) {
        console.warn(
          `[sentinel-discovery] Failed to record sentinel origin for ${sentinel.profileName}:`,
          err,
        );
      }
    }
  }

  return result;
}
