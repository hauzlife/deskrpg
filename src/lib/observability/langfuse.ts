/**
 * Langfuse Observability Integration for DeskRPG (v4 / JS/TS SDK v5)
 *
 * Implements tracing best practices following the official Langfuse v4 specifications:
 * - Observations-first data model: correlating attributes (userId, sessionId, tags, metadata)
 *   are propagated to root and all child observations via propagateAttributes scope.
 * - Root observation captures overall turn input and output.
 * - Standard OpenTelemetry NodeSDK setup with LangfuseSpanProcessor.
 * - Score recording via @langfuse/client LangfuseClient score manager.
 * - Fail-open design: does not block or throw if credentials are not configured.
 */

import { NodeSDK } from '@opentelemetry/sdk-node';
import { LangfuseSpanProcessor } from '@langfuse/otel';
import {
  startObservation,
  propagateAttributes,
  type LangfuseSpan,
} from '@langfuse/tracing';
import { LangfuseClient } from '@langfuse/client';

let otelSdk: NodeSDK | null = null;
let langfuseClient: LangfuseClient | null = null;
let initialized = false;

export function _resetLangfuseStateForTesting(): void {
  initialized = false;
  langfuseClient = null;
  otelSdk = null;
}

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

export function initLangfuse(): boolean {
  if (initialized) {
    return Boolean(langfuseClient);
  }

  const { publicKey, secretKey, baseUrl, enabled } = getLangfuseConfig();

  if (!enabled || !publicKey || !secretKey) {
    initialized = true;
    otelSdk = null;
    langfuseClient = null;
    return false;
  }

  try {
    const spanProcessor = new LangfuseSpanProcessor({
      publicKey,
      secretKey,
      baseUrl,
    });

    otelSdk = new NodeSDK({
      spanProcessors: [spanProcessor],
    });
    otelSdk.start();

    langfuseClient = new LangfuseClient({
      publicKey,
      secretKey,
      baseUrl,
    });

    console.log(`[langfuse] v4 Observability client initialized connected to ${baseUrl}`);
  } catch (err) {
    console.warn('[langfuse] Failed to initialize v4 client:', err);
    otelSdk = null;
    langfuseClient = null;
  }

  initialized = true;
  return Boolean(langfuseClient);
}

export function getLangfuseClient(): LangfuseClient | null {
  if (!initialized) {
    initLangfuse();
  }
  return langfuseClient;
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
  conversationHistory?: Array<unknown>;
  metadata?: Record<string, unknown>;
  tags?: string[];
}

export interface ActiveNpcTrace {
  traceId?: string;
  onToolCall: (toolName: string, input?: unknown) => void;
  onToolComplete: (toolName: string, output?: unknown) => void;
  finalize: (response: string, metadata?: Record<string, unknown>) => void;
  fail: (error: unknown) => void;
}

/**
 * Starts a Langfuse v4 observation hierarchy for an NPC conversation turn or meeting.
 * Uses propagateAttributes to enforce the observations-first model where sessionId,
 * userId, tags, and metadata live on all child observations (including cost-bearing generations).
 * Fails open (no-op) if Langfuse is not enabled.
 */
export function startNpcTrace(ctx: NpcTraceContext): ActiveNpcTrace {
  const isReady = initLangfuse();

  if (!isReady || !langfuseClient) {
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

    // Convert metadata values to strings for propagateAttributes compliance
    const stringMetadata: Record<string, string> = {};
    if (ctx.metadata) {
      for (const [key, val] of Object.entries(ctx.metadata)) {
        if (val !== undefined && val !== null) {
          stringMetadata[key] = typeof val === 'string' ? val : JSON.stringify(val);
        }
      }
    }
    if (ctx.npcName) stringMetadata.npcName = ctx.npcName;
    if (ctx.role) stringMetadata.role = ctx.role;
    if (ctx.multiParty !== undefined) stringMetadata.multiParty = String(ctx.multiParty);

    let rootSpan: LangfuseSpan | null = null;
    let generationSpan: LangfuseSpan | null = null;

    propagateAttributes(
      {
        traceName,
        sessionId: ctx.sessionId,
        userId: ctx.userId,
        tags,
        metadata: stringMetadata,
      },
      () => {
        // Root observation captures overall turn input
        rootSpan = startObservation(traceName, {
          input: {
            prompt: ctx.prompt,
            instructions: ctx.instructions,
            conversationHistory: ctx.conversationHistory,
          },
        });

        // Generation child observation captures model prompt and parameters
        if (rootSpan) {
          generationSpan = (rootSpan as LangfuseSpan).startObservation(
            `generation: ${ctx.name}`,
            {
              input: {
                prompt: ctx.prompt,
                conversationHistory: ctx.conversationHistory,
              },
              modelParameters: ctx.instructions ? { instructions: ctx.instructions } : undefined,
            },
            { asType: 'generation' }
          );
        }
      }
    );

    const activeToolSpans = new Map<string, LangfuseSpan>();
    const capturedRootSpan = rootSpan as LangfuseSpan | null;
    const capturedGenSpan = generationSpan as LangfuseSpan | null;
    const traceId = capturedRootSpan?.traceId;

    return {
      traceId,
      onToolCall: (toolName: string, input?: unknown) => {
        try {
          if (!toolName || !capturedRootSpan) return;
          const span = capturedRootSpan.startObservation(
            `tool: ${toolName}`,
            {
              input: input ?? { invoked: true },
            },
            { asType: 'tool' }
          );
          activeToolSpans.set(toolName, span);
        } catch {
          // ignore observation errors
        }
      },
      onToolComplete: (toolName: string, output?: unknown) => {
        try {
          const span = activeToolSpans.get(toolName);
          if (span) {
            span.update({
              output: output ?? { success: true },
            });
            span.end();
            activeToolSpans.delete(toolName);
          }
        } catch {
          // ignore
        }
      },
      finalize: (response: string, metadata?: Record<string, unknown>) => {
        try {
          if (capturedGenSpan) {
            capturedGenSpan.update({
              output: response,
              metadata,
            });
            capturedGenSpan.end();
          }

          if (capturedRootSpan) {
            capturedRootSpan.update({
              output: response,
            });
            capturedRootSpan.end();
          }

          // Automated Online Evaluators (Scores recorded via LangfuseClient)
          if (traceId && langfuseClient) {
            // 1. task_success = 1
            langfuseClient.score.create({
              traceId,
              name: 'task_success',
              value: 1,
              comment: 'Turn finalized with response',
            });

            // 2. instruction_following (heuristic evaluation)
            const hasErrorIndicators = /error|fatal|exception|traceback|cannot connect/i.test(response);
            const adherenceScore = hasErrorIndicators ? 0.3 : 1.0;
            langfuseClient.score.create({
              traceId,
              name: 'instruction_following',
              value: adherenceScore,
              comment: hasErrorIndicators ? 'Response contains error indicators' : 'Clean output',
            });

            // 3. hallucination (heuristic check against fabricated output tokens)
            const hasFabrication = /\[FABRICATED\]|<invented>/i.test(response);
            langfuseClient.score.create({
              traceId,
              name: 'hallucination',
              value: hasFabrication ? 1 : 0,
              comment: hasFabrication ? 'Fabrication markers detected' : 'Clean response',
            });

            void langfuseClient.flush().catch(() => {});
          }
        } catch {
          // ignore
        }
      },
      fail: (error: unknown) => {
        try {
          const errMsg = error instanceof Error ? error.message : String(error);
          if (capturedGenSpan) {
            capturedGenSpan.update({
              level: 'ERROR',
              statusMessage: errMsg,
            });
            capturedGenSpan.end();
          }

          if (capturedRootSpan) {
            capturedRootSpan.update({
              level: 'ERROR',
              statusMessage: errMsg,
              metadata: {
                error: errMsg,
              },
            });
            capturedRootSpan.end();
          }

          // Automated Score on failure: task_success = 0
          if (traceId && langfuseClient) {
            langfuseClient.score.create({
              traceId,
              name: 'task_success',
              value: 0,
              comment: `Turn failed: ${errMsg}`,
            });

            void langfuseClient.flush().catch(() => {});
          }
        } catch {
          // ignore
        }
      },
    };
  } catch (err) {
    console.warn('[langfuse] Error creating v4 trace observations:', err);
    return {
      onToolCall: () => {},
      onToolComplete: () => {},
      finalize: () => {},
      fail: () => {},
    };
  }
}

/**
 * Programmatically records an evaluation score to a Langfuse trace / observation
 */
export function recordScore(args: {
  traceId: string;
  observationId?: string;
  name: 'task_success' | 'instruction_following' | 'relevance' | 'hallucination' | 'user_feedback';
  value: number | string;
  comment?: string;
}): boolean {
  const client = getLangfuseClient();
  if (!client) return false;
  try {
    client.score.create({
      traceId: args.traceId,
      observationId: args.observationId,
      name: args.name,
      value: args.value as any,
      comment: args.comment,
    });
    void client.flush().catch(() => {});
    return true;
  } catch (err) {
    console.warn('[langfuse] Failed to record score:', err);
    return false;
  }
}
