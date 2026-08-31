# FreeSIM Watch

一个可部署到 Cloudflare Workers 的开源 esim.gg 爱沙尼亚号码监控器。Vue 3 管理台通过 Worker 定时检查号码，使用 [Resend](https://resend.com/) 发送通知；命中符合价格规则的号码时可创建待支付订单，但最终付款始终由人工确认。

> 本项目不是 esimgg 的官方工具，也不包含任何站点的私有接口、登录凭据或绕过验证码的代码。使用者应遵守目标站点的服务条款、robots 规则和合理的请求频率。

## 能做什么

- Cloudflare Workers + Cron Triggers 定时检查（esim.gg 预设为每分钟 3 轮）
- Cloudflare D1 保存监控配置与去重后的发现记录
- 通过 Resend HTTP API 发邮件，无需 Node.js SDK
- Resend 通知使用移动端友好的品牌化 HTML 模板，按任务价格条件描述号码，不假定号码免费
- 管理页仅保留 esim.gg 所需配置，不需要手填接口、JSON 路径或请求头
- 默认筛选爱沙尼亚 `+372`、`EUR` 和显示号码费 `€0.00`；启用自动动作后可改为自定义最高价格
- 新发现去重，避免每轮重复通知
- 可选：自动创建待支付订单并在邮件中发送支付链接
- 可选的 LinuxDo OAuth 或自托管站点 Token 登录，HttpOnly Cookie 会话，不把认证 token 放进浏览器存储
- 每个用户独立的监控、历史、订单和 esim.gg 登录会话
- 每个用户可绑定多个 esim.gg 账号；创建监控时明确选择使用的账号
- 管理员可按 LinuxDo 信任等级 0–4 设置每位用户的监控任务上限
- 管理员可托管多把加密 Resend API Key，并按 Key 对应的已验证发件域名轮换
- 可通过网页管理 esim.gg 监控任务
- 点击“立即检查”时，当前浏览器保存逐轮号码、原价和折后价格（最多 50 次、保留 7 天，不写入 D1）
- 独立号码查询页可按号码片段、价格范围和币种实时筛选，不触发下单或通知
- 最近发现和号码查询结果可在二次确认后手动生成指定号码的待支付链接，并邮件发送；最终付款仍由用户完成
- 后台 Cron 不保存逐轮历史；手动检查结果只保存在执行操作的浏览器中
- 全站号码共享一份去重目录，每个号码只保留最新价格和目录更新时间，不记录来源任务与出现次数
- 号码查询与价格排行榜读取全站共享目录，不会额外请求上游
- 全站支持跟随系统、浅色和深色三种主题模式，手动选择会保存在浏览器中
- API 通过登录会话保护；账号、任务、历史和订单按用户隔离，号码目录为全站共享只读数据
- Vue 3 + Vite + Vue Router 单页管理台，路由按页面懒加载

## 不做什么

- 不自动付款或保存银行卡资料；自动动作只允许配置为“创建待支付订单”
- 不绕过验证码、登录、WAF 或访问控制
- 不内置第三方网站的 cookie、token 或未公开接口

## 架构

```text
Cron Trigger ──> Worker ──> 获授权的 esim.gg 会话
                    │
                    ├──> D1（监控、发现、去重）
                    └──> Resend（新发现邮件）

浏览器管理页 ──HttpOnly Session Cookie──> Worker API
邮件中的链接 ──> 第三方购买页（人工确认）
```

## 部署

需要 Node.js 20+、Cloudflare 账户、一个 Resend 账户，以及已在 Resend 验证的发件域名。

1. 安装依赖并创建本机 Wrangler 配置：

   ```bash
   npm install
   cp wrangler.example.jsonc wrangler.jsonc
   ```

2. 创建 D1 数据库：

   ```bash
   npx wrangler d1 create freesim-watch
   ```

   将输出的 `database_id` 写入本机 `wrangler.jsonc`。该文件已被 Git 忽略，避免把账号 ID、域名和管理员 ID 提交到公开仓库。

3. 初始化远程数据库：

   ```bash
   npx wrangler d1 execute freesim-watch --remote --file=schema.sql
   npx wrangler d1 execute freesim-watch --remote --file=scripts/baseline-migrations.sql
   ```

   第二条命令只登记当前仓库已经包含在 `schema.sql` 中的历史迁移，之后新增迁移即可使用 `npx wrangler d1 migrations apply freesim-watch --remote`。

4. 修改 `wrangler.jsonc` 中的 `PUBLIC_ORIGIN`、可选自定义域名和 `MAX_REGISTERED_USERS`。如果使用 LinuxDo 多用户登录，再填写 `ADMIN_USER_IDS`；多个 ID 使用逗号分隔。

5. 至少配置一种正式登录方式：

   个人自托管建议使用随机站点 Token，无需配置 LinuxDo。用密码管理器生成 32–256 个字符的随机值，然后写入 Worker Secret：

   ```bash
   npx wrangler secret put ADMIN_TOKEN
   ```

   `ADMIN_TOKEN` 不要写入 `wrangler.jsonc`、README、Issue 或 Git；登录成功后浏览器只保存 HttpOnly Session Cookie，不保存原始 Token。删除或清空该 Secret 会立即停用现有站点 Token 会话。

   如需多用户登录，则在 [LinuxDo Connect](https://connect.linux.do/) 创建应用，回调地址填写：

   ```text
   https://你的正式域名/auth/linuxdo/callback
   ```

   然后配置：

   ```bash
   npx wrangler secret put LINUXDO_CLIENT_ID
   npx wrangler secret put LINUXDO_CLIENT_SECRET
   ```

   两种登录方式可以同时开启。之后配置所有部署都需要的加密密钥，以及可选的默认 Resend 发件配置：

   ```bash
   npm run security:key
   npx wrangler secret put RESEND_API_KEY
   npx wrangler secret put RESEND_FROM
   ```

   `security:key` 会生成并上传 32 字节 AES-GCM 主密钥，不显示密钥值。`RESEND_FROM` 示例：`FreeSIM Watch <alerts@example.com>`。

6. 部署：

   ```bash
   npm run deploy
   ```

部署命令会先构建 Vue 管理台，再上传 Worker 和 `dist` 静态资源。打开 Worker URL，使用已配置的 LinuxDo 或站点 Token 登录。

从 `0.1.0` 的早期监控-only 版本升级时，执行：

```bash
npx wrangler d1 execute freesim-watch --remote --file=migrations/0002_orders.sql
npx wrangler d1 execute freesim-watch --remote --file=migrations/0003_check_history.sql
npx wrangler d1 execute freesim-watch --remote --file=migrations/0004_number_inventory.sql
npx wrangler d1 execute freesim-watch --remote --file=migrations/0005_multi_user_auth.sql
npx wrangler d1 execute freesim-watch --remote --file=migrations/0006_admin_role.sql
npx wrangler d1 execute freesim-watch --remote --file=migrations/0007_legal_consent.sql
npx wrangler d1 execute freesim-watch --remote --file=migrations/0008_multiple_provider_accounts.sql
npx wrangler d1 execute freesim-watch --remote --file=migrations/0009_admin_controls.sql
npx wrangler d1 execute freesim-watch --remote --file=migrations/0010_rename_default_monitor.sql
npx wrangler d1 execute freesim-watch --remote --file=migrations/0011_global_number_catalog.sql
npx wrangler d1 execute freesim-watch --remote --file=migrations/0012_drop_legacy_number_rows.sql
npx wrangler d1 execute freesim-watch --remote --file=migrations/0013_app_settings.sql
npx wrangler d1 execute freesim-watch --remote --file=migrations/0014_user_bans.sql
npx wrangler d1 execute freesim-watch --remote --file=scripts/baseline-migrations.sql
```

## 本地开发

复制 `.dev.vars.example` 为 `.dev.vars`，填写开发值并生成本地加密密钥，然后初始化本地 D1。示例中的 `DEV_LOGIN_ENABLED=true` 仅用于本机开发；Worker 现在也会拒绝非 localhost 的开发登录请求，生产环境不要配置它：

```bash
npx wrangler d1 execute freesim-watch --local --file=schema.sql
npm run security:key -- --local
```

分别启动 Worker 后端和 Vue 开发服务器：

```bash
# 终端 1：构建前端并启动本地 Worker（127.0.0.1:8787）
npm run dev:worker

# 终端 2：Vue Vite 开发服务器（127.0.0.1:5173）
npm run dev
```

Vite 会把 `/api` 和 `/health` 代理到本地 Worker。前端源码位于 `frontend/src`，生产构建输出到 `dist`。

本地 Cron 可访问：

```text
http://localhost:8787/cdn-cgi/handler/scheduled
```

## 配置 esim.gg（每个用户独立）

管理页已固定使用 esim.gg 爱沙尼亚号码流程。接口地址、解析规则、价格筛选和待支付订单请求都已内置，只需要导入登录会话并填写通知邮箱。

一个 LinuxDo 用户可以绑定多个 esim.gg 账号。每个账号只保存一个加密 session token，并使用你填写的备注名区分；创建或编辑监控时必须选择具体账号，定时任务不会把同一个监控广播到其他账号。旧版单账号部署升级后，已有的 Worker Secret 会在首次打开配置页时一次性迁移为“esim.gg 账号 1”，旧监控也会自动关联到它。

预设每分钟触发一次，每次连续查询 3 轮、轮次间隔 1 秒。由于每次接口随机返回约 12 个号码，这相当于每分钟观察约 36 条返回结果；同一号码会去重。管理页的“查看每次查询”可以查看最近 7 天的完整批次和金额历史。

最简单的方式全部在网页完成：

1. 在浏览器打开 esim.gg 并正常登录。
2. 按 `F12`，进入 `Application / 应用` → `Cookies` → `https://esim.gg`。
3. 选择 `__Secure-nekopass.session_token`，复制 `Value`。
4. 回到监控台的“直接在网页导入”，粘贴并点击“验证并导入会话”。

网页也接受包含 `__Secure-nekopass.session_token=...` 的完整 Cookie 行。Worker 会先调用只读号码查询验证会话；验证通过后才使用 `SESSION_ENCRYPTION_KEY` 加密写入 D1，成功后前端立即清空输入。

命令行自动读取是可选的高级方式：

1. 在项目目录启动独立登录浏览器：

```bash
npm run esimgg:login
```

2. 在自动打开的 Chrome / Edge 窗口正常登录 esim.gg，登录完成后保留该窗口。

3. 登录管理页，在“配置 esim.gg 监控”卡片中点击“生成导入码”，复制页面生成的完整命令回项目终端执行：

```bash
npm run esimgg:session -- --server https://你的 Worker 域名 --code 页面生成的一次性导入码
```

   本地开发直接复制页面生成的命令即可（Vite 会代理 `/api` 到本地 Worker）：

```bash
npm run esimgg:session -- --server http://127.0.0.1:5173 --code 页面生成的一次性导入码
```

4. 页面会自动显示“你的 esim.gg 会话已导入”，然后填写 Resend 通知邮箱并创建监控。

如果需要第二个账号，在“配置”页点击“绑定新账号”，登录另一个 esim.gg 账号并使用不同的备注名。更新账号会替换该账号的 token；如果账号仍被监控任务使用，则需要先在任务编辑页切换账号后才能解绑。

命令行导入码只允许使用一次，10 分钟后失效。脚本只读取 `__Secure-nekopass.session_token` 并通过 HTTPS 上传。每个 LinuxDo 用户只能使用自己的会话，网页不会显示已保存的明文 token。会话过期后重新登录并重复导入。完整接口说明和限制见 [docs/esimgg.md](docs/esimgg.md)。

## 自动创建待支付订单

这是可选的高级功能。启用后，新号码第一次出现时，Worker 会调用一次你配置的订单接口，记录返回的订单 ID 和支付 URL，再把支付链接放进 Resend 邮件。管理页的“自动生成支付链接的最高号码费（EUR）”填 `0` 表示仅处理免费号码，填 `1` 表示价格不高于 `€1.00` 的号码也可以生成链接。工具不会打开支付页、不会保存银行卡，也不会自动确认支付。

请求 body 支持这些模板变量：

- `{{number}}`、`{{numberEncoded}}`
- `{{price}}`、`{{currency}}`
- `{{fingerprint}}`、`{{discoveryId}}`
- `{{secret:NAME}}`（仅从当前监控运行时提供的 Secret 覆盖表读取，默认只有该用户的 `ESIMGG_SESSION_TOKEN`）

启用前必须勾选“接口只创建待支付订单”的确认项。每条发现只创建一条本地订单记录；请求会携带号码指纹作为 `Idempotency-Key`，但第三方是否真正支持幂等仍取决于其接口。

LinuxDo、站点 Token 和 esim.gg 登录是三套独立凭据。Worker 不会绕过 OAuth、Passkey、验证码、登录或 WAF。esim.gg 会话失效后需要重新登录并导入。

## 管理员后台

使用 LinuxDo 登录时，`ADMIN_USER_IDS` 中的用户会在顶部看到“管理”；使用站点 Token 登录的自托管管理员默认拥有管理员权限，也可以直接访问 `/admin`。普通用户无法调用 `/api/admin/*`，权限由 Worker 后端校验。

管理员可在“用户概览”中修改总注册用户上限。`MAX_REGISTERED_USERS` 只是 D1 尚未保存自定义设置时的默认值；达到上限后，已注册用户仍可登录，新用户会被拒绝。即使名额已满，`ADMIN_USER_IDS` 中的管理员仍允许首次登录，避免部署者被锁在后台之外。

管理员还可以封禁、解封或永久删除其他用户。封禁会撤销该用户的全部 Session 并停用其监控；解封不会自动恢复任务。永久删除会清除该用户的 Session、加密 esim.gg 凭据、监控、发现和订单并释放注册名额。当前管理员不能操作自己。

管理员可以为 LinuxDo 信任等级 0–4 分别设置每位用户的监控任务上限（0 表示禁止新建，最大 20）。等级在用户每次 LinuxDo 登录时同步；创建监控时 Worker 查询 D1 规则并强制校验。没有自定义规则时使用 `MAX_MONITORS_PER_USER` 作为默认值。

管理员还可以添加、更新、启用、停用或删除 Resend API Key。网页端只需填写已在 Resend 验证的发件域名（同时作为 Key 名称），Worker 会自动使用 `FreeSIM Watch <alerts@该域名>` 作为发件人；旧的 API 调用仍兼容直接传入 `fromAddress`。Key 使用 `SESSION_ENCRYPTION_KEY` 做 AES-GCM 加密，页面和 API 只显示末四位。发送顺序优先使用最久未用的可用 Key；遇到 Key 无效、无权限、额度或限流（401、402、403、429）时，该 Key 冷却 30 分钟并自动尝试下一把。400/422 等内容错误、408 和 5xx 不跨账号重试，避免响应不确定时产生重复邮件。原有 `RESEND_API_KEY` 与 `RESEND_FROM` 仍作为兼容回退。

## Cloudflare 用量提示

Worker 发出的 esim.gg `fetch` 属于子请求，不会额外计作 Worker 入站请求；上游网站自身的频率限制仍然适用。号码与最新价格写入一份全站共享目录，不保存来源任务和出现次数；价格不变时最多每天刷新一次。后台 Cron 不保存逐轮查询历史，点击“立即检查”返回的结果只存入当前浏览器。免费 Workers 计划包含每天 100,000 次动态请求；D1 包含每天 500 万行读取、10 万行写入和总计 5GB 存储。免费额度用完后对应操作会失败，不会自动扣费；只有主动开通 Workers Paid 后，超出月度包含量才可能计费。请在 Cloudflare 控制台的 D1 Metrics / Workers Usage 中查看实际用量。

## API

除 `/health` 和认证入口外，所有 `/api/*` 请求都需要当前用户的 HttpOnly Session Cookie。

主要端点：

- `GET /api/monitors`
- `GET /api/session`
- `GET /api/auth/config`
- `GET /api/esimgg/status`（只返回当前用户的会话状态）
- `POST /api/esimgg/session`（当前用户在网页直接验证并绑定或更新，body: `session`, `label`, 可选 `accountId`）
- `DELETE /api/esimgg/session/:accountId`（解绑未被监控使用的账号）
- `POST /api/esimgg/import-code`（body: `label`, 可选 `accountId`）
- `POST /api/esimgg/session/import`（一次性导入码，供 CLI 使用）
- `POST /api/monitors`
- `GET|PUT|DELETE /api/monitors/:id`
- `POST /api/monitors/:id/check`
- `POST /api/numbers/search`（查询全站共享号码目录，同时返回 `results` 与 `recommended`）
- `POST /api/monitors/:id/search`（兼容旧客户端，同样读取全站共享目录）
- `POST /api/monitors/:id/numbers/order`（为数据库中的指定号码手动创建待支付订单）
- `GET /api/numbers/ranking?order=asc&limit=100`（全站共享号码价格排行榜）
- `GET /api/discoveries?limit=100`
- `GET /api/history`（兼容端点；返回浏览器存储提示，不再读取 D1 历史）
- `GET /api/orders?limit=100`
- `POST /api/test-email`
- `GET /api/admin/users`（管理员）
- `PUT /api/admin/registration-limit`（管理员；修改总注册用户上限）
- `PUT /api/admin/users/:id?action=ban`（管理员；封禁并退出用户）
- `DELETE /api/admin/users/:id?action=unban`（管理员；解除封禁）
- `DELETE /api/admin/users/:id`（管理员；永久删除用户及关联数据）
- `GET /api/admin/quota-rules`（管理员）
- `PUT|DELETE /api/admin/quota-rules/:trustLevel`（管理员）
- `GET|POST /api/admin/resend/keys`（管理员；完整 Key 永不回显）
- `PUT|DELETE /api/admin/resend/keys/:id`（管理员）

## 安全说明

这是个人/小团队自托管工具。管理页是公开静态资源，用户通过 LinuxDo OAuth 或站点 Token 登录；D1 中所有业务数据都通过监控任务的 `user_id` 做租户隔离。会话 Cookie 使用 `HttpOnly; Secure; SameSite=Lax`，不存入 `sessionStorage`。请为 Worker 配置自定义域名和 Cloudflare Access 作为额外保护。

请求端限制响应为 2 MB、20 秒超时，并拒绝明显的本地/私有 IPv4 URL。DNS 重绑定和全部 IPv6 私网形式不可能仅靠字符串检查彻底防住，因此不要把 D1 或 Cloudflare Secret 权限提供给不受信任的人，也不要把此实例开放成公共 SaaS。

esim.gg 会话和管理员托管的 Resend Key 密文会存入 D1；真实凭据只在 Worker 内存中短暂解密使用。请限制 D1 和 Cloudflare 账户权限。轮换 `SESSION_ENCRYPTION_KEY` 后，所有用户都需要重新导入 esim.gg 会话，管理员也需要重新添加托管的 Resend Key。

第三方订单响应仅保存订单 ID、支付 URL、金额和错误摘要，不保存完整响应正文。LinuxDo Client Secret、`ADMIN_TOKEN` 和加密主密钥只通过 Worker Secret 提供。

## 开发检查

```bash
npm run typecheck
npm test
npm run build
```

也可以一次运行 `npm run verify`。

## 参与贡献与安全报告

提交 Pull Request 前请阅读 [CONTRIBUTING.md](CONTRIBUTING.md)。安全问题请按照 [SECURITY.md](SECURITY.md) 私下报告，不要在公开 Issue 中粘贴 Cookie、OAuth Secret、Resend Key 或加密密钥。

## License

[MIT](LICENSE)
