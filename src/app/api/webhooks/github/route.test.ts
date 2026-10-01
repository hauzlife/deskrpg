import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { POST } from './route';
import { NextRequest } from 'next/server';

describe('GitHub Webhook Endpoint (/api/webhooks/github)', () => {
  it('responds with 200 pong on ping event', async () => {
    const req = new NextRequest('http://localhost:3000/api/webhooks/github', {
      method: 'POST',
      headers: {
        'x-github-event': 'ping',
      },
      body: JSON.stringify({ zen: 'Keep it logically awesome.' }),
    });

    const res = await POST(req);
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.ok, true);
    assert.equal(data.message, 'pong');
  });

  it('rejects invalid payload with 400', async () => {
    const req = new NextRequest('http://localhost:3000/api/webhooks/github', {
      method: 'POST',
      headers: {
        'x-github-event': 'pull_request',
      },
      body: 'invalid-json-string',
    });

    const res = await POST(req);
    assert.equal(res.status, 500); // JSON parse error caught
  });

  it('acknowledges unsupported events gracefully', async () => {
    const req = new NextRequest('http://localhost:3000/api/webhooks/github', {
      method: 'POST',
      headers: {
        'x-github-event': 'star',
      },
      body: JSON.stringify({ action: 'created' }),
    });

    const res = await POST(req);
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.action, 'ignored_unsupported_event');
  });
});
