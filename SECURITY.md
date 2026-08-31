# Security Policy

## Supported versions

Only the latest version on the default branch is supported with security fixes.

## Reporting a vulnerability

Please do not open a public issue for credentials, authentication bypasses, cross-tenant data access, SSRF, or other security vulnerabilities. Contact the repository owner privately through the contact method listed in the repository profile. Include a short description, affected route or component, reproduction steps, and impact. Do not include live cookies, OAuth secrets, Resend keys, or encryption keys.

If the report involves a deployed instance, include the instance hostname and approximate UTC time, but redact tokens and personal data.

## Deployment safety

- Keep `wrangler.jsonc`, `.dev.vars`, Cloudflare credentials, and exported database files out of Git.
- Configure `ADMIN_USER_IDS` with your own LinuxDo user ID; do not reuse the maintainer's ID.
- Keep at least one working administrator account. The UI prevents an administrator from banning or deleting their current account.
- Treat imported esim.gg session tokens, OAuth secrets, Resend keys, and `SESSION_ENCRYPTION_KEY` as production secrets.
- Store `ADMIN_TOKEN` only as a Worker Secret or in ignored `.dev.vars`; use a randomly generated value of at least 32 characters and rotate it if exposed. Removing or clearing the Secret disables existing Token sessions.
- Keep `DEV_LOGIN_ENABLED=true` local-only; the Worker rejects `/auth/dev` on non-localhost HTTP origins, but production deployments should omit this variable entirely.
- Do not expose an instance as a public multi-tenant SaaS without adding rate limits, abuse controls, and a complete SSRF defense for custom monitor targets.
