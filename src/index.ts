import {
  beginLinuxDoAuth,
  createDevSession,
  currentUser,
  destroySession,
  finishLinuxDoAuth,
  oauthStateCookie,
  sessionCookie,
} from "./auth.js";
import type { Env, SessionUser } from "./env.js";
import {
  createResendKey,
  deleteResendKey,
  getMonitorLimit,
  isAdmin,
  loadResendApiKeys,
  listQuotaRules,
  listResendKeyStatuses,
  recordResendFailure,
  recordResendSuccess,
  resetQuotaRule,
  saveQuotaRule,
  shouldRotateResendKey,
  updateResendKey,
} from "./admin-config.js";
import {
  assertProviderSessionOwnership,
  createProviderImportCode,
  deleteProviderSession,
  importProviderSession,
  importProviderSessionForUser,
  providerSessionStatus,
  providerSessionToken,
} from "./provider-session.js";
import { getRegisteredUserLimit, saveRegisteredUserLimit } from "./registration-limit.js";

type ParserConfig = {
  format?: "json" | "text";
  itemsPath?: string;
  numberPath?: string;
  pricePath?: string;
  priceSubtract?: number;
  currencyPath?: string;
  currencyValue?: string;
  purchaseUrlPath?: string;
  numberRegex?: string;
  priceRegex?: string;
  purchaseUrlRegex?: string;
};

type FilterConfig = {
  freeOnly?: boolean;
  maxPrice?: number;
  currency?: string;
  numberPrefix?: string;
  checkRounds?: number;
  roundDelaySeconds?: number;
};

type OrderActionConfig = {
  enabled?: boolean;
  url: string;
  method?: "POST" | "PUT";
  headers?: Record<string, string>;
  bodyTemplate: string;
  rechargeAmount?: number;
  paymentUrlPath: string;
  orderIdPath?: string;
  totalPath?: string;
  currencyPath?: string;
  maxCandidatePrice?: number;
  maxOrdersPerCheck?: number;
  cooldownMinutes?: number;
  disableMonitorAfterOrder?: boolean;
  unpaidOnlyAcknowledged?: boolean;
};

type MonitorInput = {
  providerSessionId: string;
  name: string;
  enabled?: boolean;
  url: string;
  method?: "GET" | "POST";
  headers?: Record<string, string>;
  body?: string | null;
  parser: ParserConfig;
  filters?: FilterConfig;
  action?: OrderActionConfig | null;
  notifyEmail: string;
  intervalMinutes?: number;
};

type Monitor = {
  id: string;
  userId: string;
  providerSessionId: string | null;
  providerSessionLabel: string | null;
  name: string;
  enabled: boolean;
  url: string;
  method: "GET" | "POST";
  headers: Record<string, string>;
  body: string | null;
  parser: ParserConfig;
  filters: FilterConfig;
  action: OrderActionConfig | null;
  notifyEmail: string;
  intervalMinutes: number;
  lastCheckedAt: string | null;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
};

type Discovery = {
  id: string;
  monitorId: string;
  fingerprint: string;
  number: string;
  price: number | null;
  currency: string | null;
  purchaseUrl: string | null;
  raw: unknown;
  firstSeenAt: string;
  lastSeenAt: string;
  notifiedAt: string | null;
};

type Candidate = {
  number: string;
  listedPrice: number | null;
  price: number | null;
  currency: string | null;
  purchaseUrl: string | null;
  raw: unknown;
};

type NumberSearchInput = {
  query?: string;
  minPrice?: number | null;
  maxPrice?: number | null;
  currency?: string;
  limit?: number;
};

type NumberRankingInput = {
  order?: unknown;
  limit?: unknown;
};

type ManualOrderInput = {
  number?: unknown;
  expectedPrice?: unknown;
  acknowledged?: unknown;
};

type NormalizedNumberRankingInput = {
  order: "asc" | "desc";
  limit: number;
};

type OrderResult = {
  status: "created" | "failed" | "skipped";
  paymentUrl: string | null;
  providerOrderId: string | null;
  total: number | null;
  currency: string | null;
  error: string | null;
};

export const SECURITY_HEADERS: Record<string, string> = {
  "content-security-policy": "default-src 'self'; base-uri 'none'; object-src 'none'; frame-ancestors 'none'; frame-src 'none'; form-action 'self' https://connect.linux.do; script-src 'self' 'sha256-37Eotni1dEBpqg1JINKCahsQ72TwsWmyjZ7d7cNdVaY='; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' data: https://fonts.gstatic.com; img-src 'self' data: https:; connect-src 'self'; upgrade-insecure-requests",
  "cross-origin-opener-policy": "same-origin",
  "cross-origin-resource-policy": "same-origin",
  "permissions-policy": "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
  "referrer-policy": "strict-origin-when-cross-origin",
  "strict-transport-security": "max-age=31536000",
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
};
const JSON_HEADERS = { ...SECURITY_HEADERS, "content-type": "application/json; charset=utf-8", "cache-control": "no-store" };
const MAX_RESPONSE_BYTES = 2_000_000;

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const publicOrigin = new URL(env.PUBLIC_ORIGIN);

    if (publicOrigin.hostname !== "127.0.0.1" && publicOrigin.hostname !== "localhost" && url.origin !== publicOrigin.origin) {
      const target = new URL(`${url.pathname}${url.search}`, publicOrigin);
      return withSecurityHeaders(new Response(null, { status: 308, headers: { location: target.toString(), "cache-control": "no-store" } }));
    }

    if (url.pathname === "/health") {
      return json({ ok: true, service: "freesim-watch" });
    }

    if (request.method === "GET" && url.pathname === "/api/auth/config") {
      return json({ linuxDoConfigured: Boolean(env.LINUXDO_CLIENT_ID), devLoginEnabled: env.DEV_LOGIN_ENABLED === "true" });
    }

    if (request.method === "GET" && url.pathname === "/api/session") {
      return json({ user: await currentUser(request, env) });
    }

    if (request.method === "POST" && url.pathname === "/auth/linuxdo") {
      try {
        if (!sameOrigin(request)) throw new Error("请求来源无效");
        const form = await request.formData();
        const returnTo = typeof form.get("return_to") === "string" ? String(form.get("return_to")) : null;
        const legalAccepted = form.get("legal_consent") === "accepted";
        const result = await beginLinuxDoAuth(request, env, returnTo, legalAccepted);
        return redirect(result.url, [oauthStateCookie(result.state)]);
      } catch (error) {
        return redirect(`/login?error=${encodeURIComponent(error instanceof Error ? error.message : "登录初始化失败")}`);
      }
    }

    if (request.method === "GET" && url.pathname === "/auth/linuxdo/callback") {
      try {
        const result = await finishLinuxDoAuth(request, env);
        return redirect(result.returnTo, [sessionCookie(result.token), oauthStateCookie("", 0)]);
      } catch (error) {
        return redirect(`/login?error=${encodeURIComponent(error instanceof Error ? error.message : "登录失败")}`);
      }
    }

    if (request.method === "GET" && url.pathname === "/auth/dev") {
      try { return redirect("/dashboard", [sessionCookie(await createDevSession(env))]); }
      catch { return json({ error: "Not found" }, 404); }
    }

    if (request.method === "POST" && url.pathname === "/auth/logout") {
      if (!sameOrigin(request)) return json({ error: "请求来源无效" }, 403);
      await destroySession(request, env);
      return json({ ok: true }, 200, [sessionCookie("", 0)]);
    }

    if (request.method === "POST" && url.pathname === "/api/esimgg/session/import") {
      try {
        await importProviderSession(env, await readJson<{ code?: string; token?: string; expiresAt?: string | null }>(request));
        return json({ ok: true });
      } catch (error) {
        return json({ error: error instanceof Error ? error.message : "会话导入失败" }, 400);
      }
    }

    if (url.pathname.startsWith("/api/")) {
      const user = await currentUser(request, env);
      if (!user) return json({ error: "请先使用 LinuxDo 登录" }, 401);
      if (request.method !== "GET" && !sameOrigin(request)) return json({ error: "请求来源无效" }, 403);
      try {
        return await handleApi(request, env, url, user);
      } catch (error) {
        console.error(error);
        return json({ error: error instanceof Error ? error.message : "Unexpected error" }, 500);
      }
    }

    return withSecurityHeaders(await env.ASSETS.fetch(request));
  },

  async scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(runDueChecks(env));
  },
} satisfies ExportedHandler<Env>;

async function handleApi(request: Request, env: Env, url: URL, user: SessionUser): Promise<Response> {
  const path = url.pathname.replace(/^\/api\/?/, "").split("/").filter(Boolean);

  if (path[0] === "admin") {
    if (!isAdmin(user)) return json({ error: "只有管理员可以访问此页面" }, 403);

    if (request.method === "GET" && path.length === 2 && path[1] === "users") {
      const fallbackLimit = await getMonitorLimit(env, 0);
      const [{ results }, stats, registrationLimit] = await Promise.all([
        env.DB.prepare(
          `SELECT u.id, u.username, u.name, u.avatar_url, u.role, u.trust_level, u.last_login_at, u.banned_at,
             COUNT(m.id) AS monitor_count
           FROM users u LEFT JOIN monitors m ON m.user_id = u.id
           GROUP BY u.id ORDER BY u.last_login_at DESC LIMIT 500`,
        ).all<{ id: string; username: string; name: string; avatar_url: string | null; role: "user" | "admin"; trust_level: number; last_login_at: string; banned_at: string | null; monitor_count: number }>(),
        env.DB.prepare(
          `SELECT COUNT(*) AS total,
             SUM(CASE WHEN role = 'admin' THEN 1 ELSE 0 END) AS admins,
             SUM(CASE WHEN banned_at IS NOT NULL THEN 1 ELSE 0 END) AS banned,
             SUM(CASE WHEN trust_level = 0 THEN 1 ELSE 0 END) AS level_0,
             SUM(CASE WHEN trust_level = 1 THEN 1 ELSE 0 END) AS level_1,
             SUM(CASE WHEN trust_level = 2 THEN 1 ELSE 0 END) AS level_2,
             SUM(CASE WHEN trust_level = 3 THEN 1 ELSE 0 END) AS level_3,
             SUM(CASE WHEN trust_level = 4 THEN 1 ELSE 0 END) AS level_4
           FROM users`,
        ).first<{ total: number; admins: number; banned: number; level_0: number; level_1: number; level_2: number; level_3: number; level_4: number }>(),
        getRegisteredUserLimit(env),
      ]);
      const quotas = await listQuotaRules(env);
      return json({
        users: results.map((row) => {
        const rule = quotas.find((item) => item.trustLevel === Number(row.trust_level));
        return {
          id: row.id, username: row.username, name: row.name, avatarUrl: row.avatar_url,
          role: row.role, trustLevel: Number(row.trust_level || 0), monitorCount: Number(row.monitor_count || 0),
          maxMonitors: rule?.maxMonitors ?? fallbackLimit, lastLoginAt: row.last_login_at, bannedAt: row.banned_at,
        };
        }),
        stats: {
          total: Number(stats?.total || 0),
          admins: Number(stats?.admins || 0),
          banned: Number(stats?.banned || 0),
          levels: [0, 1, 2, 3, 4].map((level) => Number(stats?.[`level_${level}` as keyof typeof stats] || 0)),
          registrationLimit,
        },
      });
    }

    if (path.length === 3 && path[1] === "users" && path[2]) {
      const targetUserId = path[2];
      if (targetUserId === user.id) return json({ error: "不能封禁或删除当前管理员账号" }, 409);
      const target = await env.DB.prepare("SELECT id, banned_at FROM users WHERE id = ?").bind(targetUserId).first<{ id: string; banned_at: string | null }>();
      if (!target) return json({ error: "用户不存在" }, 404);

      if (request.method === "PUT" && url.searchParams.get("action") === "ban") {
        await env.DB.batch([
          env.DB.prepare("UPDATE users SET banned_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ?").bind(targetUserId),
          env.DB.prepare("DELETE FROM sessions WHERE user_id = ?").bind(targetUserId),
          env.DB.prepare("UPDATE monitors SET enabled = 0, updated_at = CURRENT_TIMESTAMP WHERE user_id = ?").bind(targetUserId),
        ]);
        return json({ ok: true });
      }
      if (request.method === "DELETE" && url.searchParams.get("action") === "unban") {
        await env.DB.prepare("UPDATE users SET banned_at = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ?").bind(targetUserId).run();
        return json({ ok: true });
      }
      if (request.method === "DELETE" && !url.searchParams.has("action")) {
        await env.DB.batch([
          env.DB.prepare("DELETE FROM monitors WHERE user_id = ?").bind(targetUserId),
          env.DB.prepare("DELETE FROM provider_sessions WHERE user_id = ?").bind(targetUserId),
          env.DB.prepare("DELETE FROM sessions WHERE user_id = ?").bind(targetUserId),
          env.DB.prepare("DELETE FROM users WHERE id = ?").bind(targetUserId),
        ]);
        return json({ ok: true });
      }
    }

    if (request.method === "PUT" && path.length === 2 && path[1] === "registration-limit") {
      try {
        const input = await readJson<{ maximumUsers?: unknown }>(request);
        return json({ registrationLimit: await saveRegisteredUserLimit(env, input.maximumUsers) });
      } catch (error) {
        return json({ error: error instanceof Error ? error.message : "注册上限保存失败" }, 400);
      }
    }

    if (request.method === "GET" && path.length === 2 && path[1] === "quota-rules") {
      return json({ rules: await listQuotaRules(env) });
    }
    if (path[1] === "quota-rules" && path[2]) {
      try {
        if (request.method === "PUT") {
          const input = await readJson<{ maxMonitors?: unknown }>(request);
          await saveQuotaRule(env, path[2], input.maxMonitors);
          return json({ rules: await listQuotaRules(env) });
        }
        if (request.method === "DELETE") {
          await resetQuotaRule(env, path[2]);
          return json({ rules: await listQuotaRules(env) });
        }
      } catch (error) {
        return json({ error: error instanceof Error ? error.message : "配额保存失败" }, 400);
      }
    }

    if (request.method === "GET" && path.length === 3 && path[1] === "resend" && path[2] === "keys") {
      return json({ keys: await listResendKeyStatuses(env), legacyConfigured: Boolean(env.RESEND_API_KEY) });
    }
    if (path[1] === "resend" && path[2] === "keys") {
      try {
        if (request.method === "POST" && path.length === 3) {
          const result = await createResendKey(env, await readJson<{ label?: unknown; domain?: unknown; apiKey?: unknown; fromAddress?: unknown; active?: unknown }>(request));
          return json({ key: result }, 201);
        }
        if (path.length === 4 && request.method === "PUT") {
          const result = await updateResendKey(env, path[3], await readJson<{ label?: unknown; domain?: unknown; apiKey?: unknown; fromAddress?: unknown; active?: unknown }>(request));
          return json({ key: result });
        }
        if (path.length === 4 && request.method === "DELETE") {
          await deleteResendKey(env, path[3]);
          return json({ ok: true });
        }
      } catch (error) {
        return json({ error: error instanceof Error ? error.message : "Resend Key 操作失败" }, 400);
      }
    }

    return json({ error: "Not found" }, 404);
  }

  if (request.method === "GET" && path.length === 2 && path[0] === "esimgg" && path[1] === "status") {
    return json(await providerSessionStatus(env, user.id));
  }

  if (request.method === "POST" && path.length === 2 && path[0] === "esimgg" && path[1] === "import-code") {
    const input = await readJson<{ label?: string; accountId?: string | null }>(request);
    const result = await createProviderImportCode(env, user.id, input);
    return json({ ...result, importUrl: `${url.origin}/api/esimgg/session/import` });
  }

  if (request.method === "POST" && path.length === 2 && path[0] === "esimgg" && path[1] === "session") {
    try {
      const input = await readJson<{ session?: string; label?: string; accountId?: string | null }>(request);
      const accountId = await importProviderSessionForUser(env, user.id, input);
      return json({ ok: true, accountId, ...(await providerSessionStatus(env, user.id)) });
    } catch (error) {
      return json({ error: error instanceof Error ? error.message : "esim.gg 会话导入失败" }, 400);
    }
  }

  if (request.method === "DELETE" && path.length === 3 && path[0] === "esimgg" && path[1] === "session") {
    try {
      await deleteProviderSession(env, user.id, path[2]);
      return json({ ok: true, ...(await providerSessionStatus(env, user.id)) });
    } catch (error) {
      return json({ error: error instanceof Error ? error.message : "esim.gg 账号删除失败" }, 409);
    }
  }

  if (request.method === "GET" && path.length === 1 && path[0] === "monitors") {
    const monitors = await listMonitors(env.DB, user.id);
    return json({ monitors });
  }

  if (request.method === "GET" && path.length === 2 && path[0] === "numbers" && path[1] === "ranking") {
    try {
      const input = normalizeNumberRankingInput({
        order: url.searchParams.get("order"),
        limit: url.searchParams.get("limit"),
      });
      return json({
        source: "d1",
        generatedAt: new Date().toISOString(),
        query: input,
        ...(await listNumberRanking(env.DB, input)),
      });
    } catch (error) {
      return json({ error: error instanceof Error ? error.message : "排行榜参数无效" }, 400);
    }
  }

  if (request.method === "POST" && path.length === 2 && path[0] === "numbers" && path[1] === "search") {
    try {
      const input = normalizeNumberSearchInput(await readJson<NumberSearchInput>(request));
      return json({
        query: input,
        searchedAt: new Date().toISOString(),
        source: "global-d1",
        ...(await searchNumberInventory(env.DB, input)),
      });
    } catch (error) {
      return json({ error: error instanceof Error ? error.message : "号码查询参数无效" }, 400);
    }
  }

  if (request.method === "POST" && path.length === 1 && path[0] === "monitors") {
    const count = await env.DB.prepare("SELECT COUNT(*) AS total FROM monitors WHERE user_id = ?").bind(user.id).first<{ total: number }>();
    const maximum = await getMonitorLimit(env, user.trustLevel);
    if (Number(count?.total || 0) >= maximum) return json({ error: `每个用户最多创建 ${maximum} 个监控任务` }, 409);
    const input = await readJson<MonitorInput>(request);
    const monitor = normalizeMonitorInput(input);
    await assertProviderSessionOwnership(env, user.id, monitor.providerSessionId);
    const now = new Date().toISOString();
    const id = crypto.randomUUID();
    await env.DB.prepare(
      `INSERT INTO monitors
       (id, user_id, provider_session_id, name, enabled, url, method, headers_json, body, parser_json, filters_json, action_json,
        notify_email, last_checked_at, last_error, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?)`,
    )
      .bind(
        id,
        user.id,
        monitor.providerSessionId,
        monitor.name,
        monitor.enabled ? 1 : 0,
        monitor.url,
        monitor.method,
        JSON.stringify(monitor.headers),
        monitor.body,
        JSON.stringify(monitor.parser),
        JSON.stringify({ ...monitor.filters, intervalMinutes: monitor.intervalMinutes }),
        monitor.action ? JSON.stringify(monitor.action) : null,
        monitor.notifyEmail,
        now,
        now,
      )
      .run();
    const createdMonitor = { ...monitor, id, lastCheckedAt: null, lastError: null, createdAt: now, updatedAt: now };
    let emailSent = true;
    let emailError: string | null = null;
    try {
      await sendMonitorCreatedEmail(env, createdMonitor);
    } catch (error) {
      emailSent = false;
      emailError = error instanceof Error ? error.message : "邮件发送失败";
      console.error("Monitor creation confirmation email failed", error);
    }
    return json({ monitor: createdMonitor, emailSent, emailError }, 201);
  }

    if (path[0] === "monitors" && path[1]) {
    const id = path[1];
    if (request.method === "GET" && path.length === 2) {
      const monitor = await getMonitor(env.DB, id, user.id);
      return monitor ? json({ monitor }) : json({ error: "Monitor not found" }, 404);
    }

    if (request.method === "PUT" && path.length === 2) {
      const input = await readJson<MonitorInput>(request);
      const monitor = normalizeMonitorInput(input);
      await assertProviderSessionOwnership(env, user.id, monitor.providerSessionId);
      const now = new Date().toISOString();
      const result = await env.DB.prepare(
        `UPDATE monitors SET provider_session_id = ?, name = ?, enabled = ?, url = ?, method = ?, headers_json = ?,
         body = ?, parser_json = ?, filters_json = ?, action_json = ?, notify_email = ?, updated_at = ? WHERE id = ? AND user_id = ?`,
      )
        .bind(
          monitor.providerSessionId,
          monitor.name,
          monitor.enabled ? 1 : 0,
          monitor.url,
          monitor.method,
          JSON.stringify(monitor.headers),
          monitor.body,
          JSON.stringify(monitor.parser),
          JSON.stringify({ ...monitor.filters, intervalMinutes: monitor.intervalMinutes }),
          monitor.action ? JSON.stringify(monitor.action) : null,
          monitor.notifyEmail,
          now,
          id,
          user.id,
        )
        .run();
      if (!result.meta.changes) return json({ error: "Monitor not found" }, 404);
      return json({ monitor: await getMonitor(env.DB, id, user.id) });
    }

    if (request.method === "DELETE" && path.length === 2) {
      const result = await env.DB.prepare("DELETE FROM monitors WHERE id = ? AND user_id = ?").bind(id, user.id).run();
      return result.meta.changes ? json({ ok: true }) : json({ error: "Monitor not found" }, 404);
    }

    if (request.method === "POST" && path.length === 3 && path[2] === "check") {
      const monitor = await getMonitor(env.DB, id, user.id);
      if (!monitor) return json({ error: "Monitor not found" }, 404);
      const result = await checkMonitor(env, monitor);
      return json(result, result.ok ? 200 : 502);
    }

    if (request.method === "POST" && path.length === 3 && path[2] === "search") {
      const monitor = await getMonitor(env.DB, id, user.id);
      if (!monitor) return json({ error: "Monitor not found" }, 404);
      const input = normalizeNumberSearchInput(await readJson<NumberSearchInput>(request));
      const result = await searchNumberInventory(env.DB, input);
      return json({
        monitor: { id: monitor.id, name: monitor.name },
        query: input,
        searchedAt: new Date().toISOString(),
        source: "d1",
        ...result,
      });
    }

    if (request.method === "POST" && path.length === 4 && path[2] === "numbers" && path[3] === "order") {
      const monitor = await getMonitor(env.DB, id, user.id);
      if (!monitor) return json({ error: "Monitor not found" }, 404);
      try {
        const input = normalizeManualOrderInput(await readJson<ManualOrderInput>(request));
        if (!monitor.action?.enabled || !monitor.action.unpaidOnlyAcknowledged) {
          return json({ error: "请先在监控配置中启用创建待支付订单，并确认最终付款由人工完成" }, 409);
        }
        const inventory = await env.DB.prepare(
          `SELECT number, listed_price, price, currency, last_seen_at
           FROM global_number_inventory WHERE number = ? LIMIT 1`,
        ).bind(input.number).first<ManualOrderNumberRow>();
        if (!inventory) return json({ error: "该号码不在此监控任务的数据库中，请先执行一次检查" }, 404);
        if (inventory.price === null) return json({ error: "该号码的最近价格未知，无法安全创建待支付订单" }, 409);
        if (Math.abs(inventory.price - input.expectedPrice) > 0.000001) {
          return json({ error: "号码价格已变化，请刷新页面并重新确认" }, 409);
        }

        const candidate: Candidate = {
          number: inventory.number,
          listedPrice: inventory.listed_price,
          price: inventory.price,
          currency: inventory.currency,
          purchaseUrl: null,
          raw: { number: inventory.number, listedPrice: inventory.listed_price, price: inventory.price, currency: inventory.currency },
        };
        const fingerprint = await createFingerprint(candidate, monitor.id);
        const existingDiscovery = await env.DB.prepare(
          "SELECT * FROM discoveries WHERE monitor_id = ? AND fingerprint = ?",
        ).bind(monitor.id, fingerprint).first<DiscoveryRow>();
        let discovery = existingDiscovery ? rowToDiscovery(existingDiscovery, candidate.raw, inventory.last_seen_at) : null;
        if (!discovery) {
          const discoveryId = crypto.randomUUID();
          await env.DB.prepare(
            `INSERT OR IGNORE INTO discoveries
             (id, monitor_id, fingerprint, number, price, currency, purchase_url, raw_json,
              first_seen_at, last_seen_at, notified_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          ).bind(
            discoveryId, monitor.id, fingerprint, candidate.number, candidate.price, candidate.currency,
            candidate.purchaseUrl, JSON.stringify(candidate.raw), inventory.last_seen_at,
            inventory.last_seen_at, new Date().toISOString(),
          ).run();
          const row = await env.DB.prepare(
            "SELECT * FROM discoveries WHERE monitor_id = ? AND fingerprint = ?",
          ).bind(monitor.id, fingerprint).first<DiscoveryRow>();
          if (!row) throw new Error("无法创建号码记录");
          discovery = rowToDiscovery(row, candidate.raw, inventory.last_seen_at);
        }

        const reusableOrder = await env.DB.prepare(
          `SELECT o.* FROM orders o JOIN discoveries d ON d.id = o.discovery_id
           WHERE d.monitor_id = ? AND d.number = ? AND o.status = 'created' AND o.payment_url IS NOT NULL
           ORDER BY o.created_at DESC LIMIT 1`,
        ).bind(monitor.id, discovery.number).first<OrderRow>();
        if (reusableOrder?.payment_url) {
          const order = rowToOrderResult(reusableOrder);
          await env.DB.prepare("UPDATE discoveries SET notified_at = COALESCE(notified_at, ?) WHERE id = ?")
            .bind(new Date().toISOString(), discovery.id).run();
          let emailSent = false;
          let emailError: string | null = null;
          try {
            await sendManualOrderEmail(env, monitor, discovery, order);
            emailSent = true;
          } catch (error) {
            emailError = error instanceof Error ? error.message : "邮件发送失败";
          }
          return json({ order, reused: true, emailSent, emailError });
        }
        const sessionToken = await providerSessionToken(env, monitor.userId, monitor.providerSessionId);
        if (!sessionToken) return json({ error: `esim.gg 账号“${monitor.providerSessionLabel || "未指定"}”的登录会话未配置或已过期，请重新导入` }, 409);
        const order = await createUnpaidOrder(
          env,
          monitor,
          discovery,
          { ESIMGG_SESSION_TOKEN: sessionToken },
          { manual: true },
        );
        if (order.status !== "created" || !order.paymentUrl) {
          return json({ error: `支付链接生成失败：${order.error || "esim.gg 未返回支付链接"}` }, order.status === "failed" ? 502 : 409);
        }

        let emailSent = false;
        let emailError: string | null = null;
        try {
          await sendManualOrderEmail(env, monitor, discovery, order);
          emailSent = true;
        } catch (error) {
          emailError = error instanceof Error ? error.message : "邮件发送失败";
        }
        await env.DB.prepare("UPDATE discoveries SET notified_at = COALESCE(notified_at, ?) WHERE id = ?")
          .bind(new Date().toISOString(), discovery.id).run();
        return json({ order, reused: false, emailSent, emailError });
      } catch (error) {
        return json({ error: error instanceof Error ? error.message : "支付链接生成失败" }, 400);
      }
    }
  }

  if (request.method === "GET" && path.length === 1 && path[0] === "discoveries") {
    const limit = Math.min(Math.max(Number(url.searchParams.get("limit") || 50), 1), 200);
    const rows = await env.DB.prepare(
      `SELECT d.*, m.name AS monitor_name, o.status AS order_status, o.payment_url,
       o.provider_order_id, o.total AS order_total, o.currency AS order_currency, o.error AS order_error
       FROM discoveries d
       JOIN monitors m ON m.id = d.monitor_id
       LEFT JOIN orders o ON o.discovery_id = d.id
       WHERE m.user_id = ?
       ORDER BY d.last_seen_at DESC LIMIT ?`,
    )
      .bind(user.id, limit)
      .all();
    return json({ discoveries: rows.results });
  }

  if (request.method === "GET" && path.length === 1 && path[0] === "history") {
    return json({ history: [], storage: "browser", message: "查询历史仅保存在执行立即检查的浏览器中" });
  }

  if (request.method === "GET" && path.length === 1 && path[0] === "orders") {
    const limit = Math.min(Math.max(Number(url.searchParams.get("limit") || 50), 1), 200);
    const rows = await env.DB.prepare(
       `SELECT o.*, d.number, d.monitor_id, m.name AS monitor_name FROM orders o
       JOIN discoveries d ON d.id = o.discovery_id
       JOIN monitors m ON m.id = d.monitor_id WHERE m.user_id = ? ORDER BY o.created_at DESC LIMIT ?`,
    ).bind(user.id, limit).all();
    return json({ orders: rows.results });
  }

  if (request.method === "POST" && path.length === 1 && path[0] === "test-email") {
    const body = await readJson<{ to?: string }>(request);
    const to = body.to?.trim();
    if (!to || !isEmail(to)) return json({ error: "A valid recipient email is required" }, 400);
    const owned = await env.DB.prepare("SELECT 1 FROM monitors WHERE user_id = ? AND notify_email = ? LIMIT 1").bind(user.id, to).first();
    if (!owned) return json({ error: "只能测试当前账户监控任务使用的通知邮箱" }, 403);
    await sendResendEmail(env, {
      to,
      subject: "FreeSIM Watch test email",
      text: "Your Resend configuration is working.",
      html: "<p>Your Resend configuration is working.</p>",
      idempotencyKey: `test-${to}-${Date.now()}`,
    }, user.id);
    return json({ ok: true });
  }

  return json({ error: "Not found" }, 404);
}

function sameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  return !origin || origin === new URL(request.url).origin;
}

async function runDueChecks(env: Env): Promise<void> {
  const now = new Date();
  if (now.getUTCHours() === 0 && now.getUTCMinutes() === 0) {
    const catalogCutoff = new Date(now.getTime() - 30 * 24 * 60 * 60_000).toISOString();
    await env.DB.prepare("DELETE FROM global_number_inventory WHERE last_seen_at < ?").bind(catalogCutoff).run();
  }
  const { results } = await env.DB.prepare(
    `SELECT m.*, ps.label AS provider_session_label FROM monitors m
     LEFT JOIN provider_sessions ps ON ps.id = m.provider_session_id
     WHERE m.enabled = 1 ORDER BY m.created_at`,
  ).all<MonitorRow>();
  for (const row of results) {
    const monitor = rowToMonitor(row);
    const interval = monitor.intervalMinutes;
    if (monitor.lastCheckedAt && Date.now() - Date.parse(monitor.lastCheckedAt) < interval * 60_000) continue;
    await checkMonitor(env, monitor);
  }
}

async function checkMonitor(env: Env, monitor: Monitor): Promise<{ ok: boolean; candidates?: Candidate[]; error?: string; run: BrowserCheckRun }> {
  const checkedAt = new Date().toISOString();
  const runId = crypto.randomUUID();
  const rounds = Math.min(Math.max(Math.trunc(Number(monitor.filters.checkRounds ?? 1)), 1), 5);
  const delaySeconds = Math.min(Math.max(Number(monitor.filters.roundDelaySeconds ?? 1), 0), 10);
  const historyResults: CheckResultSnapshot[] = [];
  const catalogCandidates = new Map<string, Candidate>();
  let totalReturned = 0;
  let totalMatched = 0;
  try {
    const sessionToken = await providerSessionToken(env, monitor.userId, monitor.providerSessionId);
    if (!sessionToken) throw new Error(`esim.gg 账号“${monitor.providerSessionLabel || "未指定"}”的登录会话未配置或已过期，请重新导入`);
    const providerSecrets = { ESIMGG_SESSION_TOKEN: sessionToken };
    const candidateMap = new Map<string, Candidate>();
    const freshMap = new Map<string, Discovery>();
    const orderResults = new Map<string, OrderResult>();
    for (let round = 0; round < rounds; round += 1) {
      const response = await fetchWithTimeout(monitor, env, providerSecrets);
      if (!response.ok) throw new Error(`Upstream returned HTTP ${response.status}`);
      const text = await readLimitedText(response);
      const allRoundCandidates = parseAllCandidates(text, monitor.parser);
      const roundCandidates = allRoundCandidates.filter((candidate) => matchesFilter(candidate, monitor.filters));
      totalReturned += allRoundCandidates.length;
      totalMatched += roundCandidates.length;
      for (const candidate of allRoundCandidates) {
        catalogCandidates.set(candidate.number, candidate);
        historyResults.push({
          round_number: round + 1,
          number: candidate.number,
          listed_price: candidate.listedPrice,
          price: candidate.price,
          currency: candidate.currency,
          matched: matchesFilter(candidate, monitor.filters) ? 1 : 0,
          purchase_url: candidate.purchaseUrl,
        });
      }

      for (const candidate of roundCandidates) {
        const candidateKey = `${candidate.number}|${candidate.price ?? ""}|${candidate.currency ?? ""}`;
        candidateMap.set(candidateKey, candidate);
        const fingerprint = await createFingerprint(candidate, monitor.id);
        const now = new Date().toISOString();
        const existing = await env.DB.prepare(
          "SELECT * FROM discoveries WHERE monitor_id = ? AND fingerprint = ?",
        )
          .bind(monitor.id, fingerprint)
          .first<DiscoveryRow>();

        if (existing) {
          const staleAt = new Date(Date.now() - 24 * 60 * 60_000).toISOString();
          await env.DB.prepare("UPDATE discoveries SET last_seen_at = ? WHERE id = ? AND last_seen_at < ?")
            .bind(now, existing.id, staleAt)
            .run();
          if (!existing.notified_at && !freshMap.has(existing.id)) {
            freshMap.set(existing.id, rowToDiscovery(existing, candidate.raw, now));
          }
        } else {
          const discovery: Discovery = {
            id: crypto.randomUUID(),
            monitorId: monitor.id,
            fingerprint,
            number: candidate.number,
            price: candidate.price,
            currency: candidate.currency,
            purchaseUrl: candidate.purchaseUrl,
            raw: candidate.raw,
            firstSeenAt: now,
            lastSeenAt: now,
            notifiedAt: null,
          };
          await env.DB.prepare(
            `INSERT INTO discoveries
             (id, monitor_id, fingerprint, number, price, currency, purchase_url, raw_json,
              first_seen_at, last_seen_at, notified_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
          )
            .bind(
              discovery.id,
              discovery.monitorId,
              discovery.fingerprint,
              discovery.number,
              discovery.price,
              discovery.currency,
              discovery.purchaseUrl,
              JSON.stringify(discovery.raw),
              discovery.firstSeenAt,
              discovery.lastSeenAt,
            )
            .run();
          freshMap.set(discovery.id, discovery);
        }
      }

      if (round + 1 < rounds && delaySeconds > 0) {
        await sleep(delaySeconds * 1000);
      }
    }

    const candidates = [...candidateMap.values()];
    const fresh = [...freshMap.values()];
    await updateGlobalNumberInventory(env.DB, [...catalogCandidates.values()]);

    if (fresh.length > 0) {
      let createdOrder = false;
      if (monitor.action?.enabled) {
        let remainingOrderAttempts = monitor.action.maxOrdersPerCheck ?? 1;
        for (const item of fresh) {
          if (remainingOrderAttempts <= 0) {
            orderResults.set(item.id, skippedOrder("Automatic-order limit reached for this check"));
            continue;
          }
          remainingOrderAttempts -= 1;
          const result = await createUnpaidOrder(env, monitor, item, providerSecrets);
          orderResults.set(item.id, result);
          if (result.status === "created") createdOrder = true;
        }
      }
      await sendDiscoveryEmail(env, monitor, fresh, orderResults);
      const notifiedAt = new Date().toISOString();
      for (const item of fresh) {
        await env.DB.prepare("UPDATE discoveries SET notified_at = ? WHERE id = ?")
          .bind(notifiedAt, item.id)
          .run();
      }
      if (createdOrder && monitor.action?.disableMonitorAfterOrder !== false) {
        await env.DB.prepare("UPDATE monitors SET enabled = 0, updated_at = ? WHERE id = ?")
          .bind(new Date().toISOString(), monitor.id)
          .run();
      }
    }

    await env.DB.prepare("UPDATE monitors SET last_checked_at = ?, last_error = NULL WHERE id = ?")
      .bind(checkedAt, monitor.id)
      .run();
    return {
      ok: true,
      candidates,
      run: {
        id: runId, monitor_id: monitor.id, monitor_name: monitor.name, started_at: checkedAt,
        finished_at: new Date().toISOString(), rounds, status: "success",
        candidate_count: totalReturned, matched_count: totalMatched, error: null, results: historyResults,
      },
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown check error";
    if (catalogCandidates.size) {
      try { await updateGlobalNumberInventory(env.DB, [...catalogCandidates.values()]); }
      catch (catalogError) { console.error("Failed to preserve partial global catalog results", catalogError); }
    }
    await env.DB.prepare("UPDATE monitors SET last_checked_at = ?, last_error = ? WHERE id = ?")
      .bind(checkedAt, message.slice(0, 500), monitor.id)
      .run();
    return {
      ok: false,
      error: message,
      run: {
        id: runId, monitor_id: monitor.id, monitor_name: monitor.name, started_at: checkedAt,
        finished_at: new Date().toISOString(), rounds, status: "error",
        candidate_count: totalReturned, matched_count: totalMatched, error: message.slice(0, 500), results: historyResults,
      },
    };
  }
}

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function updateGlobalNumberInventory(db: D1Database, candidates: Candidate[]): Promise<void> {
  if (!candidates.length) return;
  const seenAt = new Date().toISOString();
  const refreshBefore = new Date(Date.now() - 24 * 60 * 60_000).toISOString();
  const statements = candidates.map((candidate) => db.prepare(
    `INSERT INTO global_number_inventory (number, listed_price, price, currency, last_seen_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT (number) DO UPDATE SET
       listed_price = excluded.listed_price,
       price = excluded.price,
       currency = excluded.currency,
       last_seen_at = excluded.last_seen_at
     WHERE global_number_inventory.listed_price IS NOT excluded.listed_price
        OR global_number_inventory.price IS NOT excluded.price
        OR global_number_inventory.currency IS NOT excluded.currency
        OR global_number_inventory.last_seen_at < ?`,
  ).bind(candidate.number, candidate.listedPrice, candidate.price, candidate.currency, seenAt, refreshBefore));
  for (let index = 0; index < statements.length; index += 50) {
    await db.batch(statements.slice(index, index + 50));
  }
}

async function sendDiscoveryEmail(
  env: Env,
  monitor: Monitor,
  items: Discovery[],
  orders: Map<string, OrderResult>,
): Promise<void> {
  const message = buildDiscoveryEmail(env.PUBLIC_ORIGIN, monitor, items, orders);
  await sendResendEmail(env, {
    to: monitor.notifyEmail,
    ...message,
    idempotencyKey: `discovery-${monitor.id}-${items.map((item) => item.fingerprint).join("-")}`.slice(0, 256),
  }, monitor.userId);
}

async function sendManualOrderEmail(env: Env, monitor: Monitor, item: Discovery, order: OrderResult): Promise<void> {
  if (!order.paymentUrl) throw new Error("支付链接为空");
  const message = buildManualOrderEmail(monitor, item, order);
  await sendResendEmail(env, {
    to: monitor.notifyEmail,
    ...message,
    idempotencyKey: `manual-order-${item.fingerprint}`.slice(0, 256),
  }, monitor.userId);
}

async function sendMonitorCreatedEmail(env: Env, monitor: Pick<Monitor, "id" | "name" | "notifyEmail" | "intervalMinutes" | "filters">): Promise<void> {
  const message = buildMonitorCreatedEmail(monitor);
  await sendResendEmail(env, {
    to: monitor.notifyEmail,
    ...message,
    idempotencyKey: `monitor-created-${monitor.id}`.slice(0, 256),
  });
}

export function buildMonitorCreatedEmail(monitor: Pick<Monitor, "name" | "notifyEmail" | "intervalMinutes" | "filters">): { subject: string; text: string; html: string } {
  const taskName = emailMonitorName(monitor.name);
  const rule = emailPriceRule(monitor);
  const interval = `${monitor.intervalMinutes} 分钟`;
  const text = [
    "FreeSIM Watch 监控任务已创建",
    `任务名称：${taskName}`,
    `通知邮箱：${monitor.notifyEmail}`,
    `检查频率：每 ${interval}`,
    `价格规则：${rule}`,
    "",
    "这是一封测试邮件，用于确认监控创建后的通知链路可以正常到达。后续发现符合条件的号码时，FreeSIM Watch 会继续发送通知。",
  ].join("\n");
  return {
    subject: "[FreeSIM Watch] 监控任务已创建",
    text,
    html: emailShell({
      preheader: `监控任务“${taskName}”已创建，通知邮箱链路测试成功`,
      eyebrow: "MONITOR READY",
      title: "监控任务已创建",
      lead: "这是一封测试邮件，用于确认创建任务后的通知链路可以正常到达。",
      summary: `<table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr><td style="padding:0 8px 0 0;width:50%;vertical-align:top"><div class="email-summary-card" style="padding:14px 16px;border:1px solid #dedee3;border-radius:12px;background:#f7f7f8"><div class="email-summary-label" style="color:#6e6e76;font-size:11px;line-height:1.4">监控任务</div><div class="email-summary-value" style="margin-top:5px;color:#1d1d1f;font-size:14px;font-weight:700;line-height:1.5">${escapeHtml(taskName)}</div></div></td><td style="padding:0 0 0 8px;width:50%;vertical-align:top"><div class="email-summary-card" style="padding:14px 16px;border:1px solid #dedee3;border-radius:12px;background:#f7f7f8"><div class="email-summary-label" style="color:#6e6e76;font-size:11px;line-height:1.4">通知邮箱</div><div class="email-summary-value" style="margin-top:5px;color:#1d1d1f;font-size:14px;font-weight:700;line-height:1.5;overflow-wrap:anywhere">${escapeHtml(monitor.notifyEmail)}</div></div></td></tr></table>`,
      content: `<div class="email-number-card" style="margin-top:14px;padding:18px;border:1px solid #dedee3;border-radius:14px;background:#fafafa"><div class="email-kicker" style="color:#6e6e76;font-size:10px;font-weight:700;letter-spacing:.08em;line-height:1.4">CONFIGURATION</div><div class="email-number" style="margin-top:5px;color:#171719;font-size:16px;font-weight:700;line-height:1.5">每 ${escapeHtml(interval)}检查一次</div><div class="email-total" style="margin-top:5px;color:#62626a;font-size:12px;line-height:1.5">价格规则：${escapeHtml(rule)}</div><div class="email-card-divider" style="margin-top:14px;padding-top:14px;border-top:1px solid #dedee3"><span class="email-status-success" style="color:#147a3a;font-size:12px;font-weight:700">通知链路测试成功</span></div></div>`,
    }),
  };
}

export function buildDiscoveryEmail(
  publicOrigin: string,
  monitor: Monitor,
  items: Discovery[],
  orders: Map<string, OrderResult>,
): { subject: string; text: string; html: string } {
  const visibleItems = items.slice(0, 50);
  const taskName = emailMonitorName(monitor.name);
  const rule = emailPriceRule(monitor);
  const cards = visibleItems.map((item) => {
    const order = orders.get(item.id);
    const controlUrl = emailSearchUrl(publicOrigin, monitor.id, item.number);
    return emailNumberCard(item, order, order?.paymentUrl || controlUrl, order?.paymentUrl ? "查看并支付" : "在控制台生成支付链接");
  }).join("");
  const text = [
    `FreeSIM Watch 发现 ${items.length} 个符合价格条件的号码`,
    `监控任务：${taskName}`,
    `价格规则：${rule}`,
    "",
    ...visibleItems.map((item) => {
      const order = orders.get(item.id);
      const price = item.price === null ? "价格未知" : formatMoney(item.price, item.currency);
      const total = order?.total === null || order?.total === undefined ? "" : `，待支付总额 ${formatMoney(order.total, order.currency || item.currency)}`;
      const status = order?.status === "failed" ? `，创建订单失败：${order.error || "未知错误"}` : order?.paymentUrl ? "，待支付订单已生成" : "，等待手动选择";
      return `${item.number}｜号码费 ${price}${total}${status}\n${order?.paymentUrl || emailSearchUrl(publicOrigin, monitor.id, item.number)}`;
    }),
    "",
    "号码可用性和最终金额可能变化，请在 Stripe 页面人工核对后再付款。",
  ].join("\n");
  return {
    subject: `[FreeSIM Watch] 发现 ${items.length} 个符合价格条件的号码`,
    text,
    html: emailShell({
      preheader: `发现 ${items.length} 个符合 ${rule} 的号码`,
      eyebrow: "PRICE MATCH",
      title: "发现符合价格条件的号码",
      lead: `本轮监控发现 ${items.length} 个符合规则的号码。已生成订单的号码可直接查看支付链接，其余号码可回到控制台手动选择。`,
      summary: `<table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr><td style="padding:0 8px 0 0;width:50%;vertical-align:top"><div class="email-summary-card" style="padding:14px 16px;border:1px solid #dedee3;border-radius:12px;background:#f7f7f8"><div class="email-summary-label" style="color:#6e6e76;font-size:11px;line-height:1.4">监控任务</div><div class="email-summary-value" style="margin-top:5px;color:#1d1d1f;font-size:14px;font-weight:700;line-height:1.5">${escapeHtml(taskName)}</div></div></td><td style="padding:0 0 0 8px;width:50%;vertical-align:top"><div class="email-summary-card" style="padding:14px 16px;border:1px solid #dedee3;border-radius:12px;background:#f7f7f8"><div class="email-summary-label" style="color:#6e6e76;font-size:11px;line-height:1.4">价格规则</div><div class="email-summary-accent" style="margin-top:5px;color:#147a3a;font-size:14px;font-weight:700;line-height:1.5">${escapeHtml(rule)}</div></div></td></tr></table>`,
      content: cards,
    }),
  };
}

export function buildManualOrderEmail(monitor: Monitor, item: Discovery, order: OrderResult): { subject: string; text: string; html: string } {
  if (!order.paymentUrl) throw new Error("支付链接为空");
  const taskName = emailMonitorName(monitor.name);
  const price = item.price === null ? "未知" : formatMoney(item.price, item.currency);
  const total = order.total === null ? "" : `，待支付总额 ${formatMoney(order.total, order.currency || item.currency)}`;
  return {
    subject: `[FreeSIM Watch] ${item.number} 的待支付链接已生成`,
    text: `FreeSIM Watch 待支付链接已生成\n监控任务：${taskName}\n号码：${item.number}\n最近号码费：${price}${total}\n\n请人工核对金额并完成付款：\n${order.paymentUrl}\n\n本工具不会自动付款。`,
    html: emailShell({
      preheader: `${item.number} 的待支付链接已生成`,
      eyebrow: "ORDER READY",
      title: "待支付链接已生成",
      lead: "订单已创建，但尚未付款。请打开 Stripe，再次核对号码和总金额后由你手动完成。",
      summary: `<div class="email-summary-card" style="padding:14px 16px;border:1px solid #dedee3;border-radius:12px;background:#f7f7f8"><div class="email-summary-label" style="color:#6e6e76;font-size:11px;line-height:1.4">监控任务</div><div class="email-summary-value" style="margin-top:5px;color:#1d1d1f;font-size:14px;font-weight:700;line-height:1.5">${escapeHtml(taskName)}</div></div>`,
      content: emailNumberCard(item, order, order.paymentUrl, "打开 Stripe 并核对付款"),
    }),
  };
}

function emailMonitorName(name: string): string {
  return name === "esim.gg Estonia 免费号码" ? "esim.gg Estonia 号码监控" : name;
}

function emailPriceRule(monitor: { action?: OrderActionConfig | null; filters: FilterConfig }): string {
  const limit = Number(monitor.action?.maxCandidatePrice ?? monitor.filters.maxPrice ?? 0);
  const currency = monitor.filters.currency || "EUR";
  if (!Number.isFinite(limit)) return "符合任务设置";
  return limit <= 0 ? `号码费 ${formatMoney(0, currency)}` : `号码费不高于 ${formatMoney(limit, currency)}`;
}

function emailSearchUrl(publicOrigin: string, monitorId: string, number: string): string {
  const fallback = "https://example.invalid";
  let url: URL;
  try { url = new URL("/search", publicOrigin); }
  catch { url = new URL("/search", fallback); }
  url.searchParams.set("monitorId", monitorId);
  url.searchParams.set("number", number);
  return url.toString();
}

function emailNumberCard(item: Discovery, order: OrderResult | undefined, link: string, actionLabel: string): string {
  const price = item.price === null ? "价格未知" : formatMoney(item.price, item.currency);
  const total = order?.total === null || order?.total === undefined ? "" : `<div class="email-total" style="margin-top:5px;color:#62626a;font-size:12px;line-height:1.5">待支付总额 ${escapeHtml(formatMoney(order.total, order.currency || item.currency))}</div>`;
  const failed = order?.status === "failed";
  const status = failed ? "订单生成失败" : order?.paymentUrl ? "待支付订单已生成" : "等待手动选择";
  const statusClass = failed ? "email-status-error" : order?.paymentUrl ? "email-status-success" : "email-status-neutral";
  const statusColor = failed ? "#b42318" : order?.paymentUrl ? "#147a3a" : "#5f5f67";
  const error = failed && order?.error ? `<div class="email-error" style="margin-top:12px;padding:10px 12px;border-radius:9px;background:#fff0ef;color:#b42318;font-size:11px;line-height:1.6">${escapeHtml(order.error)}</div>` : "";
  return `<div class="email-number-card" style="margin-top:14px;padding:18px;border:1px solid #dedee3;border-radius:14px;background:#fafafa"><table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr><td style="vertical-align:top"><div class="email-kicker" style="color:#6e6e76;font-size:10px;font-weight:700;letter-spacing:.08em;line-height:1.4">ESTONIA · +372</div><div class="email-number" style="margin-top:5px;color:#171719;font-family:SFMono-Regular,Consolas,monospace;font-size:20px;font-weight:700;line-height:1.35;word-break:break-word">${escapeHtml(item.number)}</div></td><td style="padding-left:12px;text-align:right;vertical-align:top"><div class="email-price-label" style="color:#6e6e76;font-size:10px;line-height:1.4">号码费</div><div class="email-price" style="margin-top:4px;color:#171719;font-size:18px;font-weight:700;line-height:1.35">${escapeHtml(price)}</div>${total}</td></tr></table><div class="email-card-divider" style="margin-top:14px;padding-top:14px;border-top:1px solid #dedee3"><span class="${statusClass}" style="color:${statusColor};font-size:12px;font-weight:700">${status}</span></div>${error}<div style="margin-top:16px"><a class="email-action" href="${escapeHtml(link)}" style="display:block;padding:13px 16px;border-radius:999px;background:#171719;color:#ffffff;font-size:13px;font-weight:700;line-height:1.3;text-align:center;text-decoration:none">${actionLabel}</a></div></div>`;
}

function emailShell(input: { preheader: string; eyebrow: string; title: string; lead: string; summary: string; content: string }): string {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light dark"><meta name="supported-color-schemes" content="light dark"><style>:root{color-scheme:light dark;supported-color-schemes:light dark}@media (prefers-color-scheme:dark){.email-body,.email-bg{background:#0d0d0f!important}.email-shell{background:#111113!important;border-color:#2d2d31!important}.email-divider{border-color:#2d2d31!important}.email-logo{background:#f5f5f7!important;color:#171719!important}.email-brand,.email-title,.email-number,.email-price{color:#ffffff!important}.email-subtitle,.email-summary-label,.email-kicker,.email-price-label,.email-footer{color:#8f8f98!important}.email-lead{color:#aaaab1!important}.email-eyebrow,.email-summary-accent,.email-status-success{color:#76e39a!important}.email-summary-card{background:#18181a!important;border-color:#333337!important}.email-summary-value{color:#f5f5f7!important}.email-number-card{background:#1b1b1e!important;border-color:#333337!important}.email-total{color:#a8a8af!important}.email-card-divider{border-color:#333337!important}.email-status-neutral{color:#b8b8bf!important}.email-status-error{color:#ff8b87!important}.email-error{background:#351615!important;color:#ffaaa7!important}.email-action{background:#ffffff!important;color:#171719!important}.email-notice{background:#16231a!important;color:#b7c9bd!important;border-color:#76e39a!important}}</style></head><body class="email-body" style="margin:0;padding:0;background:#f5f5f7"><div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent">${escapeHtml(input.preheader)}</div><table class="email-bg" role="presentation" width="100%" cellspacing="0" cellpadding="0" style="width:100%;background:#f5f5f7"><tr><td align="center" style="padding:24px 12px"><table class="email-shell" role="presentation" width="620" cellspacing="0" cellpadding="0" style="width:100%;max-width:620px;border:1px solid #d9d9de;border-radius:20px;background:#ffffff"><tr><td class="email-divider" style="padding:22px 24px;border-bottom:1px solid #e5e5e7"><table role="presentation" cellspacing="0" cellpadding="0"><tr><td class="email-logo" style="width:34px;height:34px;border-radius:10px;background:#171719;color:#ffffff;font-family:Arial,sans-serif;font-size:12px;font-weight:800;text-align:center;vertical-align:middle">FS</td><td style="padding-left:11px"><div class="email-brand" style="color:#1d1d1f;font-family:Arial,'Microsoft YaHei',sans-serif;font-size:15px;font-weight:700;line-height:1.3">FreeSIM Watch</div><div class="email-subtitle" style="margin-top:2px;color:#74747c;font-family:Arial,sans-serif;font-size:9px;font-weight:700;letter-spacing:.12em;line-height:1.3">ESIM.GG NUMBER OPERATIONS</div></td></tr></table></td></tr><tr><td style="padding:32px 24px 28px;font-family:Arial,'Microsoft YaHei',sans-serif"><div class="email-eyebrow" style="color:#147a3a;font-size:10px;font-weight:800;letter-spacing:.14em;line-height:1.4">${escapeHtml(input.eyebrow)}</div><h1 class="email-title" style="margin:8px 0 0;color:#171719;font-size:28px;line-height:1.25;letter-spacing:-.03em">${escapeHtml(input.title)}</h1><p class="email-lead" style="margin:12px 0 0;color:#62626a;font-size:14px;line-height:1.75">${escapeHtml(input.lead)}</p><div style="margin-top:22px">${input.summary}</div><div style="margin-top:8px">${input.content}</div><div class="email-notice" style="margin-top:24px;padding:16px;border-left:3px solid #178342;border-radius:0 10px 10px 0;background:#edf8f0;color:#3f5f49;font-size:12px;line-height:1.7">号码可用性与订单金额具有时效性。FreeSIM Watch 只创建待支付订单，不会自动打开支付页或完成付款。</div></td></tr><tr><td class="email-divider email-footer" style="padding:18px 24px;border-top:1px solid #e5e5e7;color:#6e6e76;font-family:Arial,'Microsoft YaHei',sans-serif;font-size:10px;line-height:1.7">这封邮件由你的 FreeSIM Watch 监控任务自动发送。请勿直接回复，也不要向任何人分享 Stripe 支付链接或账号凭据。</td></tr></table></td></tr></table></body></html>`;
}

async function createUnpaidOrder(
  env: Env,
  monitor: Monitor,
  discovery: Discovery,
  providerSecrets: Record<string, string>,
  options: { manual?: boolean } = {},
): Promise<OrderResult> {
  const action = monitor.action;
  if (!action?.enabled) return skippedOrder("Automatic order creation is disabled");
  if (!action.unpaidOnlyAcknowledged) return skippedOrder("Unpaid-only acknowledgement is required");
  if (discovery.price === null) return skippedOrder("Candidate price is unknown");
  if (!options.manual && discovery.price > (action.maxCandidatePrice ?? 0)) return skippedOrder("Candidate price exceeds the automatic-order limit");

  const existing = await env.DB.prepare("SELECT * FROM orders WHERE discovery_id = ?").bind(discovery.id).first<OrderRow>();
  if (existing) return rowToOrderResult(existing);

  if (!options.manual) {
    const cooldownMinutes = Math.min(Math.max(action.cooldownMinutes ?? 30, 1), 1440);
    const since = new Date(Date.now() - cooldownMinutes * 60_000).toISOString();
    const recent = await env.DB.prepare(
      `SELECT o.id FROM orders o JOIN discoveries d ON d.id = o.discovery_id
       WHERE d.monitor_id = ? AND o.status IN ('pending', 'created') AND o.created_at >= ? LIMIT 1`,
    ).bind(monitor.id, since).first<{ id: string }>();
    if (recent) return skippedOrder(`Another order was created within the ${cooldownMinutes}-minute cooldown`);
  }

  const now = new Date().toISOString();
  const orderId = crypto.randomUUID();
  const inserted = await env.DB.prepare(
    `INSERT OR IGNORE INTO orders
     (id, discovery_id, provider_order_id, status, payment_url, total, currency, error, created_at, updated_at)
     VALUES (?, ?, NULL, 'pending', NULL, NULL, NULL, NULL, ?, ?)`,
  ).bind(orderId, discovery.id, now, now).run();
  if (!inserted.meta.changes) {
    const racedOrder = await env.DB.prepare("SELECT * FROM orders WHERE discovery_id = ?").bind(discovery.id).first<OrderRow>();
    return racedOrder ? rowToOrderResult(racedOrder) : skippedOrder("Order attempt already exists");
  }

  try {
    const variables: Record<string, string> = {
      number: discovery.number,
      numberEncoded: encodeURIComponent(discovery.number),
      price: String(discovery.price),
      currency: discovery.currency || "",
      fingerprint: discovery.fingerprint,
      discoveryId: discovery.id,
    };
    const url = validateTargetUrl(resolveTemplate(action.url, variables, env, providerSecrets));
    const headers = new Headers();
    for (const [key, value] of Object.entries(action.headers || {})) {
      headers.set(key, resolveTemplate(value, variables, env, providerSecrets));
    }
    if (!headers.has("content-type")) headers.set("content-type", "application/json");
    if (!headers.has("idempotency-key")) headers.set("idempotency-key", discovery.fingerprint);
    headers.set("user-agent", env.CHECK_USER_AGENT || "freesim-watch/0.1.0 (+open-source monitor)");

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 20_000);
    let response: Response;
    try {
      response = await fetch(url, {
        method: action.method || "POST",
        headers,
        body: resolveTemplate(action.bodyTemplate, variables, env, providerSecrets),
        redirect: "manual",
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }
    const responseText = await readLimitedText(response);
    if (!response.ok) throw new Error(`Order endpoint returned HTTP ${response.status}: ${responseText.slice(0, 240)}`);
    const data: unknown = JSON.parse(responseText);
    const paymentUrl = normalizeUrl(getPath(data, action.paymentUrlPath));
    if (!paymentUrl) throw new Error("Order response did not contain a valid payment URL");
    const providerOrderId = normalizeString(action.orderIdPath ? getPath(data, action.orderIdPath) : undefined);
    const total = action.totalPath ? parsePrice(getPath(data, action.totalPath)) : null;
    const currency = normalizeString(action.currencyPath ? getPath(data, action.currencyPath) : undefined);
    await env.DB.prepare(
      `UPDATE orders SET provider_order_id = ?, status = 'created', payment_url = ?, total = ?,
       currency = ?, updated_at = ? WHERE id = ?`,
    ).bind(providerOrderId, paymentUrl, total, currency, new Date().toISOString(), orderId).run();
    return { status: "created", paymentUrl, providerOrderId, total, currency, error: null };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown order error";
    await env.DB.prepare("UPDATE orders SET status = 'failed', error = ?, updated_at = ? WHERE id = ?")
      .bind(message.slice(0, 500), new Date().toISOString(), orderId).run();
    return { status: "failed", paymentUrl: null, providerOrderId: null, total: null, currency: null, error: message };
  }
}

export function resolveTemplate(template: string, variables: Record<string, string>, env: Env, secretOverrides?: Record<string, string>): string {
  return template
    .replace(/\{\{secret:([A-Z][A-Z0-9_]{2,63})\}\}/g, (_match, name: string) => {
      const value = secretOverrides === undefined
        ? (env as unknown as Record<string, unknown>)[name]
        : secretOverrides[name];
      if (typeof value !== "string" || !value) throw new Error(`Missing provider secret: ${name}`);
      return value;
    })
    .replace(/\{\{([A-Za-z][A-Za-z0-9]*)\}\}/g, (_match, name: string) => {
      if (!(name in variables)) throw new Error(`Unknown template variable: ${name}`);
      return variables[name];
    });
}

function skippedOrder(error: string): OrderResult {
  return { status: "skipped", paymentUrl: null, providerOrderId: null, total: null, currency: null, error };
}

async function sendResendEmail(
  env: Env,
  message: { to: string; subject: string; text: string; html: string; idempotencyKey: string },
  _userId?: string,
): Promise<void> {
  const keys = await loadResendApiKeys(env);
  if (!keys.length) throw new Error("没有可用的 Resend API Key，请联系管理员配置");
  const failures: string[] = [];
  for (const candidate of keys) {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        authorization: `Bearer ${candidate.apiKey}`,
        "content-type": "application/json",
        "user-agent": "freesim-watch/0.1.0",
        "idempotency-key": message.idempotencyKey,
      },
      body: JSON.stringify({ from: candidate.fromAddress, to: [message.to], subject: message.subject, html: message.html, text: message.text }),
    });
    if (response.ok) {
      await recordResendSuccess(env, candidate.id);
      return;
    }
    const detail = (await response.text()).slice(0, 300);
    const rotate = shouldRotateResendKey(response.status);
    await recordResendFailure(env, candidate.id, response.status, detail, rotate);
    failures.push(`${candidate.id === "legacy-env" ? "默认 Key" : candidate.id.slice(0, 8)} HTTP ${response.status}`);
    if (!rotate) throw new Error(`Resend returned HTTP ${response.status}: ${detail}`);
  }
  throw new Error(`所有 Resend API Key 均发送失败（${failures.join("，")}）`);
}

async function fetchWithTimeout(monitor: Monitor, env: Env, providerSecrets: Record<string, string>): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20_000);
  try {
    const headers = new Headers();
    for (const [key, value] of Object.entries(monitor.headers)) {
      headers.set(key, resolveTemplate(value, {}, env, providerSecrets));
    }
    headers.set("user-agent", env.CHECK_USER_AGENT || "freesim-watch/0.1.0 (+open-source monitor)");
    return await fetch(monitor.url, {
      method: monitor.method,
      headers,
      body: monitor.method === "POST" ? monitor.body || undefined : undefined,
      redirect: "manual",
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

export function normalizeNumberSearchInput(input: NumberSearchInput): Required<NumberSearchInput> {
  if (!input || typeof input !== "object") throw new Error("Invalid search payload");
  const query = String(input.query || "").trim();
  if (query.length > 40 || !/^[0-9+()\s-]*$/.test(query)) {
    throw new Error("query may only contain phone-number characters and must be <= 40 characters");
  }
  const minPrice = input.minPrice === null || input.minPrice === undefined ? null : Number(input.minPrice);
  const maxPrice = input.maxPrice === null || input.maxPrice === undefined ? null : Number(input.maxPrice);
  if (minPrice !== null && (!Number.isFinite(minPrice) || minPrice < 0)) throw new Error("minPrice must be zero or greater");
  if (maxPrice !== null && (!Number.isFinite(maxPrice) || maxPrice < 0)) throw new Error("maxPrice must be zero or greater");
  if (minPrice !== null && maxPrice !== null && minPrice > maxPrice) throw new Error("minPrice cannot exceed maxPrice");
  const currency = String(input.currency || "").trim().toUpperCase();
  if (currency && !/^[A-Z]{3}$/.test(currency)) throw new Error("currency must be a three-letter code");
  const limit = Math.min(Math.max(Math.trunc(Number(input.limit || 100)), 1), 200);
  return { query, minPrice, maxPrice, currency, limit };
}

export function normalizeManualOrderInput(input: ManualOrderInput): { number: string; expectedPrice: number; acknowledged: true } {
  if (!input || typeof input !== "object") throw new Error("Invalid order payload");
  const number = String(input.number || "").trim();
  if (!number || number.length > 40 || !/^[0-9+()\s-]+$/.test(number)) {
    throw new Error("号码格式无效");
  }
  if (input.expectedPrice === null || input.expectedPrice === undefined || input.expectedPrice === "") {
    throw new Error("号码价格无效，请刷新后重试");
  }
  const expectedPrice = Number(input.expectedPrice);
  if (!Number.isFinite(expectedPrice) || expectedPrice < 0) throw new Error("号码价格无效，请刷新后重试");
  if (input.acknowledged !== true) throw new Error("请确认最终付款仍由你手动完成");
  return { number, expectedPrice, acknowledged: true };
}

export function normalizeNumberRankingInput(input: NumberRankingInput): NormalizedNumberRankingInput {
  if (!input || typeof input !== "object") throw new Error("Invalid ranking parameters");
  const order = String(input.order || "asc").trim().toLowerCase();
  if (order !== "asc" && order !== "desc") throw new Error("order must be asc or desc");
  const rawLimit = input.limit === null || input.limit === undefined || input.limit === "" ? 100 : Number(input.limit);
  if (!Number.isFinite(rawLimit) || rawLimit <= 0) throw new Error("limit must be a positive number");
  return { order, limit: Math.min(Math.max(Math.trunc(rawLimit), 1), 200) };
}

async function listNumberRanking(db: D1Database, input: NormalizedNumberRankingInput) {
  const order = input.order === "desc" ? "DESC" : "ASC";
  const rows = await db.prepare(
    `SELECT number, listed_price AS listedPrice, price, currency, last_seen_at AS lastSeenAt
     FROM global_number_inventory
     WHERE price IS NOT NULL
     ORDER BY price ${order}, last_seen_at DESC, number ASC
     LIMIT ?`,
  ).bind(input.limit).all<NumberInventoryView>();
  const stats = await db.prepare(
    `SELECT COUNT(*) AS total,
       SUM(CASE WHEN price = 0 THEN 1 ELSE 0 END) AS freeCount,
       MIN(price) AS lowestPrice,
       MAX(last_seen_at) AS latestSeenAt
     FROM global_number_inventory WHERE price IS NOT NULL`,
  ).first<NumberRankingStats>();

  return {
    entries: rows.results,
    stats: {
      total: Number(stats?.total || 0),
      freeCount: Number(stats?.freeCount || 0),
      lowestPrice: stats?.lowestPrice ?? null,
      latestSeenAt: stats?.latestSeenAt ?? null,
    },
  };
}

async function searchNumberInventory(db: D1Database, input: Required<NumberSearchInput>) {
  const where = ["1 = 1"];
  const bindings: Array<string | number> = [];
  const queryDigits = input.query.replace(/\D/g, "");
  if (queryDigits) {
    where.push(`REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(number, ' ', ''), '+', ''), '-', ''), '(', ''), ')', '') LIKE ?`);
    bindings.push(`%${queryDigits}%`);
  }
  if (input.currency) {
    where.push("UPPER(currency) = ?");
    bindings.push(input.currency);
  }
  if (input.minPrice !== null) {
    where.push("price >= ?");
    bindings.push(input.minPrice);
  }
  if (input.maxPrice !== null) {
    where.push("price <= ?");
    bindings.push(input.maxPrice);
  }

  const fields = `number, listed_price AS listedPrice, price, currency, last_seen_at AS lastSeenAt`;
  const condition = where.join(" AND ");
  const rows = await db.prepare(
    `SELECT ${fields} FROM global_number_inventory WHERE ${condition}
     ORDER BY price IS NULL ASC, price ASC, last_seen_at DESC LIMIT ?`,
  ).bind(...bindings, input.limit).all<NumberInventoryView>();
  const count = await db.prepare(
    `SELECT COUNT(*) AS total FROM global_number_inventory WHERE ${condition}`,
  ).bind(...bindings).first<{ total: number }>();

  const recommendationWhere = ["last_seen_at >= ?", "price IS NOT NULL"];
  const recommendationBindings: Array<string | number> = [
    new Date(Date.now() - 7 * 24 * 60 * 60_000).toISOString(),
  ];
  if (input.currency) {
    recommendationWhere.push("UPPER(currency) = ?");
    recommendationBindings.push(input.currency);
  }
  const recommended = await db.prepare(
    `SELECT ${fields} FROM global_number_inventory WHERE ${recommendationWhere.join(" AND ")}
     ORDER BY CASE WHEN price = 0 THEN 0 ELSE 1 END ASC, price ASC, last_seen_at DESC
     LIMIT 12`,
  ).bind(...recommendationBindings).all<NumberInventoryView>();

  return { total: Number(count?.total || 0), results: rows.results, recommended: recommended.results };
}

export function parseCandidates(text: string, parser: ParserConfig, filters: FilterConfig): Candidate[] {
  return parseAllCandidates(text, parser).filter((candidate) => matchesFilter(candidate, filters));
}

function parseAllCandidates(text: string, parser: ParserConfig): Candidate[] {
  const format = parser.format || "json";
  return format === "text" ? parseTextCandidates(text, parser) : parseJsonCandidates(text, parser);
}

function matchesFilter(candidate: Candidate, filters: FilterConfig): boolean {
  if (!candidate.number) return false;
  if (filters.numberPrefix && !candidate.number.startsWith(filters.numberPrefix)) return false;
  if (filters.currency && candidate.currency && candidate.currency !== filters.currency) return false;
  if (filters.freeOnly && (candidate.price === null || candidate.price > (filters.maxPrice ?? 0))) return false;
  if (filters.maxPrice !== undefined && (candidate.price === null || candidate.price > filters.maxPrice)) return false;
  return true;
}

function parseJsonCandidates(text: string, parser: ParserConfig): Candidate[] {
  const data: unknown = JSON.parse(text);
  const itemsValue = parser.itemsPath ? getPath(data, parser.itemsPath) : data;
  const items = Array.isArray(itemsValue) ? itemsValue : [itemsValue];
  return items.flatMap((item) => {
    if (item === null || item === undefined) return [];
    const numberValue = parser.numberPath ? getPath(item, parser.numberPath) : item;
    const number = normalizeNumber(numberValue);
    if (!number) return [];
    const rawPrice = parsePrice(parser.pricePath ? getPath(item, parser.pricePath) : undefined);
    const priceSubtract = Number.isFinite(parser.priceSubtract) ? Math.max(parser.priceSubtract || 0, 0) : 0;
    return [{
      number,
      listedPrice: rawPrice,
      price: rawPrice === null ? null : Math.max(0, rawPrice - priceSubtract),
      currency: normalizeString(parser.currencyPath ? getPath(item, parser.currencyPath) : undefined) || normalizeString(parser.currencyValue),
      purchaseUrl: normalizeUrl(parser.purchaseUrlPath ? getPath(item, parser.purchaseUrlPath) : undefined),
      raw: item,
    }];
  });
}

function parseTextCandidates(text: string, parser: ParserConfig): Candidate[] {
  if (!parser.numberRegex) throw new Error("numberRegex is required for text parsers");
  const numberMatches = [...text.matchAll(new RegExp(parser.numberRegex, "g"))];
  const priceMatches = parser.priceRegex ? [...text.matchAll(new RegExp(parser.priceRegex, "g"))] : [];
  const urlMatches = parser.purchaseUrlRegex ? [...text.matchAll(new RegExp(parser.purchaseUrlRegex, "g"))] : [];
  return numberMatches.map((match, index) => ({
    number: normalizeNumber(match[1] ?? match[0]) || "",
    listedPrice: parsePrice(priceMatches[index]?.[1] ?? priceMatches[index]?.[0]),
    price: parsePrice(priceMatches[index]?.[1] ?? priceMatches[index]?.[0]),
    currency: null,
    purchaseUrl: normalizeUrl(urlMatches[index]?.[1] ?? urlMatches[index]?.[0]),
    raw: match[0],
  }));
}

function getPath(value: unknown, path: string): unknown {
  const normalized = path.replace(/^\$\.?/, "").replace(/\[(\d+)\]/g, ".$1");
  if (!normalized) return value;
  return normalized.split(".").filter(Boolean).reduce<unknown>((current, key) => {
    if (current && typeof current === "object" && key in current) return (current as Record<string, unknown>)[key];
    return undefined;
  }, value);
}

function parsePrice(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string") return null;
  const cleaned = value.replace(/[^0-9,.-]/g, "").trim();
  if (!cleaned) return null;
  const normalized = cleaned.includes(",") && !cleaned.includes(".") ? cleaned.replace(",", ".") : cleaned.replace(/,/g, "");
  const number = Number(normalized);
  return Number.isFinite(number) ? number : null;
}

function normalizeNumber(value: unknown): string {
  if (typeof value !== "string" && typeof value !== "number") return "";
  return String(value).trim().replace(/\s+/g, " ");
}

function normalizeString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function normalizeRechargeAction(bodyTemplate: string, rawAmount: unknown): { bodyTemplate: string; rechargeAmount: number } {
  const amountMatch = bodyTemplate.match(/("recharge_amount"\s*:\s*)(-?\d+(?:\.\d+)?)/);
  const rechargeAmount = rawAmount === undefined
    ? Number(amountMatch?.[2] ?? 1)
    : Number(rawAmount);
  if (!Number.isFinite(rechargeAmount) || rechargeAmount < 0.02) {
    throw new Error("初始预存金额不能低于 €0.02");
  }
  if (!amountMatch) throw new Error("下单请求模板缺少 recharge_amount");
  return {
    bodyTemplate: bodyTemplate.replace(amountMatch[0], `${amountMatch[1]}${rechargeAmount}`),
    rechargeAmount,
  };
}

function normalizeUrl(value: unknown): string | null {
  const candidate = normalizeString(value);
  if (!candidate) return null;
  try {
    return new URL(candidate).toString();
  } catch {
    return null;
  }
}

function normalizeMonitorInput(input: MonitorInput): Required<Pick<MonitorInput, "providerSessionId" | "name" | "url" | "method" | "headers" | "parser" | "filters" | "notifyEmail" | "intervalMinutes">> & Pick<MonitorInput, "enabled" | "body" | "action"> {
  if (!input || typeof input !== "object") throw new Error("Invalid monitor payload");
  const providerSessionId = input.providerSessionId?.trim();
  if (!providerSessionId || providerSessionId.length > 80) throw new Error("请选择一个 esim.gg 账号");
  const name = input.name?.trim();
  if (!name || name.length > 120) throw new Error("name is required and must be <= 120 characters");
  const url = validateTargetUrl(input.url);
  const notifyEmail = input.notifyEmail?.trim();
  if (!isEmail(notifyEmail)) throw new Error("notifyEmail must be a valid email");
  const intervalMinutes = Math.min(Math.max(Number(input.intervalMinutes || 1), 1), 1440);
  if (!Number.isFinite(intervalMinutes)) throw new Error("intervalMinutes must be a number");
  const headers = input.headers && typeof input.headers === "object" ? input.headers : {};
  for (const [key, value] of Object.entries(headers)) {
    if (!/^[\w-]+$/.test(key) || typeof value !== "string" || value.length > 1000) throw new Error("Invalid request header");
  }
  const inputFilters = input.filters || {};
  const maxPrice = inputFilters.maxPrice === undefined ? 0 : Number(inputFilters.maxPrice);
  const checkRounds = Math.min(Math.max(Math.trunc(Number(inputFilters.checkRounds ?? 1)), 1), 5);
  const roundDelaySeconds = Math.min(Math.max(Number(inputFilters.roundDelaySeconds ?? 1), 0), 10);
  if (!Number.isFinite(maxPrice) || maxPrice < 0) throw new Error("filters.maxPrice must be zero or greater");
  if (!Number.isFinite(checkRounds) || !Number.isFinite(roundDelaySeconds)) throw new Error("filters.checkRounds and roundDelaySeconds must be valid numbers");
  const filters: FilterConfig = {
    freeOnly: inputFilters.freeOnly !== false,
    maxPrice,
    currency: inputFilters.currency?.trim() || undefined,
    numberPrefix: inputFilters.numberPrefix?.trim() || undefined,
    checkRounds,
    roundDelaySeconds,
  };
  let action: OrderActionConfig | null = null;
  if (input.action?.enabled) {
    if (!input.action.unpaidOnlyAcknowledged) throw new Error("Automatic actions require unpaidOnlyAcknowledged=true");
    if (!input.action.bodyTemplate || input.action.bodyTemplate.length > 50_000) throw new Error("action.bodyTemplate is required and must be <= 50000 characters");
    if (!input.action.paymentUrlPath?.trim()) throw new Error("action.paymentUrlPath is required");
    const actionHeaders = input.action.headers && typeof input.action.headers === "object" ? input.action.headers : {};
    for (const [key, value] of Object.entries(actionHeaders)) {
      if (!/^[\w-]+$/.test(key) || typeof value !== "string" || value.length > 4000) throw new Error("Invalid automatic-order header");
    }
    const maxCandidatePrice = Number(input.action.maxCandidatePrice ?? 0);
    if (!Number.isFinite(maxCandidatePrice) || maxCandidatePrice < 0) throw new Error("action.maxCandidatePrice must be zero or greater");
    const maxOrdersPerCheck = Math.min(Math.max(Math.trunc(Number(input.action.maxOrdersPerCheck ?? 1)), 1), 10);
    const cooldownMinutes = Math.min(Math.max(Math.trunc(Number(input.action.cooldownMinutes ?? 30)), 1), 1440);
    if (!Number.isFinite(maxOrdersPerCheck) || !Number.isFinite(cooldownMinutes)) throw new Error("Automatic-order limits must be valid numbers");
    const recharge = normalizeRechargeAction(input.action.bodyTemplate, input.action.rechargeAmount);
    action = {
      enabled: true,
      url: validateTemplateUrl(input.action.url),
      method: input.action.method === "PUT" ? "PUT" : "POST",
      headers: actionHeaders,
      bodyTemplate: recharge.bodyTemplate,
      rechargeAmount: recharge.rechargeAmount,
      paymentUrlPath: input.action.paymentUrlPath.trim(),
      orderIdPath: input.action.orderIdPath?.trim() || undefined,
      totalPath: input.action.totalPath?.trim() || undefined,
      currencyPath: input.action.currencyPath?.trim() || undefined,
      maxCandidatePrice,
      maxOrdersPerCheck,
      cooldownMinutes,
      disableMonitorAfterOrder: input.action.disableMonitorAfterOrder !== false,
      unpaidOnlyAcknowledged: true,
    };
  }
  return {
    providerSessionId,
    name,
    enabled: input.enabled !== false,
    url,
    method: input.method === "POST" ? "POST" : "GET",
    headers,
    body: input.body ? input.body.slice(0, 50_000) : null,
    parser: input.parser || { format: "json" },
    filters,
    action,
    notifyEmail,
    intervalMinutes,
  };
}

export function validateTargetUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("url must be a valid absolute URL");
  }
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error("url must use http or https");
  const host = url.hostname.toLowerCase();
  if (host === "localhost" || host === "::1" || host === "127.0.0.1" || host.startsWith("10.") || host.startsWith("192.168.") || host.startsWith("169.254.")) {
    throw new Error("private or local target URLs are not allowed");
  }
  return url.toString();
}

function validateTemplateUrl(value: string): string {
  if (!value || value.length > 2000) throw new Error("action.url is required and must be <= 2000 characters");
  const placeholder = value.replace(/\{\{(?:secret:[A-Z][A-Z0-9_]{2,63}|[A-Za-z][A-Za-z0-9]*)\}\}/g, "placeholder");
  validateTargetUrl(placeholder);
  return value;
}

function isEmail(value: string | undefined): value is string {
  return Boolean(value && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value));
}

async function readLimitedText(response: Response): Promise<string> {
  const declared = Number(response.headers.get("content-length") || 0);
  if (declared > MAX_RESPONSE_BYTES) throw new Error("Upstream response is too large");
  const buffer = await response.arrayBuffer();
  if (buffer.byteLength > MAX_RESPONSE_BYTES) throw new Error("Upstream response is too large");
  return new TextDecoder().decode(buffer);
}

async function createFingerprint(candidate: Candidate, monitorId: string): Promise<string> {
  const value = `${monitorId}\n${candidate.number}\n${candidate.price ?? ""}\n${candidate.currency ?? ""}`;
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function listMonitors(db: D1Database, userId: string): Promise<Monitor[]> {
  const { results } = await db.prepare(
    `SELECT m.*, ps.label AS provider_session_label FROM monitors m
     LEFT JOIN provider_sessions ps ON ps.id = m.provider_session_id
     WHERE m.user_id = ? ORDER BY m.created_at DESC`,
  ).bind(userId).all<MonitorRow>();
  return results.map(rowToMonitor);
}

async function getMonitor(db: D1Database, id: string, userId: string): Promise<Monitor | null> {
  const row = await db.prepare(
    `SELECT m.*, ps.label AS provider_session_label FROM monitors m
     LEFT JOIN provider_sessions ps ON ps.id = m.provider_session_id
     WHERE m.id = ? AND m.user_id = ?`,
  ).bind(id, userId).first<MonitorRow>();
  return row ? rowToMonitor(row) : null;
}

type MonitorRow = {
  id: string;
  user_id: string;
  provider_session_id: string | null;
  provider_session_label: string | null;
  name: string;
  enabled: number;
  url: string;
  method: "GET" | "POST";
  headers_json: string;
  body: string | null;
  parser_json: string;
  filters_json: string;
  action_json: string | null;
  notify_email: string;
  last_checked_at: string | null;
  last_error: string | null;
  created_at: string;
  updated_at: string;
};

type DiscoveryRow = {
  id: string;
  monitor_id: string;
  fingerprint: string;
  number: string;
  price: number | null;
  currency: string | null;
  purchase_url: string | null;
  raw_json: string;
  first_seen_at: string;
  last_seen_at: string;
  notified_at: string | null;
};

type OrderRow = {
  id: string;
  discovery_id: string;
  provider_order_id: string | null;
  status: "pending" | "created" | "failed";
  payment_url: string | null;
  total: number | null;
  currency: string | null;
  error: string | null;
  created_at: string;
  updated_at: string;
};

type BrowserCheckRun = {
  id: string;
  monitor_id: string;
  monitor_name: string;
  started_at: string;
  finished_at: string | null;
  rounds: number;
  status: "running" | "success" | "error";
  candidate_count: number;
  matched_count: number;
  error: string | null;
  results: CheckResultSnapshot[];
};

type CheckResultSnapshot = {
  round_number: number;
  number: string;
  listed_price: number | null;
  price: number | null;
  currency: string | null;
  matched: number;
  purchase_url: string | null;
};

type NumberInventoryView = {
  number: string;
  listedPrice: number | null;
  price: number | null;
  currency: string | null;
  lastSeenAt: string;
};

type ManualOrderNumberRow = {
  number: string;
  listed_price: number | null;
  price: number | null;
  currency: string | null;
  last_seen_at: string;
};

type NumberRankingStats = {
  total: number;
  freeCount: number | null;
  lowestPrice: number | null;
  latestSeenAt: string | null;
};

function rowToMonitor(row: MonitorRow): Monitor {
  const filters = JSON.parse(row.filters_json || "{}");
  return {
    id: row.id,
    userId: row.user_id,
    providerSessionId: row.provider_session_id,
    providerSessionLabel: row.provider_session_label,
    name: row.name,
    enabled: Boolean(row.enabled),
    url: row.url,
    method: row.method,
    headers: JSON.parse(row.headers_json || "{}"),
    body: row.body,
    parser: JSON.parse(row.parser_json || "{}"),
    filters,
    action: row.action_json ? JSON.parse(row.action_json) : null,
    notifyEmail: row.notify_email,
    intervalMinutes: Number(filters.intervalMinutes || 5),
    lastCheckedAt: row.last_checked_at,
    lastError: row.last_error,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function rowToDiscovery(row: DiscoveryRow, raw: unknown, lastSeenAt = row.last_seen_at): Discovery {
  return {
    id: row.id,
    monitorId: row.monitor_id,
    fingerprint: row.fingerprint,
    number: row.number,
    price: row.price,
    currency: row.currency,
    purchaseUrl: row.purchase_url,
    raw,
    firstSeenAt: row.first_seen_at,
    lastSeenAt,
    notifiedAt: row.notified_at,
  };
}

function rowToOrderResult(row: OrderRow): OrderResult {
  return {
    status: row.status === "created" ? "created" : row.status === "failed" ? "failed" : "skipped",
    paymentUrl: row.payment_url,
    providerOrderId: row.provider_order_id,
    total: row.total,
    currency: row.currency,
    error: row.error || (row.status === "pending" ? "An order attempt is already pending" : null),
  };
}

async function readJson<T>(request: Request): Promise<T> {
  try {
    return (await request.json()) as T;
  } catch {
    throw new Error("Request body must be valid JSON");
  }
}

function json(data: unknown, status = 200, cookies: string[] = []): Response {
  const headers = new Headers(JSON_HEADERS);
  for (const cookie of cookies) headers.append("set-cookie", cookie);
  return new Response(JSON.stringify(data), { status, headers });
}

function withSecurityHeaders(response: Response): Response {
  const headers = new Headers(response.headers);
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) headers.set(name, value);
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

function redirect(location: string, cookies: string[] = []): Response {
  const headers = new Headers({ ...SECURITY_HEADERS, location, "cache-control": "no-store" });
  for (const cookie of cookies) headers.append("set-cookie", cookie);
  return new Response(null, { status: 302, headers });
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character] || character);
}

function formatMoney(value: number, currency: string | null): string {
  if (!currency) return value.toFixed(2);
  try {
    return new Intl.NumberFormat("en", { style: "currency", currency }).format(value);
  } catch {
    return `${currency} ${value.toFixed(2)}`;
  }
}
