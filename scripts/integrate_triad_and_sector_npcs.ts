import { db, channels, npcs, chatRooms, chatRoomMembers, hermesProfiles, nowForDb } from "@/db";
import { eq, and } from "drizzle-orm";
import { placeUnplacedNpcs } from "@/lib/npc-seating";
import { randomUUID } from "node:crypto";

interface AdditionSpec {
  souls: string[];
  rooms: Record<string, string[]>; // roomName -> soul names
}

const ADDITIONS: Record<string, AdditionSpec> = {
  "C-Suite": {
    souls: ["orchestrator", "reviewer", "verifier"],
    rooms: {
      Boardroom: ["orchestrator", "reviewer", "verifier"],
    },
  },
  Engineering: {
    souls: [
      "orchestrator",
      "reviewer",
      "verifier",
      "qa-engineer",
      "implementation-planner",
      "security-engineer",
      "technical-writer",
    ],
    rooms: {
      "Dev Lab": [
        "orchestrator",
        "reviewer",
        "verifier",
        "qa-engineer",
        "implementation-planner",
        "security-engineer",
      ],
      "Meeting Room": ["orchestrator", "technical-writer"],
    },
  },
  Product: {
    souls: [
      "orchestrator",
      "verifier",
      "implementation-planner",
      "technical-writer",
      "technical-architect",
    ],
    rooms: {
      "Product Office": [
        "orchestrator",
        "verifier",
        "implementation-planner",
        "technical-writer",
        "technical-architect",
      ],
      "Brainstorm Room": ["orchestrator"],
    },
  },
  Operations: {
    souls: ["reviewer", "site-reliability-engineer"],
    rooms: {
      "Ops Control": ["reviewer"],
      "War Room": ["reviewer", "site-reliability-engineer"],
    },
  },
  "Creative/GTM": {
    souls: ["orchestrator", "reviewer", "verifier"],
    rooms: {
      Campaigns: ["orchestrator", "reviewer", "verifier"],
      Studio: ["reviewer"],
    },
  },
  Infrastructure: {
    souls: ["orchestrator", "reviewer", "verifier"],
    rooms: {
      "Incident Response": ["orchestrator", "reviewer", "verifier"],
      NOC: ["orchestrator"],
    },
  },
  Knowledge: {
    souls: ["orchestrator", "reviewer", "verifier"],
    rooms: {
      "Deep Thought": ["orchestrator", "reviewer", "verifier"],
    },
  },
};

async function main() {
  console.log("=== Integrating Triad & Sector NPCs into DeskRPG Channels ===\n");

  const allProfiles = await db.select().from(hermesProfiles);
  const profileByName = new Map(allProfiles.map((p) => [p.profileName, p]));

  const allChannels = await db.select().from(channels);
  const channelByName = new Map(allChannels.map((c) => [c.name, c]));

  let totalNpcsCreated = 0;
  let totalRoomMembersCreated = 0;

  for (const [channelName, spec] of Object.entries(ADDITIONS)) {
    const channel = channelByName.get(channelName);
    if (!channel) {
      console.warn(`Channel "${channelName}" not found, skipping.`);
      continue;
    }

    console.log(`Processing Channel: ${channelName} (${channel.id})`);

    // Fetch existing rooms for this channel
    const channelRooms = await db
      .select()
      .from(chatRooms)
      .where(eq(chatRooms.channelId, channel.id));
    const officeRoom = channelRooms.find((r) => r.kind === "office");
    const roomByName = new Map(channelRooms.map((r) => [r.name, r]));

    // Fetch existing NPCs for this channel
    const existingNpcs = await db.select().from(npcs).where(eq(npcs.channelId, channel.id));
    const existingProfileIds = new Set(existingNpcs.map((n) => n.hermesProfileId));
    const npcIdByProfile = new Map<string, string>();

    for (const n of existingNpcs) {
      const prof = allProfiles.find((p) => p.id === n.hermesProfileId);
      if (prof) {
        npcIdByProfile.set(prof.profileName, n.id);
      }
    }

    // 1. Create missing NPCs
    for (const soul of spec.souls) {
      const profile = profileByName.get(soul);
      if (!profile) {
        console.warn(`  [!] Profile "${soul}" not found in hermes_profiles`);
        continue;
      }

      let npcId = npcIdByProfile.get(soul);

      if (!existingProfileIds.has(profile.id)) {
        npcId = randomUUID();
        await db.insert(npcs).values({
          id: npcId,
          channelId: channel.id,
          name: profile.displayName || profile.profileName,
          hermesProfileId: profile.id,
          adapterType: "hermes",
          active: true,
          createdAt: nowForDb(),
          updatedAt: nowForDb(),
        });
        existingProfileIds.add(profile.id);
        npcIdByProfile.set(soul, npcId);
        totalNpcsCreated++;
        console.log(`  + Created NPC: ${soul} (${npcId})`);
      } else {
        console.log(`  . NPC already present: ${soul} (${npcId})`);
      }

      // Add to Whole Office room (broadcast room)
      if (officeRoom && npcId) {
        const [existing] = await db
          .select()
          .from(chatRoomMembers)
          .where(
            and(
              eq(chatRoomMembers.roomId, officeRoom.id),
              eq(chatRoomMembers.memberKind, "npc"),
              eq(chatRoomMembers.memberId, npcId),
            ),
          )
          .limit(1);

        if (!existing) {
          await db.insert(chatRoomMembers).values({
            roomId: officeRoom.id,
            memberKind: "npc",
            memberId: npcId,
            joinedAt: nowForDb(),
          });
          totalRoomMembersCreated++;
        }
      }
    }

    // 2. Add to specialized group rooms
    for (const [roomName, souls] of Object.entries(spec.rooms)) {
      const targetRoom = roomByName.get(roomName);
      if (!targetRoom) {
        console.warn(`  [!] Room "${roomName}" not found in channel "${channelName}"`);
        continue;
      }

      for (const soul of souls) {
        const npcId = npcIdByProfile.get(soul);
        if (!npcId) continue;

        const [existing] = await db
          .select()
          .from(chatRoomMembers)
          .where(
            and(
              eq(chatRoomMembers.roomId, targetRoom.id),
              eq(chatRoomMembers.memberKind, "npc"),
              eq(chatRoomMembers.memberId, npcId),
            ),
          )
          .limit(1);

        if (!existing) {
          await db.insert(chatRoomMembers).values({
            roomId: targetRoom.id,
            memberKind: "npc",
            memberId: npcId,
            joinedAt: nowForDb(),
          });
          totalRoomMembersCreated++;
          console.log(`    -> Joined room "${roomName}": ${soul}`);
        }
      }
    }

    // 3. Auto-seat all NPCs in the channel
    console.log(`  * Seating unplaced NPCs in ${channelName}...`);
    const seatResult = await placeUnplacedNpcs(channel.id);
    console.log(
      `    Seating result: seated=${seatResult.seated}, standing=${seatResult.standing}, failed=${seatResult.failed}\n`,
    );
  }

  console.log(
    `\n>>> Done! Created ${totalNpcsCreated} new NPCs and ${totalRoomMembersCreated} room memberships.`,
  );
}

main().catch((err) => {
  console.error("Fatal error during NPC integration:", err);
  process.exit(1);
});
