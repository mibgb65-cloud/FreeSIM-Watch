# esim.gg provider

This preset was derived from an authenticated browser flow on 2026-08-30. It may need updating if esim.gg changes its private web API. It is not an official or endorsed integration.

## Workflow

```text
POST /api/number/search
  -> repeat 3 times per minute (1-second gap)
  -> select first number whose displayed selection fee is €0
  -> POST /api/checkout/create
  -> email response.redirect_url
  -> pause the monitor
```

The integration creates an unpaid checkout only. It never opens or pays the Stripe Checkout URL.

## Authentication

The API accepts the account cookie named `__Secure-nekopass.session_token`. Tests showed that `session_data`, `cf_clearance`, and `__cf_bm` are not required for the read-only number search. Each LinuxDo user can bind multiple esim.gg accounts, each identified by a local label. The Worker verifies each value with a read-only number search, then encrypts it before storing it in D1. A monitor references exactly one account ID.

The web page cannot read the esim.gg cookie automatically because it belongs to a different origin and is HttpOnly. In Chrome or Edge, copy its value from DevTools → Application → Cookies → `https://esim.gg`. The web form also accepts a complete cookie line containing `__Secure-nekopass.session_token=...`.

The optional CLI flow can read it from a dedicated browser profile automatically:

```bash
npm run esimgg:login
# Complete the normal esim.gg login, then generate a one-time code in the web console.
npm run esimgg:session -- --server https://your-worker.example --code ONE_TIME_CODE
```

The first command opens an isolated Chrome or Edge profile with remote debugging on port `9223`. The second command reads only the matching cookie and uploads it over HTTPS without printing the value. The import code is hashed, single-use, and valid for 10 minutes. The Worker encrypts the token with AES-GCM using `SESSION_ENCRYPTION_KEY`; the browser never receives the token. Use a local Worker URL for local development, or `npm run esimgg:session -- --check` to verify that the cookie can be read without uploading it. `--legacy-secret` exists only for migrating an old single-user deployment.

The captured session expired 30 days after login. Re-run the import after signing in again when the API starts returning `401` or `403`.

## Verified request shapes

Number search:

```http
POST https://api.esim.gg/api/number/search
Content-Type: application/json
Cookie: __Secure-nekopass.session_token={{secret:ESIMGG_SESSION_TOKEN}}
Origin: https://esim.gg
Referer: https://esim.gg/new/number/estonia

{"search":"","type":"global"}
```

Response shape:

```json
{
  "success": true,
  "search": [{ "msisdn": "372...", "price": 1.14 }]
}
```

The web checkout applied a `€0.20` number-fee discount when `recharge_amount` was `1`. The preset therefore treats `max(0, price - 0.20)` as the displayed selection fee and orders only when the result is zero.

Create unpaid checkout:

```http
POST https://api.esim.gg/api/checkout/create
Content-Type: application/json
Cookie: __Secure-nekopass.session_token={{secret:ESIMGG_SESSION_TOKEN}}
Origin: https://esim.gg
Referer: https://esim.gg/new/number/estonia

{
  "order_type": "new_line",
  "msisdn": "{{number}}",
  "payment_method": "alipay",
  "recharge_amount": 1,
  "coupon": "",
  "validity_addon": "none",
  "data_package": "none",
  "metadata": {}
}
```

Response shape:

```json
{
  "success": true,
  "number_price": 0.94,
  "total_price": 4.83,
  "redirect_url": "https://checkout.stripe.com/c/pay/..."
}
```

Those numeric values are from the captured non-free sample. `number_price` is only the number-selection fee. The default preset requires it to be zero, while a user may explicitly raise the automatic-order ceiling in the monitor form. Recharge, base eSIM, payment processing, and tax can still make `total_price` greater than the configured number fee. The email always shows the checkout URL and total for manual review and payment.

Each monitor can set its own `recharge_amount`. A live unpaid-checkout test on 2026-08-31 confirmed that esim.gg rejects `0` with `MIN_RECHARGE_0_02`; the minimum accepted configuration is therefore `€0.02`. Existing monitors without the explicit setting continue to use `€1.00`.

## Safety controls

- Candidate displayed selection fee must not exceed the monitor's explicit ceiling; the default ceiling is `€0.00`.
- Cron runs every minute and performs three search rounds with a one-second gap.
- Every returned number and price is retained in query history for seven days.
- At most one checkout is created per check.
- A 30-minute cooldown prevents another pending checkout.
- The monitor pauses after a checkout URL is created.
- Each discovery is unique and each discovery can have at most one local order.
- Each LinuxDo user's session is stored as AES-GCM ciphertext under that user's ID.
- The encryption key remains a Worker Secret and is never stored in D1.
