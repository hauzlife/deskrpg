import assert from 'node:assert/strict';
import test from 'node:test';
import {
  getLangfuseConfig,
  startNpcTrace,
  recordScore,
  _resetLangfuseStateForTesting,
} from './langfuse';

test('getLangfuseConfig returns false when keys are not set', () => {
  const origPub = process.env.LANGFUSE_PUBLIC_KEY;
  const origSec = process.env.LANGFUSE_SECRET_KEY;
  delete process.env.LANGFUSE_PUBLIC_KEY;
  delete process.env.LANGFUSE_SECRET_KEY;
  delete process.env.HERMES_LANGFUSE_PUBLIC_KEY;
  delete process.env.HERMES_LANGFUSE_SECRET_KEY;
  _resetLangfuseStateForTesting();

  const config = getLangfuseConfig();
  assert.equal(config.enabled, false);

  if (origPub) process.env.LANGFUSE_PUBLIC_KEY = origPub;
  if (origSec) process.env.LANGFUSE_SECRET_KEY = origSec;
  _resetLangfuseStateForTesting();
});

test('startNpcTrace fails open gracefully when Langfuse is not enabled', () => {
  const origPub = process.env.LANGFUSE_PUBLIC_KEY;
  const origSec = process.env.LANGFUSE_SECRET_KEY;
  delete process.env.LANGFUSE_PUBLIC_KEY;
  delete process.env.LANGFUSE_SECRET_KEY;
  delete process.env.HERMES_LANGFUSE_PUBLIC_KEY;
  delete process.env.HERMES_LANGFUSE_SECRET_KEY;
  _resetLangfuseStateForTesting();

  const trace = startNpcTrace({
    name: 'test-turn',
    prompt: 'Hello NPC',
  });

  assert.equal(trace.traceId, undefined);

  // Does not throw and returns valid callable handles
  assert.doesNotThrow(() => {
    trace.onToolCall('test_tool', { query: 'test' });
    trace.onToolComplete('test_tool', { result: 'ok' });
    trace.finalize('Hello user!');
    trace.fail(new Error('test failure'));
  });

  const scored = recordScore({
    traceId: 'mock-trace-id',
    name: 'task_success',
    value: 1,
  });
  assert.equal(scored, false);

  if (origPub) process.env.LANGFUSE_PUBLIC_KEY = origPub;
  if (origSec) process.env.LANGFUSE_SECRET_KEY = origSec;
  _resetLangfuseStateForTesting();
});

test('startNpcTrace creates observation hierarchy and sets traceId when configured', () => {
  process.env.LANGFUSE_PUBLIC_KEY = 'pk-lf-test';
  process.env.LANGFUSE_SECRET_KEY = 'sk-lf-test';
  _resetLangfuseStateForTesting();
  const trace = startNpcTrace({
    name: 'active-turn',
    sessionId: 'session-unit-test-123',
    userId: 'user-unit-test-456',
    npcName: 'unit-tester',
    role: 'platform-engineer',
    prompt: 'Execute v4 migration check',
    instructions: 'Test thoroughly',
    metadata: { env: 'test' },
  });

  assert.ok(trace.traceId, 'traceId should be defined on active trace');
  assert.doesNotThrow(() => {
    trace.onToolCall('test_terminal', { cmd: 'pnpm test' });
    trace.onToolComplete('test_terminal', { exitCode: 0 });
    trace.finalize('Completed successfully');
  });

  const scored = recordScore({
    traceId: trace.traceId!,
    name: 'task_success',
    value: 1,
  });
  assert.equal(scored, true);
});
