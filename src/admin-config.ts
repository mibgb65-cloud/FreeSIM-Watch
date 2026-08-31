import { base64Url } from "./auth.js";
import type { Env, SessionUser } from "./env.js";

const ADMIN_AAD_PREFIX = "freesim-admin-v1:";

export type MonitorQuotaRule = {
  trustLevel: number;
  maxMonitors: number;
  isCustom: boolean;
  updatedAt: string | null;
};

export type ResendKeyStatus = {
  id: string;
  label: string;
  keyHint: string;
  fromAddress: string;
  active: boolean;
  consecutiveFailures: number;
  lastError: string | null;
  lastUsedAt: string | null;
  cooldownUntil: string | null;
  createdAt: string;
  updatedAt: string;
};

type ResendKeyRow = {
  id: string;
  label: string;
  key_hint: string;
  from_address: string;
  ciphertext: string;
  iv: string;
  active: number;
  consecutive_failures: number;
  last_error: string | null;
  last_used_at: string | null;
  cooldown_until: string | null;
  created_at: string;
  updated_at: string;
};

function fromBase64Url(value: string): Uint8Array {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - normalized.length % 4) % 4);
  const binary = atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function arrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

async function encryptionKey(env: Env): Promise<CryptoKey> {
  if (!env.SESSION_ENCRYPTION_KEY) throw new Error("SESSION_ENCRYPTION_KEY 尚未配置");
  const raw = fromBase64Url(env.SESSION_ENCRYPTION_KEY.trim());
  if (raw.byteLength !== 32) throw new Error("SESSION_ENCRYPTION_KEY 必须是 32 字节 Base64URL 密钥");
  return crypto.subtle.importKey("raw", arrayBuffer(raw), "AES-GCM", false, ["encrypt", "decrypt"]);
}

function clampTrustLevel(value: unknown): number {
  const level = Math.trunc(Number(value));
  if (!Number.isFinite(level) || level < 0 || level > 4) throw new Error("信任等级必须是 0 到 4");
  return level;
}

function clampMonitorLimit(value: unknown): number {
  const limit = Math.trunc(Number(value));
  if (!Number.isFinite(limit) || limit < 0 || limit > 20) throw new Error("监控任务上限必须是 0 到 20");
  return limit;
}

function normalizeLabel(value: unknown): string {
  const label = typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "";
  if (!label || label.length > 80) throw new Error("Resend Key 名称必填，且不能超过 80 个字符");
  return label;
}

export function normalizeResendDomain(value: unknown): string {
  const domain = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (!domain || domain.length > 253 || !/^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(domain)) {
    throw new Error("Resend 发件域名格式无效，例如 example.com");
  }
  return domain;
}

export function resendFromAddress(domain: string): string {
  const address = `FreeSIM Watch <alerts@${domain}>`;
  if (address.length > 254) throw new Error("Resend 发件域名过长");
  return address;
}

function normalizeFromAddress(value: unknown): string {
  const address = typeof value === "string" ? value.trim() : "";
  const email = address.match(/<([^<>]+)>$/)?.[1] || address;
  if (!address || address.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error("发件人格式无效，例如 FreeSIM Watch <alerts@example.com>");
  }
  return address;
}

export function normalizeResendApiKey(value: unknown): string {
  const key = typeof value === "string" ? value.trim() : "";
  if (!/^re_[A-Za-z0-9_-]{16,240}$/.test(key)) throw new Error("Resend API Key 格式无效，应以 re_ 开头");
  return key;
}

async function encryptResendKey(env: Env, id: string, value: string): Promise<{ ciphertext: string; iv: string }> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: new TextEncoder().encode(`${ADMIN_AAD_PREFIX}${id}`) },
    await encryptionKey(env),
    new TextEncoder().encode(value),
  );
  return { ciphertext: base64Url(new Uint8Array(ciphertext)), iv: base64Url(iv) };
}

async function decryptResendKey(env: Env, row: Pick<ResendKeyRow, "id" | "ciphertext" | "iv">): Promise<string> {
  const plaintext = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: arrayBuffer(fromBase64Url(row.iv)), additionalData: new TextEncoder().encode(`${ADMIN_AAD_PREFIX}${row.id}`) },
    await encryptionKey(env),
    arrayBuffer(fromBase64Url(row.ciphertext)),
  );
  return new TextDecoder().decode(plaintext);
}

export function isAdmin(user: SessionUser): boolean {
  return user.role === "admin";
}

export async function listQuotaRules(env: Env): Promise<MonitorQuotaRule[]> {
  const fallback = Math.min(Math.max(Math.trunc(Number(env.MAX_MONITORS_PER_USER || 3)), 0), 20);
  const { results } = await env.DB.prepare("SELECT trust_level, max_monitors, updated_at FROM monitor_quota_rules ORDER BY trust_level").all<{ trust_level: number; max_monitors: number; updated_at: string }>();
  const byLevel = new Map(results.map((row) => [row.trust_level, row]));
  return Array.from({ length: 5 }, (_, trustLevel) => {
    const row = byLevel.get(trustLevel);
    return { trustLevel, maxMonitors: row ? row.max_monitors : fallback, isCustom: Boolean(row), updatedAt: row?.updated_at || null };
  });
}

export async function getMonitorLimit(env: Env, trustLevel: number): Promise<number> {
  const level = Math.min(Math.max(Math.trunc(Number(trustLevel || 0)), 0), 4);
  const row = await env.DB.prepare("SELECT max_monitors FROM monitor_quota_rules WHERE trust_level = ?").bind(level).first<{ max_monitors: number }>();
  if (row) return row.max_monitors;
  return Math.min(Math.max(Math.trunc(Number(env.MAX_MONITORS_PER_USER || 3)), 0), 20);
}

export async function saveQuotaRule(env: Env, trustLevelInput: unknown, maxMonitorsInput: unknown): Promise<void> {
  const trustLevel = clampTrustLevel(trustLevelInput);
  const maxMonitors = clampMonitorLimit(maxMonitorsInput);
  await env.DB.prepare(
    `INSERT INTO monitor_quota_rules (trust_level, max_monitors, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)
     ON CONFLICT(trust_level) DO UPDATE SET max_monitors = excluded.max_monitors, updated_at = CURRENT_TIMESTAMP`,
  ).bind(trustLevel, maxMonitors).run();
}

export async function resetQuotaRule(env: Env, trustLevelInput: unknown): Promise<void> {
  await env.DB.prepare("DELETE FROM monitor_quota_rules WHERE trust_level = ?").bind(clampTrustLevel(trustLevelInput)).run();
}

function toResendKeyStatus(row: ResendKeyRow): ResendKeyStatus {
  return {
    id: row.id,
    label: row.label,
    keyHint: row.key_hint,
    fromAddress: row.from_address,
    active: Boolean(row.active),
    consecutiveFailures: Number(row.consecutive_failures || 0),
    lastError: row.last_error,
    lastUsedAt: row.last_used_at,
    cooldownUntil: row.cooldown_until,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function listResendKeyStatuses(env: Env): Promise<ResendKeyStatus[]> {
  const { results } = await env.DB.prepare(
    `SELECT id, label, key_hint, from_address, ciphertext, iv, active, consecutive_failures, last_error,
       last_used_at, cooldown_until, created_at, updated_at
     FROM resend_api_keys ORDER BY created_at ASC`,
  ).all<ResendKeyRow>();
  return results.map(toResendKeyStatus);
}

export async function createResendKey(env: Env, input: { label?: unknown; domain?: unknown; apiKey?: unknown; fromAddress?: unknown; active?: unknown }): Promise<ResendKeyStatus> {
  const domain = input.domain === undefined ? null : normalizeResendDomain(input.domain);
  const label = domain || normalizeLabel(input.label);
  const fromAddress = domain ? resendFromAddress(domain) : normalizeFromAddress(input.fromAddress);
  const apiKey = normalizeResendApiKey(input.apiKey);
  const id = crypto.randomUUID();
  const encrypted = await encryptResendKey(env, id, apiKey);
  const keyHint = `…${apiKey.slice(-4)}`;
  await env.DB.prepare(
    `INSERT INTO resend_api_keys (id, label, key_hint, from_address, ciphertext, iv, active) VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).bind(id, label, keyHint, fromAddress, encrypted.ciphertext, encrypted.iv, input.active === false ? 0 : 1).run();
  const row = await env.DB.prepare("SELECT * FROM resend_api_keys WHERE id = ?").bind(id).first<ResendKeyRow>();
  if (!row) throw new Error("Resend Key 保存失败");
  return toResendKeyStatus(row);
}

export async function updateResendKey(env: Env, id: string, input: { label?: unknown; domain?: unknown; apiKey?: unknown; fromAddress?: unknown; active?: unknown }): Promise<ResendKeyStatus> {
  const row = await env.DB.prepare("SELECT * FROM resend_api_keys WHERE id = ?").bind(id).first<ResendKeyRow>();
  if (!row) throw new Error("Resend Key 不存在");
  const domain = input.domain === undefined ? null : normalizeResendDomain(input.domain);
  const label = domain || (input.label === undefined ? row.label : normalizeLabel(input.label));
  const fromAddress = domain ? resendFromAddress(domain) : input.fromAddress === undefined ? row.from_address : normalizeFromAddress(input.fromAddress);
  const active = input.active === undefined ? Boolean(row.active) : input.active !== false;
  if (input.apiKey === undefined || input.apiKey === null || input.apiKey === "") {
    await env.DB.prepare("UPDATE resend_api_keys SET label = ?, from_address = ?, active = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
      .bind(label, fromAddress, active ? 1 : 0, id).run();
  } else {
    const apiKey = normalizeResendApiKey(input.apiKey);
    const encrypted = await encryptResendKey(env, id, apiKey);
    await env.DB.prepare(
      `UPDATE resend_api_keys SET label = ?, key_hint = ?, from_address = ?, ciphertext = ?, iv = ?, active = ?, consecutive_failures = 0,
       last_error = NULL, cooldown_until = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
    ).bind(label, `…${apiKey.slice(-4)}`, fromAddress, encrypted.ciphertext, encrypted.iv, active ? 1 : 0, id).run();
  }
  const updated = await env.DB.prepare("SELECT * FROM resend_api_keys WHERE id = ?").bind(id).first<ResendKeyRow>();
  if (!updated) throw new Error("Resend Key 更新失败");
  return toResendKeyStatus(updated);
}

export async function deleteResendKey(env: Env, id: string): Promise<void> {
  const result = await env.DB.prepare("DELETE FROM resend_api_keys WHERE id = ?").bind(id).run();
  if (!result.meta.changes) throw new Error("Resend Key 不存在");
}

export async function loadResendApiKeys(env: Env): Promise<Array<{ id: string; apiKey: string; fromAddress: string }>> {
  const { results } = await env.DB.prepare(
    `SELECT * FROM resend_api_keys WHERE active = 1
       AND (cooldown_until IS NULL OR cooldown_until <= CURRENT_TIMESTAMP)
     ORDER BY CASE WHEN last_used_at IS NULL THEN 0 ELSE 1 END, last_used_at ASC, created_at ASC`,
  ).all<ResendKeyRow>();
  const keys: Array<{ id: string; apiKey: string; fromAddress: string }> = [];
  for (const row of results) {
    try { keys.push({ id: row.id, apiKey: await decryptResendKey(env, row), fromAddress: row.from_address }); }
    catch (error) { console.error("Unable to decrypt managed Resend Key", row.id, error); }
  }
  if (env.RESEND_API_KEY && env.RESEND_FROM && !keys.some((key) => key.apiKey === env.RESEND_API_KEY)) {
    keys.push({ id: "legacy-env", apiKey: env.RESEND_API_KEY, fromAddress: env.RESEND_FROM });
  }
  return keys;
}

export async function recordResendSuccess(env: Env, id: string): Promise<void> {
  if (id === "legacy-env") return;
  await env.DB.prepare(
    `UPDATE resend_api_keys SET consecutive_failures = 0, last_error = NULL, cooldown_until = NULL,
       last_used_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
  ).bind(id).run();
}

export async function recordResendFailure(env: Env, id: string, status: number, detail: string, rotate: boolean): Promise<void> {
  if (id === "legacy-env") return;
  const cooldown = rotate ? ", cooldown_until = datetime('now', '+30 minutes')" : "";
  await env.DB.prepare(
    `UPDATE resend_api_keys SET consecutive_failures = consecutive_failures + 1, last_error = ?, updated_at = CURRENT_TIMESTAMP${cooldown} WHERE id = ?`,
  ).bind(`HTTP ${status}: ${detail.slice(0, 240)}`, id).run();
}

export function shouldRotateResendKey(status: number): boolean {
  return status === 401 || status === 402 || status === 403 || status === 429;
}
