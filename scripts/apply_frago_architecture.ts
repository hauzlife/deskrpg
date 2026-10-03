import {
  db,
  channels,
  npcs,
  chatRooms,
  chatRoomMembers,
  channelMembers,
  channelGatewayBindings,
  channelKanbanBoards,
  hermesProfiles,
  nowForDb,
} from "@/db";
import { eq } from "drizzle-orm";
import { buildOfficeEnvironment, type OfficeEnvironmentId } from "@/game/three/office-environments";
import { effectiveMapSpawn } from "@/lib/effective-map-spawn";
import { normalizeMeetingMap } from "@/game/meeting-map-normalization";
import { placeUnplacedNpcs } from "@/lib/npc-seating";
import { randomUUID } from "node:crypto";

const OWNER_ID = "18d2b828-f0ea-414b-9222-2ed5001fb774";
const GATEWAY_ID = "03ff0396-a3ad-4c39-af98-9f7b6ed4ed10";

interface ChannelSpec {
  name: string;
  env: OfficeEnvironmentId;
  description: string;
  rooms: { name: string; kind: "office" | "group"; replyPolicy: "mention" | "members" }[];
  souls: string[];
}

const SPEC: ChannelSpec[] = [
  {
    name: "C-Suite",
    env: "executive",
    description: "Capital allocation, strategy, org design",
    rooms: [
      { name: "CFO Suite", kind: "office", replyPolicy: "mention" },
      { name: "Boardroom", kind: "group", replyPolicy: "members" },
    ],
    souls: ["ceo", "cto", "cfo", "coo", "cmo", "clo", "chro", "cpo", "chief-of-staff"],
  },
  {
    name: "Engineering",
    env: "tech",
    description: "Implementation, architecture, quality",
    rooms: [
      { name: "Dev Lab", kind: "office", replyPolicy: "mention" },
      { name: "Meeting Room", kind: "group", replyPolicy: "members" },
    ],
    souls: [
      "backend-engineer",
      "frontend-engineer",
      "platform-engineer",
      "ml-engineer",
      "data-engineer",
      "data-scientist",
      "debugger",
      "data-architect",
      "oss-contributor",
    ],
  },
  {
    name: "Product",
    env: "agency",
    description: "Features, specs, user research, UX",
    rooms: [
      { name: "Product Office", kind: "office", replyPolicy: "mention" },
      { name: "Brainstorm Room", kind: "group", replyPolicy: "members" },
    ],
    souls: [
      "product-manager",
      "ux-designer",
      "researcher",
      "editor",
      "reviewer",
      "spec-driven-development",
    ],
  },
  {
    name: "Operations",
    env: "trading",
    description: "Execution, WIP management, ceremonies",
    rooms: [
      { name: "Ops Control", kind: "office", replyPolicy: "mention" },
      { name: "War Room", kind: "group", replyPolicy: "members" },
    ],
    souls: [
      "qa-engineer",
      "verifier",
      "orchestrator",
      "implementation-planner",
      "chief-of-staff",
      "kanban-strategist",
    ],
  },
  {
    name: "Creative/GTM",
    env: "agency",
    description: "Messaging, docs, go-to-market",
    rooms: [
      { name: "Studio", kind: "office", replyPolicy: "mention" },
      { name: "Campaigns", kind: "group", replyPolicy: "members" },
    ],
    souls: ["brand-designer", "copy-editor", "technical-writer", "seo-specialist", "writer"],
  },
  {
    name: "Infrastructure",
    env: "tech",
    description: "Architecture, reliability, threat modeling",
    rooms: [
      { name: "NOC", kind: "office", replyPolicy: "mention" },
      { name: "Incident Response", kind: "group", replyPolicy: "members" },
    ],
    souls: ["technical-architect", "security-engineer", "site-reliability-engineer"],
  },
  {
    name: "Knowledge",
    env: "publishing",
    description: "Cross-functional research, lateral thinking",
    rooms: [
      { name: "Library", kind: "office", replyPolicy: "mention" },
      { name: "Deep Thought", kind: "group", replyPolicy: "members" },
    ],
    souls: ["curator", "wonderer"],
  },
];

async function run() {
  const allProfiles = await db.select().from(hermesProfiles);
  const profileByName = new Map(allProfiles.map((p) => [p.profileName, p]));

  // Rename "Creative & GTM" to "Creative/GTM" if exists
  await db
    .update(channels)
    .set({ name: "Creative/GTM" })
    .where(eq(channels.name, "Creative & GTM"));

  for (const spec of SPEC) {
    console.log(`\n=== Configuring ${spec.name} ===`);
    const [channel] = await db.select().from(channels).where(eq(channels.name, spec.name)).limit(1);
    if (!channel) {
      console.log(`Channel ${spec.name} not found, skipping`);
      continue;
    }

    // 1. Build authentic 3D Environment Map
    console.log(`Building map environment: ${spec.env}...`);
    const envMap = buildOfficeEnvironment(spec.env);
    const spawn = effectiveMapSpawn(envMap);
    const mapConfig = {
      cols: envMap.width,
      rows: envMap.height,
      spawnCol: spawn ? spawn.col : 10,
      spawnRow: spawn ? spawn.row : 10,
    };
    const effectiveMap = normalizeMeetingMap(envMap, {
      spawnCol: mapConfig.spawnCol,
      spawnRow: mapConfig.spawnRow,
    });

    await db
      .update(channels)
      .set({
        description: spec.description,
        mapData: JSON.stringify(effectiveMap.mapData),
        mapConfig: JSON.stringify(mapConfig),
        updatedAt: nowForDb(),
      })
      .where(eq(channels.id, channel.id));

    // 2. Gateway binding
    const [existingBinding] = await db
      .select()
      .from(channelGatewayBindings)
      .where(eq(channelGatewayBindings.channelId, channel.id))
      .limit(1);
    if (!existingBinding) {
      await db.insert(channelGatewayBindings).values({
        id: randomUUID(),
        channelId: channel.id,
        gatewayId: GATEWAY_ID,
        boundByUserId: OWNER_ID,
        boundAt: nowForDb(),
      });
      console.log(`Bound to gateway`);
    }

    // 3. Kanban board binding
    const [existingBoard] = await db
      .select()
      .from(channelKanbanBoards)
      .where(eq(channelKanbanBoards.channelId, channel.id))
      .limit(1);
    const slug = "deskrpg-" + channel.id.replace(/-/g, "");
    if (!existingBoard) {
      await db.insert(channelKanbanBoards).values({
        id: randomUUID(),
        channelId: channel.id,
        gatewayId: GATEWAY_ID,
        boardSlug: slug,
        isEventCarrier: true,
        createdAt: nowForDb(),
        updatedAt: nowForDb(),
      });
      console.log(`Bound kanban board slug: ${slug}`);
    }

    // 4. Owner membership
    const [existingMember] = await db
      .select()
      .from(channelMembers)
      .where(eq(channelMembers.channelId, channel.id))
      .limit(1);
    if (!existingMember) {
      await db.insert(channelMembers).values({
        id: randomUUID(),
        channelId: channel.id,
        userId: OWNER_ID,
        role: "owner",
        joinedAt: nowForDb(),
      });
    }

    // 5. Rooms
    // Remove existing rooms and rebuild
    await db.delete(chatRooms).where(eq(chatRooms.channelId, channel.id));
    const createdRooms: string[] = [];
    for (const r of spec.rooms) {
      const [room] = await db
        .insert(chatRooms)
        .values({
          id: randomUUID(),
          channelId: channel.id,
          kind: r.kind,
          name: r.name,
          replyPolicy: r.replyPolicy,
          createdBy: OWNER_ID,
          createdAt: nowForDb(),
        })
        .returning();
      createdRooms.push(room.id);
      // add owner
      await db.insert(chatRoomMembers).values({
        roomId: room.id,
        memberKind: "user",
        memberId: OWNER_ID,
        joinedAt: nowForDb(),
      });
    }

    // 6. NPCs Roster for this channel
    await db.delete(npcs).where(eq(npcs.channelId, channel.id));
    const channelNpcIds: string[] = [];
    for (const soul of spec.souls) {
      const prof = profileByName.get(soul);
      if (!prof) {
        console.warn(`Profile ${soul} not found in hermes_profiles`);
        continue;
      }
      const npcId = randomUUID();
      await db.insert(npcs).values({
        id: npcId,
        channelId: channel.id,
        name: prof.displayName || prof.profileName,
        hermesProfileId: prof.id,
        adapterType: "hermes",
        active: true,
        createdAt: nowForDb(),
        updatedAt: nowForDb(),
      });
      channelNpcIds.push(npcId);

      // Add to rooms
      for (const roomId of createdRooms) {
        await db.insert(chatRoomMembers).values({
          roomId,
          memberKind: "npc",
          memberId: npcId,
          joinedAt: nowForDb(),
        });
      }
    }

    // 7. Auto-Seat NPCs at desks / positions in the map!
    console.log(`Auto-seating ${channelNpcIds.length} NPCs in ${spec.name}...`);
    const placement = await placeUnplacedNpcs(channel.id);
    console.log(
      `Placement result: seated=${placement.seated}, standing=${placement.standing}, failed=${placement.failed}`,
    );
  }

  console.log("\n>>> All 7 channels fully configured and seated according to FRAGO specs!");
}

run().catch(console.error);
