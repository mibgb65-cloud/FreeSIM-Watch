import type { Env } from "./env.js";

const SETTING_KEY = "max_registered_users";

export function normalizeRegisteredUserLimit(value: unknown): number {
  const limit = Math.trunc(Number(value));
  if (!Number.isFinite(limit) || limit < 1 || limit > 100_000) {
    throw new Error("总注册用户上限必须是 1 到 100000");
  }
  return limit;
}

export function environmentRegisteredUserLimit(env: Pick<Env, "MAX_REGISTERED_USERS">): number {
  try { return normalizeRegisteredUserLimit(env.MAX_REGISTERED_USERS || 10); }
  catch { return 10; }
}

export async function getRegisteredUserLimit(env: Pick<Env, "DB" | "MAX_REGISTERED_USERS">): Promise<number> {
  const row = await env.DB.prepare("SELECT value FROM app_settings WHERE key = ?").bind(SETTING_KEY).first<{ value: string }>();
  if (!row) return environmentRegisteredUserLimit(env);
  try { return normalizeRegisteredUserLimit(row.value); }
  catch { return environmentRegisteredUserLimit(env); }
}

export async function saveRegisteredUserLimit(env: Pick<Env, "DB">, value: unknown): Promise<number> {
  const limit = normalizeRegisteredUserLimit(value);
  await env.DB.prepare(
    `INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP`,
  ).bind(SETTING_KEY, String(limit)).run();
  return limit;
}
