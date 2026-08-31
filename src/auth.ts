import type { Env, SessionUser } from "./env.js";
import { getRegisteredUserLimit } from "./registration-limit.js";

const SESSION_COOKIE = "freesim_session";
const OAUTH_STATE_COOKIE = "freesim_oauth_state";
const SESSION_SECONDS = 60 * 60 * 24 * 30;
const SELF_HOSTED_ADMIN_ID = "self-hosted-admin";
export const LEGAL_VERSION = "2026-08-31.1";

export function base64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function randomToken(size = 32): string {
  const bytes = new Uint8Array(size);
  crypto.getRandomValues(bytes);
  return base64Url(bytes);
}

export async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function cookieValue(request: Request, name: string): string | null {
  const header = request.headers.get("cookie") || "";
  for (const part of header.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return decodeURIComponent(rest.join("="));
  }
  return null;
}

export function sessionCookie(token: string, maxAge = SESSION_SECONDS): string {
  const expires = maxAge === 0 ? "; Expires=Thu, 01 Jan 1970 00:00:00 GMT" : "";
  return `${SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}${expires}`;
}

export function oauthStateCookie(state: string, maxAge = 600): string {
  const expires = maxAge === 0 ? "; Expires=Thu, 01 Jan 1970 00:00:00 GMT" : "";
  return `${OAUTH_STATE_COOKIE}=${encodeURIComponent(state)}; Path=/auth/linuxdo/callback; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}${expires}`;
}

export function safeReturnTo(value: string | null): string {
  if (!value || !value.startsWith("/") || value.startsWith("//")) return "/dashboard";
  return value;
}

export async function currentUser(request: Request, env: Env): Promise<SessionUser | null> {
  const token = cookieValue(request, SESSION_COOKIE);
  if (!token) return null;
  const row = await env.DB.prepare(
    `SELECT u.id, u.username, u.name, u.avatar_url, u.role, u.trust_level
     FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.token_hash = ? AND s.expires_at > CURRENT_TIMESTAMP
       AND u.legal_version = ? AND u.banned_at IS NULL`,
  ).bind(await sha256(token), LEGAL_VERSION).first<{ id: string; username: string; name: string; avatar_url: string | null; role: "user" | "admin"; trust_level: number }>();
  if (row?.id === SELF_HOSTED_ADMIN_ID && !adminTokenConfigured(env.ADMIN_TOKEN)) return null;
  return row ? { id: row.id, username: row.username, name: row.name, avatarUrl: row.avatar_url, role: row.role, trustLevel: Number(row.trust_level || 0) } : null;
}

async function createSession(env: Env, userId: string): Promise<string> {
  const token = randomToken();
  await env.DB.batch([
    env.DB.prepare("DELETE FROM sessions WHERE expires_at <= CURRENT_TIMESTAMP"),
    env.DB.prepare(
      `INSERT INTO sessions (token_hash, user_id, expires_at)
       VALUES (?, ?, datetime('now', '+30 days'))`,
    ).bind(await sha256(token), userId),
  ]);
  return token;
}

export function adminTokenConfigured(value: unknown): value is string {
  return typeof value === "string"
    && value.length >= 32
    && value.length <= 256
    && !/[\u0000-\u001f\u007f]/.test(value);
}

export async function adminTokenMatches(candidate: unknown, configured: unknown): Promise<boolean> {
  const candidateValue = typeof candidate === "string" ? candidate : "";
  const candidateText = candidateValue.length <= 256 ? candidateValue : "";
  const configuredText = typeof configured === "string" ? configured : "";
  const [candidateHash, configuredHash] = await Promise.all([
    crypto.subtle.digest("SHA-256", new TextEncoder().encode(candidateText)),
    crypto.subtle.digest("SHA-256", new TextEncoder().encode(configuredText)),
  ]);
  const left = new Uint8Array(candidateHash);
  const right = new Uint8Array(configuredHash);
  let difference = adminTokenConfigured(configured) && candidateValue.length <= 256 ? 0 : 1;
  for (let index = 0; index < left.length; index += 1) difference |= left[index] ^ right[index];
  return difference === 0;
}

export async function createAdminTokenSession(env: Env, candidate: unknown, legalAccepted: boolean): Promise<string> {
  if (!legalAccepted) throw new Error("请先阅读并同意隐私政策和服务协议");
  if (!await adminTokenMatches(candidate, env.ADMIN_TOKEN)) throw new Error("站点 Token 无效或未配置");
  await env.DB.prepare(
    `INSERT INTO users (id, username, name, role, trust_level, privacy_accepted_at, terms_accepted_at, legal_version)
     VALUES (?, 'self_hosted', '自托管管理员', 'admin', 4, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, ?)
     ON CONFLICT(id) DO UPDATE SET role = 'admin', trust_level = 4,
       privacy_accepted_at = CURRENT_TIMESTAMP, terms_accepted_at = CURRENT_TIMESTAMP,
       legal_version = excluded.legal_version, banned_at = NULL, updated_at = CURRENT_TIMESTAMP,
       last_login_at = CURRENT_TIMESTAMP`,
  ).bind(SELF_HOSTED_ADMIN_ID, LEGAL_VERSION).run();
  return createSession(env, SELF_HOSTED_ADMIN_ID);
}

export async function destroySession(request: Request, env: Env): Promise<void> {
  const token = cookieValue(request, SESSION_COOKIE);
  if (token) await env.DB.prepare("DELETE FROM sessions WHERE token_hash = ?").bind(await sha256(token)).run();
}

export async function beginLinuxDoAuth(request: Request, env: Env, requestedReturnTo?: string | null, legalAccepted = false): Promise<{ url: string; state: string }> {
  if (!env.LINUXDO_CLIENT_ID) throw new Error("LinuxDo OAuth 尚未配置");
  if (!legalAccepted) throw new Error("请先阅读并同意隐私政策和服务协议");
  const state = randomToken();
  const returnTo = safeReturnTo(requestedReturnTo ?? new URL(request.url).searchParams.get("return_to"));
  await env.DB.batch([
    env.DB.prepare("DELETE FROM oauth_states WHERE expires_at <= CURRENT_TIMESTAMP"),
    env.DB.prepare(
      `INSERT INTO oauth_states (state_hash, return_to, legal_version, expires_at)
       VALUES (?, ?, ?, datetime('now', '+10 minutes'))`,
    ).bind(await sha256(state), returnTo, LEGAL_VERSION),
  ]);
  const callback = `${env.PUBLIC_ORIGIN.replace(/\/$/, "")}/auth/linuxdo/callback`;
  const target = new URL(env.LINUXDO_AUTHORIZE_URL);
  target.searchParams.set("client_id", env.LINUXDO_CLIENT_ID);
  target.searchParams.set("redirect_uri", callback);
  target.searchParams.set("response_type", "code");
  target.searchParams.set("state", state);
  return { url: target.toString(), state };
}

type LinuxDoProfile = {
  id?: string | number;
  username?: string;
  name?: string;
  avatar_url?: string;
  avatar_template?: string;
  active?: boolean;
  trust_level?: number;
};

function normalizeAvatar(value: string | undefined): string | null {
  if (!value) return null;
  try { return new URL(value.replace("{size}", "96"), "https://linux.do").toString(); }
  catch { return null; }
}

export async function finishLinuxDoAuth(request: Request, env: Env): Promise<{ token: string; returnTo: string }> {
  if (!env.LINUXDO_CLIENT_ID || !env.LINUXDO_CLIENT_SECRET) throw new Error("LinuxDo OAuth 尚未配置");
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  if (!code || !state) throw new Error("授权回调缺少必要参数");
  if (cookieValue(request, OAUTH_STATE_COOKIE) !== state) throw new Error("授权状态与当前浏览器不匹配，请重新登录");

  const stateHash = await sha256(state);
  const stored = await env.DB.prepare(
    `DELETE FROM oauth_states WHERE state_hash = ? AND expires_at > CURRENT_TIMESTAMP
     RETURNING return_to, legal_version`,
  ).bind(stateHash).first<{ return_to: string; legal_version: string | null }>();
  if (!stored) throw new Error("授权状态已失效，请重新登录");
  if (stored.legal_version !== LEGAL_VERSION) throw new Error("隐私政策或服务协议版本已更新，请重新确认");

  const redirectUri = `${env.PUBLIC_ORIGIN.replace(/\/$/, "")}/auth/linuxdo/callback`;
  const tokenResponse = await fetch(env.LINUXDO_TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      client_id: env.LINUXDO_CLIENT_ID,
      client_secret: env.LINUXDO_CLIENT_SECRET,
      redirect_uri: redirectUri,
    }),
  });
  if (!tokenResponse.ok) throw new Error("LinuxDo Token 交换失败");
  const tokenData = await tokenResponse.json<{ access_token?: string }>();
  if (!tokenData.access_token) throw new Error("LinuxDo 未返回访问令牌");

  const profileResponse = await fetch(env.LINUXDO_USER_URL, {
    headers: { authorization: `Bearer ${tokenData.access_token}` },
  });
  if (!profileResponse.ok) throw new Error("LinuxDo 用户资料读取失败");
  const raw = await profileResponse.json<LinuxDoProfile | { data?: LinuxDoProfile }>();
  const profile = "data" in raw && raw.data ? raw.data : raw as LinuxDoProfile;
  if (profile.id === undefined || !profile.username) throw new Error("LinuxDo 用户资料不完整");
  if (profile.active === false) throw new Error("LinuxDo 账号当前不可用");

  const userId = String(profile.id);
  const name = profile.name?.trim() || profile.username;
  const avatar = normalizeAvatar(profile.avatar_url || profile.avatar_template);
  const trustLevel = Math.min(Math.max(Math.trunc(Number(profile.trust_level ?? 0)), 0), 4);
  const admins = new Set((env.ADMIN_USER_IDS || "").split(",").map((item) => item.trim()).filter(Boolean));
  const role = admins.has(userId) ? "admin" : "user";
  const blocked = await env.DB.prepare("SELECT banned_at FROM users WHERE id = ?").bind(userId).first<{ banned_at: string | null }>();
  if (blocked?.banned_at) throw new Error("账号已被站点管理员封禁");
  const maximumUsers = await getRegisteredUserLimit(env);
  const registered = await env.DB.prepare(
    `INSERT INTO users (id, username, name, avatar_url, role, trust_level, privacy_accepted_at, terms_accepted_at, legal_version)
     SELECT ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, ?
     WHERE EXISTS (SELECT 1 FROM users WHERE id = ?)
        OR (SELECT COUNT(*) FROM users) < ?
        OR ? = 'admin'
     ON CONFLICT(id) DO UPDATE SET username = excluded.username, name = excluded.name,
       avatar_url = excluded.avatar_url, role = excluded.role, updated_at = CURRENT_TIMESTAMP,
       trust_level = excluded.trust_level,
       privacy_accepted_at = excluded.privacy_accepted_at, terms_accepted_at = excluded.terms_accepted_at,
       legal_version = excluded.legal_version,
       last_login_at = CURRENT_TIMESTAMP
     RETURNING id`,
  ).bind(userId, profile.username, name, avatar, role, trustLevel, LEGAL_VERSION, userId, maximumUsers, role).first<{ id: string }>();
  if (!registered) throw new Error(`注册用户已达上限（${maximumUsers} 人），请联系站点管理员`);

  if (env.LEGACY_OWNER_USER_ID && userId === env.LEGACY_OWNER_USER_ID) {
    await env.DB.prepare("UPDATE monitors SET user_id = ? WHERE user_id = 'legacy-owner'").bind(userId).run();
  }
  return { token: await createSession(env, userId), returnTo: safeReturnTo(stored.return_to) };
}

export async function createDevSession(env: Env): Promise<string> {
  if (env.DEV_LOGIN_ENABLED !== "true") throw new Error("开发登录未启用");
  const userId = "dev-linuxdo-user";
  await env.DB.prepare(
    `INSERT INTO users (id, username, name, role, trust_level, privacy_accepted_at, terms_accepted_at, legal_version)
     VALUES (?, 'freesim_dev', 'FreeSIM 开发者', 'admin', 4, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, ?)
     ON CONFLICT(id) DO UPDATE SET role = 'admin', privacy_accepted_at = CURRENT_TIMESTAMP,
       terms_accepted_at = CURRENT_TIMESTAMP, legal_version = excluded.legal_version,
       last_login_at = CURRENT_TIMESTAMP`,
  ).bind(userId, LEGAL_VERSION).run();
  return createSession(env, userId);
}
