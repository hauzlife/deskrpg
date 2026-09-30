// src/lib/adapters/hermes-adapter.ts
// NpcAdapter over a profile-scoped HermesClient.
// Two call paths: persisted session chat (1:1) and runs + history (multi-party).
// The client is injected — this adapter knows nothing about the DB or profile
// resolution (that's getProfileClientForNpc's job), which keeps it testable
// with no gateway and no database.

import { HermesClient } from "@/lib/hermes/hermes-client";
import type { SseEvent } from "@/lib/hermes/sse";
import { parseApprovalEvent } from "@/lib/tool-approval-event";
import { startNpcTrace } from "@/lib/observability/langfuse";
import type {
  AdapterExecuteOptions,
  AdapterHealthResult,
  AdapterSessionInfo,
  NpcAdapter,
} from "./types";

export class HermesAdapter implements NpcAdapter {
  readonly type = "hermes";

  private readonly client: HermesClient;
  private sessionId: string | null;
  private lastRunId: string | null = null;

  constructor(client: HermesClient, opts?: { sessionId?: string }) {
    this.client = client;
    this.sessionId = opts?.sessionId ?? null;
  }

  private relay(options: AdapterExecuteOptions, trace?: ReturnType<typeof startNpcTrace>) {
    return (event: SseEvent) => {
      if (typeof event.data.run_id === "string" && event.data.run_id !== this.lastRunId) {
        this.lastRunId = event.data.run_id;
        options.onRunStarted?.(event.data.run_id);
      }
      if (
        (event.event === "assistant.delta" || event.event === "message.delta") &&
        typeof event.data.delta === "string"
      ) {
        options.onDelta?.(event.data.delta);
      }
      if (event.event === "approval.request") {
        const parsed = parseApprovalEvent(event.data);
        if (parsed) options.onApprovalRequest?.(parsed);
      }
      if (event.event === "tool.started" || event.event === "tool.progress") {
        const name = typeof event.data.tool_name === "string" ? event.data.tool_name : "";
        options.onToolProgress?.(name, "");
        if (event.event === "tool.started") {
          trace?.onToolCall(name, event.data.tool_input);
        }
      }
      if (event.event === "tool.completed") {
        const name = typeof event.data.tool_name === "string" ? event.data.tool_name : "";
        trace?.onToolComplete(name, event.data.tool_output);
      }
    };
  }

  async execute(options: AdapterExecuteOptions): Promise<{
    response: string;
    session: AdapterSessionInfo;
  }> {
    const trace = startNpcTrace({
      name: options.sessionKey ?? "hermes-turn",
      sessionId: options.sessionKey,
      multiParty: options.multiParty,
      prompt: options.prompt,
      instructions: options.instructions,
    });
    const onEvent = this.relay(options, trace);

    try {
      if (options.multiParty) {
        const { runId } = await this.client.startRun({
          input: options.prompt,
          conversationHistory: options.conversationHistory ?? [],
          instructions: options.instructions,
          sessionKey: options.sessionKey,
        });
        this.lastRunId = runId;
        options.onRunStarted?.(runId);

        const { text } = await this.client.streamRunEvents(runId, onEvent);
        trace.finalize(text, { runId });
        return { response: text, session: { sessionRef: options.sessionKey, displayId: runId } };
      }

      if (!this.sessionId) {
        const created = await this.client.createSession(options.sessionKey);
        this.sessionId = created.sessionId;
      }

      const result = await this.client.streamSessionChat({
        sessionId: this.sessionId,
        message: options.prompt,
        systemMessage: options.instructions,
        sessionKey: options.sessionKey,
        onEvent,
      });
      this.sessionId = result.sessionId;
      this.lastRunId = result.runId;

      trace.finalize(result.text, { sessionId: result.sessionId, runId: result.runId });
      return { response: result.text, session: { sessionRef: result.sessionId } };
    } catch (err) {
      trace.fail(err);
      throw err;
    }
  }

  async abort(_sessionKey: string): Promise<void> {
    if (!this.lastRunId) return;
    await this.client.stopRun(this.lastRunId);
  }

  async steer(text: string): Promise<void> {
    if (!this.lastRunId) return;
    await this.client.steerRun(this.lastRunId, text);
  }

  async testConnection(_config: Record<string, unknown>): Promise<AdapterHealthResult> {
    try {
      await this.client.getCapabilities();
      return { status: "ok" };
    } catch (err) {
      return { status: "error", message: err instanceof Error ? err.message : "unknown" };
    }
  }
}
