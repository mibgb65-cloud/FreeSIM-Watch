# Contributing

Thanks for helping improve FreeSIM Watch.

## Before opening a pull request

1. Run `npm install`.
2. Run `npm run typecheck`.
3. Run `npm test`.
4. Run `npm run build`.
5. Confirm that no `.dev.vars`, `wrangler.jsonc`, database export, cookie, token, API key, or other secret is included in the change.

Keep changes focused, document behavior changes, and add a regression test for bug fixes. Do not add code that bypasses login, CAPTCHA, WAF, rate limits, or access controls on third-party services.
