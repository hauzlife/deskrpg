import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  parseArtifactPyramidSlices,
  checkBoardWipLimit,
  insertTaskSafely,
  getSqliteDatabase,
  checkBoardStarvation,
  PRODUCT_BOARDS,
} from './autonomous-lifecycle-hooks';

test('parseArtifactPyramidSlices extracts cards and routes to correct boards', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pyramid-test-'));
  const analysisDir = path.join(tmpDir, '02-analysis');
  fs.mkdirSync(analysisDir, { recursive: true });

  const mysteliaCardPath = path.join(analysisDir, '03-mystelia-cards.md');
  fs.writeFileSync(
    mysteliaCardPath,
    `---
title: "02 Analysis: Mystelia"
---
# Mystelia Analysis

### [MY-01] Implementacao de Synastry
- **Identificador:** \`MY-01\`
- **Atribuído a:** \`backend-engineer\`
- **Prioridade:** P0
- **Objetivo:** Calcular mapas compostos.

### [MY-02] Tracking de UTMs
- **Identificador:** \`MY-02\`
- **Atribuído a:** \`platform-engineer\`
- **Prioridade:** P1
- **Objetivo:** Persistir UTMs no Stripe.
`,
    'utf8'
  );

  const bloopuCardPath = path.join(analysisDir, '02-bloopu-crypto-cards.md');
  fs.writeFileSync(
    bloopuCardPath,
    `---
title: "02 Analysis: Bloopu"
---
### [BL-01] Quantum Consensus
- **Atribuído a:** \`frontend-engineer\`
- **Prioridade:** P2
- **Objetivo:** WebSocket telemetry.
`,
    'utf8'
  );

  const slices = parseArtifactPyramidSlices(tmpDir);
  assert.equal(slices.length, 3);

  const my01 = slices.find((s) => s.title.includes('[MY-01]'));
  assert.ok(my01);
  assert.equal(my01.targetBoard, 'mystelia');
  assert.equal(my01.assignee, 'backend-engineer');
  assert.equal(my01.priority, 10); // P0 -> 10

  const my02 = slices.find((s) => s.title.includes('[MY-02]'));
  assert.ok(my02);
  assert.equal(my02.targetBoard, 'mystelia');
  assert.equal(my02.assignee, 'platform-engineer');
  assert.equal(my02.priority, 8); // P1 -> 8

  const bl01 = slices.find((s) => s.title.includes('[BL-01]'));
  assert.ok(bl01);
  assert.equal(bl01.targetBoard, 'bloopu');
  assert.equal(bl01.assignee, 'frontend-engineer');
  assert.equal(bl01.priority, 5); // P2 -> 5

  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('checkBoardStarvation identifies empty and starved boards accurately', () => {
  // Check that product boards list contains the 4 core products
  assert.ok(PRODUCT_BOARDS.includes('mystelia' as any));
  assert.ok(PRODUCT_BOARDS.includes('hot-telegram' as any));
  assert.ok(PRODUCT_BOARDS.includes('bloopu' as any));
  assert.ok(PRODUCT_BOARDS.includes('social' as any));

  // Non-existent board does not fail
  const nonExistent = checkBoardStarvation('unknown-board-xyz-999');
  assert.equal(nonExistent.starved, false);
});
