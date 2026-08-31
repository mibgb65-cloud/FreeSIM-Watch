export interface Env {
  ASSETS: Fetcher;
  DB: D1Database;
  RESEND_API_KEY: string;
  RESEND_FROM: string;
  CHECK_USER_AGENT?: string;
  PUBLIC_ORIGIN: string;
  LINUXDO_AUTHORIZE_URL: string;
  LINUXDO_TOKEN_URL: string;
  LINUXDO_USER_URL: string;
  LINUXDO_CLIENT_ID?: string;
  LINUXDO_CLIENT_SECRET?: string;
  SESSION_ENCRYPTION_KEY?: string;
  DEV_LOGIN_ENABLED?: string;
  MAX_MONITORS_PER_USER?: string;
  MAX_REGISTERED_USERS?: string;
  LEGACY_OWNER_USER_ID?: string;
  ADMIN_USER_IDS?: string;
  ESIMGG_SESSION_TOKEN?: string;
}

export interface SessionUser {
  id: string;
  username: string;
  name: string;
  avatarUrl: string | null;
  role: "user" | "admin";
  trustLevel: number;
}
