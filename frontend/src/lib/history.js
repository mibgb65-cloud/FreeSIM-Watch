const PREFIX = 'freesim-watch-check-history:';
const MAX_RUNS = 50;
const RETENTION_MS = 7 * 24 * 60 * 60_000;

function key(userId) {
  return `${PREFIX}${userId || 'anonymous'}`;
}

export function loadLocalCheckHistory(userId) {
  try {
    const parsed = JSON.parse(localStorage.getItem(key(userId)) || '[]');
    if (!Array.isArray(parsed)) return [];
    const cutoff = Date.now() - RETENTION_MS;
    const runs = parsed
      .filter((run) => run && typeof run.id === 'string' && Date.parse(run.started_at) >= cutoff && Array.isArray(run.results))
      .sort((a, b) => Date.parse(b.started_at) - Date.parse(a.started_at))
      .slice(0, MAX_RUNS);
    localStorage.setItem(key(userId), JSON.stringify(runs));
    return runs;
  } catch {
    return [];
  }
}

export function saveLocalCheckRun(userId, run) {
  if (!userId || !run?.id || !Array.isArray(run.results)) return false;
  try {
    const runs = loadLocalCheckHistory(userId).filter((item) => item.id !== run.id);
    localStorage.setItem(key(userId), JSON.stringify([run, ...runs].slice(0, MAX_RUNS)));
    return true;
  } catch {
    return false;
  }
}

export function deleteLocalCheckHistoryForMonitor(userId, monitorId) {
  if (!userId || !monitorId) return;
  try {
    const runs = loadLocalCheckHistory(userId).filter((run) => run.monitor_id !== monitorId);
    localStorage.setItem(key(userId), JSON.stringify(runs));
  } catch {}
}
