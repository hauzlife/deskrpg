"use client";

import { useEffect, useMemo, useState } from "react";
import { Clock, RefreshCw, ShieldAlert, Wifi, WifiOff } from "lucide-react";

import { useT } from "@/lib/i18n";
import type { ToolApprovalChoice } from "@/lib/tool-approval-types";
import type { WorkspaceChannel } from "@/components/workspace/use-workspace-channels";
import { ToolApprovalsProvider, useSharedToolApprovals } from "./ToolApprovalsProvider";
import { ToolApprovalCard } from "./ToolApprovalCard";
import { useHermesApprovalSocket } from "./use-hermes-approval-socket";

type Props = { channels: WorkspaceChannel[] };
type Filter = "all" | "pending" | "dm" | "meeting" | "room";

type RosterResponse = {
  npcs?: Array<{ id?: unknown; name?: unknown }>;
};

function channelLabel(channels: WorkspaceChannel[], channelId: string): string {
  return channels.find((channel) => channel.id === channelId)?.name ?? channelId;
}

function useNpcNames(channels: WorkspaceChannel[]): Record<string, string> {
  const channelKey = channels.map((channel) => channel.id).join(",");
  const [names, setNames] = useState<Record<string, string>>({});

  useEffect(() => {
    let alive = true;
    const channelIds = channelKey ? channelKey.split(",").filter(Boolean) : [];
    if (channelIds.length === 0) {
      setNames({});
      return () => {
        alive = false;
      };
    }

    Promise.all(
      channelIds.map(async (channelId) => {
        try {
          const response = await fetch(
            `/api/npcs?channelId=${encodeURIComponent(channelId)}&roster=1`,
          );
          if (!response.ok) return [];
          const data = (await response.json()) as RosterResponse;
          return (data.npcs ?? []).flatMap((npc) =>
            typeof npc.id === "string" && typeof npc.name === "string"
              ? [[npc.id, npc.name] as const]
              : [],
          );
        } catch {
          return [];
        }
      }),
    ).then((results) => {
      if (!alive) return;
      setNames(Object.fromEntries(results.flat()));
    });

    return () => {
      alive = false;
    };
  }, [channelKey]);

  return names;
}

/**
 * Global approval inbox for the live Hermes ecosystem.
 *
 * This is deliberately separate from the legacy SQLite card-approval panel. Hermes tool
 * approvals are short-lived, process-local requests delivered over Socket.IO, so a REST list of
 * blocked cards cannot represent them and cannot safely decide them. All contexts (DM, meeting,
 * and room) are collected here, while the existing card component keeps the exact same approval
 * choices and server-side authorization check used in the game.
 */
export default function HermesApprovalsInbox({ channels }: Props) {
  const { socket, connected, reconnect } = useHermesApprovalSocket();
  return (
    <ToolApprovalsProvider socket={socket}>
      <HermesApprovalsView channels={channels} connected={connected} onReconnect={reconnect} />
    </ToolApprovalsProvider>
  );
}

function HermesApprovalsView({
  channels,
  connected,
  onReconnect,
}: Props & { connected: boolean; onReconnect: () => void }) {
  const t = useT();
  const shared = useSharedToolApprovals();
  const npcNames = useNpcNames(channels);
  const [filter, setFilter] = useState<Filter>("all");
  const cards = shared?.cards ?? [];
  const waiting = shared?.waiting ?? [];
  const visibleCards = useMemo(
    () =>
      cards.filter(({ request, status }) => {
        if (filter === "pending") return status === "pending";
        if (filter === "all") return true;
        return request.context === filter;
      }),
    [cards, filter],
  );
  const pendingCount = cards.filter((card) => card.status === "pending").length;

  return (
    <div className="theme-web workspace-page flex min-h-[calc(100vh-2rem)] flex-col p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <ShieldAlert className="text-primary" size={22} />
            <h1 className="text-2xl font-bold text-text">{t("nav.approvals") || "Approvals"}</h1>
          </div>
          <p className="mt-1 text-sm text-text-muted">
            Live approvals from every Hermes profile, DM, meeting, and room.
          </p>
        </div>
        <div className="flex items-center gap-2 text-xs">
          <span
            className={`flex items-center gap-1.5 ${connected ? "text-success" : "text-danger"}`}
          >
            {connected ? <Wifi size={14} /> : <WifiOff size={14} />}
            {connected ? "Hermes realtime connected" : "Hermes realtime disconnected"}
          </span>
          <button
            type="button"
            onClick={onReconnect}
            title={t("common.refresh") || "Refresh"}
            className="rounded-md border border-border p-1.5 text-text-secondary hover:bg-surface-raised"
          >
            <RefreshCw size={14} />
          </button>
        </div>
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-2 text-xs">
        {(
          [
            ["all", "All"],
            ["pending", `Pending${pendingCount ? ` (${pendingCount})` : ""}`],
            ["dm", "DM"],
            ["meeting", "Meetings"],
            ["room", "Rooms"],
          ] as const
        ).map(([value, label]) => (
          <button
            key={value}
            type="button"
            onClick={() => setFilter(value)}
            className={`rounded-md px-3 py-1.5 font-medium ${
              filter === value
                ? "bg-primary text-white"
                : "border border-border text-text-muted hover:bg-surface-raised hover:text-text"
            }`}
          >
            {label}
          </button>
        ))}
        <span className="ml-auto text-text-dim">{channels.length} Hermes offices connected</span>
      </div>

      <div className="flex-1 rounded-xl border border-border bg-surface p-4 shadow-sm">
        {!connected && (
          <div className="mb-4 rounded-lg border border-danger/30 bg-danger/10 p-3 text-sm text-danger">
            The realtime connection is offline. Pending Hermes requests will appear automatically
            after reconnecting.
          </div>
        )}

        {visibleCards.length === 0 && waiting.length === 0 ? (
          <div className="flex min-h-[360px] flex-col items-center justify-center text-center text-sm text-text-muted">
            <Clock className="mb-3 text-text-dim" size={34} />
            <p>
              {pendingCount > 0
                ? "No approvals match this filter."
                : "No live Hermes approvals waiting."}
            </p>
            <p className="mt-1 text-xs text-text-dim">
              When an agent reaches a protected command or MCP write, it will appear here.
            </p>
          </div>
        ) : (
          <div className="grid gap-3 lg:grid-cols-2">
            {visibleCards.map((card) => (
              <section
                key={card.request.key}
                className="rounded-lg border border-border/70 bg-bg/40 p-2"
              >
                <div className="mb-2 flex flex-wrap items-center justify-between gap-2 px-1 text-[11px] text-text-dim">
                  <span>{channelLabel(channels, card.request.channelId)}</span>
                  <span className="uppercase tracking-wider">{card.request.context}</span>
                </div>
                <ToolApprovalCard
                  card={card}
                  npcName={npcNames[card.request.npcId] ?? card.request.npcId}
                  onDecide={(choice: ToolApprovalChoice) =>
                    shared?.decide(card.request.key, choice)
                  }
                />
              </section>
            ))}
            {waiting.length > 0 && (
              <section className="rounded-lg border border-border/70 bg-bg/40 p-3 text-xs text-text-muted">
                <h2 className="mb-2 font-semibold text-text">Other Hermes participants waiting</h2>
                <div className="space-y-2">
                  {waiting.map((line) => (
                    <p key={line.key} className="flex items-center gap-2">
                      <Clock size={13} />
                      {npcNames[line.npcId] ?? line.npcId} is waiting for {line.approverName}&apos;s
                      decision.
                    </p>
                  ))}
                </div>
              </section>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
