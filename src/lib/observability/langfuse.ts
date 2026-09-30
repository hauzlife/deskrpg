/**
 * Langfuse Observability Integration for DeskRPG (TypeScript SDK)
 *
 * Implements tracing best practices following the official Langfuse AI Skill:
 * - Fail-open design: does not block or throw if credentials are not configured
 * - Captures meaningful inputs/outputs (excluding sensitive tokens/keys)
 * - Session grouping: groups turns under session_id for multi-turn conversation tracing
 * - Tags: categorizes by role, interaction kind ('1:1' vs 'meeting'), and DeskRPG context
 * - Observes tool calls and model responses with proper span hierarchy
 */

import { Langfuse } from 'langfuse';

let langfuseInstance: Langfuse | null = null;
let initialized = false;

export function getLangfuseConfig(): {
  publicKey?: string;
  secretKey?: string;
  baseUrl?: string;
  enabled: boolean;
} {
  const publicKey =
    process.env.LANGFUSE_PUBLIC_KEY ||
    process.env.HERMES_LANGFUSE_PUBLIC_KEY ||
    process.env.NEXT_PUBLIC_LANGFUSE_PUBLIC_KEY;

  const secretKey =
    process.env.LANGFUSE_SECRET_KEY ||
    process.env.HERMES_LANGFUSE_SECRET_KEY;

  const baseUrl =
    process.env.LANGFUSE_BASE_URL ||
    process.env.LANGFUSE_HOST ||
    process.env.HERMES_LANGFUSE_BASE_URL ||
    'https://cloud.langfuse.com';

  const enabled = Boolean(publicKey && secretKey);

  return { publicKey, secretKey, baseUrl, enabled };
}

export function getLangfuseClient(): Langfuse | null {
  if (initialized) {
    return langfuseInstance;
  }

  const { publicKey, secretKey, baseUrl, enabled } = getLangfuseConfig();

  if (!enabled || !publicKey || !secretKey) {
    initialized = true;
    langfuseInstance = null;
    return null;
  }

  try {
    langfuseInstance = new Langfuse({
      publicKey,
      secretKey,
      baseUrl,
      flushAt: 1, // Flush actively in serverless/Node environments
      flushInterval: 2000,
    });
    console.log(`[langfuse] Observability client initialized connected to ${baseUrl}`);
  } catch (err) {
    console.warn('[langfuse] Failed to initialize client:', err);
    langfuseInstance = null;
  }

  initialized = true;
  return langfuseInstance;
}

export interface NpcTraceContext {
  traceId?: string;
  name: string;
  sessionId?: string;
  userId?: string;
  npcName?: string;
  role?: string;
  multiParty?: boolean;
  prompt: string;
  instructions?: string;
  metadata?: Record<string, unknown>;
  tags?: string[];
}

export interface ActiveNpcTrace {
  onToolCall: (toolName: string, input?: unknown) => void;
  onToolComplete: (toolName: string, output?: unknown) => void;
  finalize: (response: string, metadata?: Record<string, unknown>) => void;
  fail: (error: unknown) => void;
}

/**
 * Starts a Langfuse trace for an NPC conversation turn or meeting.
 * Returns an ActiveNpcTrace interface to track lifecycle and tool calls.
 * Fails open (no-op) if Langfuse is not enabled.
 */
export function startNpcTrace(ctx: NpcTraceContext): ActiveNpcTrace {
  const client = getLangfuseClient();

  if (!client) {
    return {
      onToolCall: () => {},
      onToolComplete: () => {},
      finalize: () => {},
      fail: () => {},
    };
  }

  try {
    const traceName = ctx.multiParty ? `meeting-turn: ${ctx.name}` : `npc-chat: ${ctx.name}`;
    const tags = ['deskrpg', ctx.multiParty ? 'meeting' : '1:1', ...(ctx.tags ?? [])];
    if (ctx.npcName) tags.push(ctx.npcName);
    if (ctx.role) tags.push(ctx.role);

    const trace = client.trace({
      id: ctx.traceId,
      name: traceName,
      sessionId: ctx.sessionId ?? null,
      userId: ctx.userId ?? null,
      input: {
        prompt: ctx.prompt,
        instructions: ctx.instructions,
      },
      metadata: {
        ...ctx.metadata,
        npcName: ctx.npcName,
        role: ctx.role,
        multiParty: ctx.multiParty,
      },
      tags,
    });

    const generation = trace.generation({
      name: `generation: ${ctx.name}`,
      input: ctx.prompt,
      modelParameters: ctx.instructions ? { instructions: ctx.instructions } : undefined,
    });

    const activeToolSpans = new Map<string, any>();

    return {
      onToolCall: (toolName: string, input?: unknown) => {
        try {
          if (!toolName) return;
          const span = trace.span({
            name: `tool: ${toolName}`,
            input: input ?? { invoked: true },
          });
          activeToolSpans.set(toolName, span);
        } catch {
          // ignore observation errors
        }
      },
      onToolComplete: (toolName: string, output?: unknown) => {
        try {
          const span = activeToolSpans.get(toolName);
          if (span) {
            span.end({
              output: output ?? { success: true },
            });
            activeToolSpans.delete(toolName);
          }
        } catch {
          // ignore
        }
      },
      finalize: (response: string, metadata?: Record<string, unknown>) => {
        try {
          generation.end({
            output: response,
            metadata,
          });
          trace.update({
            output: response,
          });
          // Non-blocking flush
          void client.flushAsync().catch(() => {});
        } catch {
          // ignore
        }
      },
      fail: (error: unknown) => {
        try {
          const errMsg = error instanceof Error ? error.message : String(error);
          generation.end({
            level: 'ERROR',
            statusMessage: errMsg,
          });
          trace.update({
            metadata: {
              error: errMsg,
            },
          });
          void client.flushAsync().catch(() => {});
        } catch {
          // ignore
        }
      },
    };
  } catch (err) {
    console.warn('[langfuse] Error creating trace:', err);
    return {
      onToolCall: () => {},
      onToolComplete: () => {},
      finalize: () => {},
      fail: () => {},
    };
  }
}
