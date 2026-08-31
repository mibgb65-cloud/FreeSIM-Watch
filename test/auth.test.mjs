import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { LEGAL_VERSION, adminTokenConfigured, adminTokenMatches, createAdminTokenSession, oauthStateCookie, safeReturnTo, sessionCookie, sha256 } from '../dist-test/auth.js';
import { decryptProviderToken, encryptProviderToken, normalizeProviderSessionInput } from '../dist-test/provider-session.js';
import { normalizeResendApiKey, normalizeResendDomain, resendFromAddress, shouldRotateResendKey } from '../dist-test/admin-config.js';
import { SECURITY_HEADERS, isLocalDevelopmentRequest } from '../dist-test/index.js';
import { environmentRegisteredUserLimit, normalizeRegisteredUserLimit } from '../dist-test/registration-limit.js';

test('authentication cookies are HttpOnly, Secure, and scoped correctly', () => {
  const session = sessionCookie('token');
  assert.match(session, /HttpOnly/);
  assert.match(session, /Secure/);
  assert.match(session, /SameSite=Lax/);
  assert.match(session, /Path=\//);

  const state = oauthStateCookie('state');
  assert.match(state, /Path=\/auth\/linuxdo\/callback/);
  assert.match(state, /Max-Age=600/);
});

test('static asset routing preserves dynamic security boundaries', () => {
  const config = JSON.parse(readFileSync(new URL('../wrangler.example.jsonc', import.meta.url), 'utf8'));
  assert.deepEqual(config.assets.run_worker_first, ['/*', '!/assets/*', '!/favicon.svg']);
});

test('browser security headers cover worker and static responses', () => {
  assert.equal(SECURITY_HEADERS['strict-transport-security'], 'max-age=31536000');
  assert.equal(SECURITY_HEADERS['x-frame-options'], 'DENY');
  assert.equal(SECURITY_HEADERS['x-content-type-options'], 'nosniff');
  assert.match(SECURITY_HEADERS['permissions-policy'], /camera=\(\)/);
  assert.match(SECURITY_HEADERS['content-security-policy'], /form-action 'self' https:\/\/connect\.linux\.do/);

  const html = readFileSync(new URL('../frontend/index.html', import.meta.url), 'utf8');
  const inlineScript = html.match(/<script>([\s\S]*?)<\/script>/)?.[1] || '';
  const scriptHash = crypto.createHash('sha256').update(inlineScript).digest('base64');
  assert.match(SECURITY_HEADERS['content-security-policy'], new RegExp(`sha256-${scriptHash.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));

  const staticHeaders = readFileSync(new URL('../frontend/public/_headers', import.meta.url), 'utf8');
  assert.match(staticHeaders, /X-Frame-Options: DENY/);
  assert.match(staticHeaders, /Strict-Transport-Security: max-age=31536000/);
  assert.match(staticHeaders, /form-action 'self' https:\/\/connect\.linux\.do/);
  assert.match(staticHeaders, new RegExp(`sha256-${scriptHash.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));
  assert.match(staticHeaders, /! Cross-Origin-Resource-Policy[\s\S]*Cross-Origin-Resource-Policy: cross-origin/);
});

test('legal consent uses an explicit version', () => {
  assert.match(LEGAL_VERSION, /^\d{4}-\d{2}-\d{2}(?:\.\d+)?$/);
});

test('registered user limits have a safe configurable range', () => {
  assert.equal(environmentRegisteredUserLimit({}), 10);
  assert.equal(environmentRegisteredUserLimit({ MAX_REGISTERED_USERS: '25' }), 25);
  assert.equal(environmentRegisteredUserLimit({ MAX_REGISTERED_USERS: 'invalid' }), 10);
  assert.equal(normalizeRegisteredUserLimit(1), 1);
  assert.equal(normalizeRegisteredUserLimit(100000), 100000);
  assert.throws(() => normalizeRegisteredUserLimit(0));
  assert.throws(() => normalizeRegisteredUserLimit(100001));
});

test('schema and migrations preserve administrator-controlled user bans', () => {
  const schema = readFileSync(new URL('../schema.sql', import.meta.url), 'utf8');
  const migration = readFileSync(new URL('../migrations/0014_user_bans.sql', import.meta.url), 'utf8');
  assert.match(schema, /banned_at TEXT/);
  assert.match(migration, /ALTER TABLE users ADD COLUMN banned_at TEXT/);
});

test('return paths cannot escape the application origin', () => {
  assert.equal(safeReturnTo('/search?q=372'), '/search?q=372');
  assert.equal(safeReturnTo('//evil.example'), '/dashboard');
  assert.equal(safeReturnTo('https://evil.example'), '/dashboard');
});

test('session hashes are stable and not stored in plaintext', async () => {
  const digest = await sha256('secret-session');
  assert.equal(digest, crypto.createHash('sha256').update('secret-session').digest('hex'));
  assert.doesNotMatch(digest, /secret-session/);
});

test('self-hosted admin tokens require a strong configured secret and exact match', async () => {
  const token = 'self-hosted-token-0123456789-abcdef';
  assert.equal(adminTokenConfigured(token), true);
  assert.equal(adminTokenConfigured('too-short'), false);
  assert.equal(await adminTokenMatches(token, token), true);
  assert.equal(await adminTokenMatches(`${token}x`, token), false);
  assert.equal(await adminTokenMatches(token, undefined), false);
  const operations = [];
  const env = {
    ADMIN_TOKEN: token,
    DB: {
      prepare(sql) {
        return {
          bind(...values) {
            return { run: async () => operations.push({ sql, values }) };
          },
          run: async () => operations.push({ sql, values: [] }),
        };
      },
      batch(statements) { return Promise.all(statements.map((statement) => statement.run())); },
    },
  };
  const session = await createAdminTokenSession(env, token, true);
  assert.match(session, /^[A-Za-z0-9_-]{32,}$/);
  assert.equal(operations.some(({ sql }) => sql.includes("INSERT INTO users")), true);
  assert.equal(operations.some(({ values }) => values.includes(token)), false);
  await assert.rejects(() => createAdminTokenSession(env, 'wrong-token', true), /Token 无效/);
  await assert.rejects(() => createAdminTokenSession(env, token, false), /同意/);
});

test('development login is restricted to local HTTP origins', () => {
  const env = { DEV_LOGIN_ENABLED: 'true' };
  assert.equal(isLocalDevelopmentRequest(new URL('http://127.0.0.1:8787'), env), true);
  assert.equal(isLocalDevelopmentRequest(new URL('http://localhost:8787'), env), true);
  assert.equal(isLocalDevelopmentRequest(new URL('https://127.0.0.1:8787'), env), false);
  assert.equal(isLocalDevelopmentRequest(new URL('http://app.example'), env), false);
});

test('provider tokens are encrypted and bound to one user', async () => {
  const env = { SESSION_ENCRYPTION_KEY: crypto.randomBytes(32).toString('base64url') };
  const token = 'private-esimgg-session-token-123456';
  const encrypted = await encryptProviderToken(env, 'user-a', token);
  assert.notEqual(encrypted.ciphertext, token);
  assert.equal(await decryptProviderToken(env, 'user-a', encrypted.ciphertext, encrypted.iv), token);
  await assert.rejects(() => decryptProviderToken(env, 'user-b', encrypted.ciphertext, encrypted.iv));
});

test('provider session input accepts either a token or a complete cookie line', () => {
  const token = 'private-esimgg-session-token-123456';
  assert.equal(normalizeProviderSessionInput(token), token);
  assert.equal(normalizeProviderSessionInput(`foo=bar; __Secure-nekopass.session_token=${token}; theme=dark`), token);
  assert.throws(() => normalizeProviderSessionInput('too-short'));
});

test('managed Resend keys reject malformed secrets', () => {
  assert.equal(normalizeResendApiKey('re_1234567890abcdefghijklmnop'), 're_1234567890abcdefghijklmnop');
  assert.throws(() => normalizeResendApiKey('not-a-resend-key'));
});

test('managed Resend domains generate the fixed sender identity', () => {
  assert.equal(normalizeResendDomain(' EXAMPLE.COM '), 'example.com');
  assert.equal(resendFromAddress('example.com'), 'FreeSIM Watch <alerts@example.com>');
  assert.throws(() => normalizeResendDomain('https://example.com'));
  assert.throws(() => normalizeResendDomain('localhost'));
});

test('Resend rotation only retries key or service availability errors', () => {
  for (const status of [401, 402, 403, 429]) assert.equal(shouldRotateResendKey(status), true);
  for (const status of [400, 404, 408, 409, 422, 500, 503]) assert.equal(shouldRotateResendKey(status), false);
});
