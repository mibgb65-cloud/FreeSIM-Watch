import assert from 'node:assert/strict';
import test from 'node:test';
import { deleteLocalCheckHistoryForMonitor, loadLocalCheckHistory, saveLocalCheckRun } from '../frontend/src/lib/history.js';

const values = new Map();
globalThis.localStorage = {
  getItem: (key) => values.get(key) ?? null,
  setItem: (key, value) => values.set(key, String(value)),
};

test('browser history is isolated by user, capped, and removable by monitor', () => {
  values.clear();
  const now = Date.now();
  for (let index = 0; index < 55; index += 1) {
    assert.equal(saveLocalCheckRun('user-1', {
      id: `run-${index}`,
      monitor_id: index % 2 ? 'monitor-1' : 'monitor-2',
      started_at: new Date(now - index * 1000).toISOString(),
      results: [{ number: `372${index}` }],
    }), true);
  }
  assert.equal(loadLocalCheckHistory('user-1').length, 50);
  assert.equal(loadLocalCheckHistory('user-2').length, 0);
  deleteLocalCheckHistoryForMonitor('user-1', 'monitor-1');
  assert.equal(loadLocalCheckHistory('user-1').every((run) => run.monitor_id === 'monitor-2'), true);
});

test('browser history removes entries older than seven days', () => {
  values.clear();
  saveLocalCheckRun('user-1', {
    id: 'expired', monitor_id: 'monitor-1',
    started_at: new Date(Date.now() - 8 * 24 * 60 * 60_000).toISOString(), results: [],
  });
  assert.equal(loadLocalCheckHistory('user-1').length, 0);
});
