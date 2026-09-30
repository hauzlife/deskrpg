import assert from 'node:assert/strict';
import test from 'node:test';
import { getLangfuseConfig, startNpcTrace } from './langfuse';

test('getLangfuseConfig returns false when keys are not set', () => {
  const origPub = process.env.LANGFUSE_PUBLIC_KEY;
  const origSec = process.env.LANGFUSE_SECRET_KEY;
  delete process.env.LANGFUSE_PUBLIC_KEY;
  delete process.env.LANGFUSE_SECRET_KEY;
  delete process.env.HERMES_LANGFUSE_PUBLIC_KEY;
  delete process.env.HERMES_LANGFUSE_SECRET_KEY;

  const config = getLangfuseConfig();
  assert.equal(config.enabled, false);

  if (origPub) process.env.LANGFUSE_PUBLIC_KEY = origPub;
  if (origSec) process.env.LANGFUSE_SECRET_KEY = origSec;
});

test('startNpcTrace fails open gracefully when Langfuse is not enabled', () => {
  const trace = startNpcTrace({
    name: 'test-turn',
    prompt: 'Hello NPC',
  });

  // Does not throw and returns valid callable handles
  assert.doesNotThrow(() => {
    trace.onToolCall('test_tool', { query: 'test' });
    trace.onToolComplete('test_tool', { result: 'ok' });
    trace.finalize('Hello user!');
  });
});
