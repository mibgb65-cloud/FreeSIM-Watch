import { base64Url, randomToken, sha256 } from "./auth.js";
import type { Env } from "./env.js";

const AAD_PREFIX = "freesim-esimgg-v1:";

export type ProviderAccount = {
  id: string;
  label: string;
  configured: boolean;
  expiresAt: string | null;
  updatedAt: string;
  monitorCount: number;
};

type ProviderSessionRow = {
  id: string;
  label: string;
  ciphertext: string;
  iv: string;
  expires_at: string | null;
  updated_at: string;
  monitor_count?: number;
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

export async function encryptProviderToken(env: Env, userId: string, token: string): Promise<{ ciphertext: string; iv: string }> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: new TextEncoder().encode(`${AAD_PREFIX}${userId}`) },
    await encryptionKey(env),
    new TextEncoder().encode(token),
  );
  return { ciphertext: base64Url(new Uint8Array(ciphertext)), iv: base64Url(iv) };
}

export async function decryptProviderToken(env: Env, userId: string, ciphertext: string, iv: string): Promise<string> {
  const plaintext = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: arrayBuffer(fromBase64Url(iv)), additionalData: new TextEncoder().encode(`${AAD_PREFIX}${userId}`) },
    await encryptionKey(env),
    arrayBuffer(fromBase64Url(ciphertext)),
  );
  return new TextDecoder().decode(plaintext);
}

export function normalizeProviderSessionInput(value: string): string {
  const trimmed = value.trim();
  const cookieMatch = trimmed.match(/(?:^|[;\s])__Secure-nekopass\.session_token=([^;\s]+)/);
  const token = (cookieMatch?.[1] || trimmed).replace(/^['"]|['"]$/g, "");
  if (token.length < 20 || token.length > 4096 || /[\r\n]/.test(token)) throw new Error("esim.gg 会话 token 格式无效");
  return token;
}

export function normalizeProviderAccountLabel(value: string): string {
  const label = value.trim().replace(/\s+/g, " ");
  if (!label || label.length > 60) throw new Error("账号备注必填，且不能超过 60 个字符");
  return label;
}

async function validateProviderSessionToken(env: Env, token: string): Promise<void> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20_000);
  try {
    const response = await fetch("https://api.esim.gg/api/number/search", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: `__Secure-nekopass.session_token=${token}`,
        origin: "https://esim.gg",
        referer: "https://esim.gg/new/number/estonia",
        "user-agent": env.CHECK_USER_AGENT || "freesim-watch/0.1.0 (+open-source monitor)",
      },
      body: JSON.stringify({ search: "", type: "global" }),
      redirect: "manual",
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`esim.gg 拒绝了这个会话（HTTP ${response.status}），请重新登录后复制`);
    const data = await response.json<{ success?: boolean; search?: unknown[] }>().catch(() => null);
    if (!data?.success || !Array.isArray(data.search)) throw new Error("esim.gg 未确认这个会话有效，请重新登录后复制");
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw new Error("验证 esim.gg 会话超时，请稍后重试");
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

async function findProviderAccount(env: Env, userId: string, accountId: string): Promise<ProviderSessionRow | null> {
  return env.DB.prepare(
    `SELECT ps.*, (SELECT COUNT(*) FROM monitors m WHERE m.provider_session_id = ps.id) AS monitor_count
     FROM provider_sessions ps WHERE ps.id = ? AND ps.user_id = ?`,
  ).bind(accountId, userId).first<ProviderSessionRow>();
}

async function storeProviderSession(
  env: Env,
  userId: string,
  token: string,
  expiresAt: string | null,
  labelInput: string,
  accountId?: string | null,
): Promise<string> {
  const label = normalizeProviderAccountLabel(labelInput);
  const encrypted = await encryptProviderToken(env, userId, token);
  if (accountId) {
    if (!await findProviderAccount(env, userId, accountId)) throw new Error("要更新的 esim.gg 账号不存在");
    await env.DB.prepare(
      `UPDATE provider_sessions SET label = ?, ciphertext = ?, iv = ?, expires_at = ?, updated_at = CURRENT_TIMESTAMP
       WHERE id = ? AND user_id = ?`,
    ).bind(label, encrypted.ciphertext, encrypted.iv, expiresAt, accountId, userId).run();
    return accountId;
  }

  const id = crypto.randomUUID();
  await env.DB.prepare(
    `INSERT INTO provider_sessions (id, user_id, label, ciphertext, iv, expires_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
  ).bind(id, userId, label, encrypted.ciphertext, encrypted.iv, expiresAt).run();
  return id;
}

async function migrateLegacySecretIfNeeded(env: Env, userId: string): Promise<void> {
  const legacyAllowed = userId === "legacy-owner" || (env.LEGACY_OWNER_USER_ID && userId === env.LEGACY_OWNER_USER_ID);
  if (!legacyAllowed || !env.ESIMGG_SESSION_TOKEN) return;
  const existing = await env.DB.prepare("SELECT id FROM provider_sessions WHERE user_id = ? LIMIT 1").bind(userId).first<{ id: string }>();
  if (existing) return;
  const encrypted = await encryptProviderToken(env, userId, normalizeProviderSessionInput(env.ESIMGG_SESSION_TOKEN));
  const id = crypto.randomUUID();
  await env.DB.prepare(
    `INSERT OR IGNORE INTO provider_sessions (id, user_id, label, ciphertext, iv, expires_at, updated_at)
     VALUES (?, ?, 'esim.gg 账号 1', ?, ?, NULL, CURRENT_TIMESTAMP)`,
  ).bind(id, userId, encrypted.ciphertext, encrypted.iv).run();
  const account = await env.DB.prepare("SELECT id FROM provider_sessions WHERE user_id = ? ORDER BY created_at ASC LIMIT 1").bind(userId).first<{ id: string }>();
  if (account) {
    await env.DB.prepare("UPDATE monitors SET provider_session_id = ? WHERE user_id = ? AND provider_session_id IS NULL")
      .bind(account.id, userId).run();
  }
}

export async function importProviderSessionForUser(
  env: Env,
  userId: string,
  input: { session?: string; label?: string; accountId?: string | null },
): Promise<string> {
  const token = normalizeProviderSessionInput(input.session || "");
  await encryptionKey(env);
  await validateProviderSessionToken(env, token);
  return storeProviderSession(env, userId, token, null, input.label || "", input.accountId);
}

export async function createProviderImportCode(
  env: Env,
  userId: string,
  input: { label?: string; accountId?: string | null },
): Promise<{ code: string; expiresAt: string }> {
  const label = normalizeProviderAccountLabel(input.label || "");
  const accountId = input.accountId?.trim() || null;
  if (accountId && !await findProviderAccount(env, userId, accountId)) throw new Error("要更新的 esim.gg 账号不存在");
  const code = randomToken(9);
  const expiresAt = new Date(Date.now() + 10 * 60_000).toISOString();
  await env.DB.batch([
    env.DB.prepare("DELETE FROM provider_import_codes WHERE expires_at <= CURRENT_TIMESTAMP OR used_at IS NOT NULL"),
    env.DB.prepare(
      `INSERT INTO provider_import_codes (code_hash, user_id, provider_session_id, label, expires_at)
       VALUES (?, ?, ?, ?, ?)`,
    ).bind(await sha256(code), userId, accountId, label, expiresAt),
  ]);
  return { code, expiresAt };
}

export async function importProviderSession(
  env: Env,
  input: { code?: string; token?: string; expiresAt?: string | null },
): Promise<void> {
  const code = input.code?.trim() || "";
  const token = normalizeProviderSessionInput(input.token || "");
  if (!/^[A-Za-z0-9_-]{10,80}$/.test(code)) throw new Error("导入码格式无效");
  await encryptionKey(env);
  await validateProviderSessionToken(env, token);
  const claimed = await env.DB.prepare(
    `UPDATE provider_import_codes SET used_at = CURRENT_TIMESTAMP
     WHERE code_hash = ? AND used_at IS NULL AND expires_at > CURRENT_TIMESTAMP
     RETURNING user_id, provider_session_id, label`,
  ).bind(await sha256(code)).first<{ user_id: string; provider_session_id: string | null; label: string | null }>();
  if (!claimed) throw new Error("导入码无效、已使用或已过期");

  const parsedExpiry = input.expiresAt && Number.isFinite(Date.parse(input.expiresAt)) ? new Date(input.expiresAt).toISOString() : null;
  await storeProviderSession(env, claimed.user_id, token, parsedExpiry, claimed.label || "esim.gg 账号", claimed.provider_session_id);
}

export async function providerSessionStatus(env: Env, userId: string): Promise<{ configured: boolean; accounts: ProviderAccount[] }> {
  await migrateLegacySecretIfNeeded(env, userId);
  const { results } = await env.DB.prepare(
    `SELECT ps.id, ps.label, ps.ciphertext, ps.iv, ps.expires_at, ps.updated_at,
       (SELECT COUNT(*) FROM monitors m WHERE m.provider_session_id = ps.id) AS monitor_count
     FROM provider_sessions ps WHERE ps.user_id = ? ORDER BY ps.created_at ASC`,
  ).bind(userId).all<ProviderSessionRow>();
  const accounts = results.map((row) => ({
    id: row.id,
    label: row.label,
    configured: !row.expires_at || Date.parse(row.expires_at) > Date.now(),
    expiresAt: row.expires_at,
    updatedAt: row.updated_at,
    monitorCount: Number(row.monitor_count || 0),
  }));
  const legacyAllowed = userId === "legacy-owner" || (env.LEGACY_OWNER_USER_ID && userId === env.LEGACY_OWNER_USER_ID);
  return { configured: accounts.some((account) => account.configured) || Boolean(!accounts.length && legacyAllowed && env.ESIMGG_SESSION_TOKEN), accounts };
}

export async function deleteProviderSession(env: Env, userId: string, accountId: string): Promise<void> {
  const account = await findProviderAccount(env, userId, accountId);
  if (!account) throw new Error("esim.gg 账号不存在");
  if (Number(account.monitor_count || 0) > 0) throw new Error(`这个账号仍被 ${account.monitor_count} 个监控任务使用，请先修改或删除相关任务`);
  await env.DB.prepare("DELETE FROM provider_sessions WHERE id = ? AND user_id = ?").bind(accountId, userId).run();
}

export async function assertProviderSessionOwnership(env: Env, userId: string, accountId: string): Promise<void> {
  const account = await findProviderAccount(env, userId, accountId);
  if (!account) throw new Error("请选择属于你的 esim.gg 账号");
  if (account.expires_at && Date.parse(account.expires_at) <= Date.now()) throw new Error("所选 esim.gg 账号会话已过期，请先更新会话");
}

export async function providerSessionToken(env: Env, userId: string, accountId?: string | null): Promise<string | null> {
  const row = accountId
    ? await env.DB.prepare(
      "SELECT id, label, ciphertext, iv, expires_at, updated_at FROM provider_sessions WHERE id = ? AND user_id = ?",
    ).bind(accountId, userId).first<ProviderSessionRow>()
    : await env.DB.prepare(
      "SELECT id, label, ciphertext, iv, expires_at, updated_at FROM provider_sessions WHERE user_id = ? ORDER BY updated_at DESC LIMIT 1",
    ).bind(userId).first<ProviderSessionRow>();
  if (!row) {
    const legacyAllowed = userId === "legacy-owner" || (env.LEGACY_OWNER_USER_ID && userId === env.LEGACY_OWNER_USER_ID);
    return legacyAllowed ? env.ESIMGG_SESSION_TOKEN || null : null;
  }
  if (row.expires_at && Date.parse(row.expires_at) <= Date.now()) return null;
  try {
    return await decryptProviderToken(env, userId, row.ciphertext, row.iv);
  } catch {
    throw new Error("esim.gg 会话无法解密，请重新导入");
  }
}
