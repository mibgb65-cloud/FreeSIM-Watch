<script setup>
import { computed } from 'vue';
import { useRoute } from 'vue-router';
import ScrollRail from '../components/ScrollRail.vue';
import SiteFooter from '../components/SiteFooter.vue';
import ThemeToggle from '../components/ThemeToggle.vue';
import { appState } from '../lib/session';

const route = useRoute();
const privacy = computed(() => route.name === 'privacy');
const consoleTarget = computed(() => appState.user ? '/dashboard' : '/login?return_to=/dashboard');
</script>

<template>
  <div class="public-site legal-site">
    <a class="skip-link" href="#legal-main">跳到主要内容</a>
    <header class="public-header">
      <div class="public-header-inner">
        <RouterLink class="brand" to="/" aria-label="FreeSIM Watch 首页">
          <span class="brand-mark" aria-hidden="true"><i></i><i></i><i></i></span>
          <span class="public-brand-copy"><strong>FreeSIM Watch</strong><small>OPEN SOURCE · CLOUDFLARE</small></span>
        </RouterLink>
        <nav class="legal-nav" aria-label="法律文档导航"><RouterLink to="/privacy" :class="{ active: privacy }">隐私政策</RouterLink><RouterLink to="/terms" :class="{ active: !privacy }">服务协议</RouterLink></nav>
        <ThemeToggle />
        <RouterLink class="button button-primary public-login" :to="consoleTarget">{{ appState.user ? '进入控制台' : '登录' }}</RouterLink>
      </div>
    </header>

    <main id="legal-main" class="legal-shell">
      <RouterLink class="back-link" to="/"><span aria-hidden="true">←</span> 返回首页</RouterLink>
      <header class="legal-heading">
        <p class="eyebrow">{{ privacy ? 'PRIVACY POLICY' : 'TERMS OF SERVICE' }}</p>
        <h1>{{ privacy ? '隐私政策' : '服务协议' }}</h1>
        <p>{{ privacy ? '说明 FreeSIM Watch 如何处理登录、监控和通知所需的数据。' : '使用 FreeSIM Watch 前，请了解服务边界、使用责任和风险。' }}</p>
        <small>生效日期：2026 年 8 月 31 日 · 版本 2026-08-31</small>
      </header>

      <article v-if="privacy" class="legal-document">
        <section><h2>1. 适用范围</h2><p>本政策适用于你部署的 FreeSIM Watch 实例。它是独立的开源工具，不是 esim.gg、LinuxDo、Cloudflare、Resend 或 Stripe 的官方产品。</p></section>
        <section><h2>2. 我们处理的信息</h2><ul><li><strong>LinuxDo 基础资料：</strong>用户 ID、用户名、显示名称、头像地址、信任等级和管理员角色。</li><li><strong>登录会话：</strong>随机会话凭据的 SHA-256 哈希、有效期及登录时间；浏览器只接收 HttpOnly Cookie。</li><li><strong>esim.gg 会话：</strong>由你主动导入的 session token。验证通过后使用 AES-GCM 加密保存，不在网页回显明文。</li><li><strong>管理员邮件配置：</strong>管理员主动添加的 Resend API Key 使用 AES-GCM 加密保存，页面只显示末四位；同时保存对应发件人、启用状态和发送错误摘要。</li><li><strong>监控与号码数据：</strong>服务端保存通知邮箱、监控参数、符合条件的发现和错误摘要。所有用户监控到的号码、最新价格和目录更新时间会汇总为全站共享目录，不记录发现该号码的用户、账号或任务。</li><li><strong>本机查询历史：</strong>只有用户点击“立即检查”时，逐轮号码结果才保存在当前浏览器的 localStorage，不上传到 D1，也不会跨设备同步。</li><li><strong>待支付订单：</strong>订单标识、Stripe 支付链接、金额、币种和错误摘要，不保存银行卡或支付密码。</li></ul></section>
        <section><h2>3. 处理目的</h2><p>这些信息仅用于验证用户身份、隔离多用户数据、运行你创建的监控任务、搜索号码历史、创建待支付订单、通过邮件发送通知、保障安全及排查故障。不使用这些数据做广告画像或出售个人信息。</p></section>
        <section><h2>4. 第三方服务</h2><ul><li><strong>LinuxDo Connect：</strong>完成 OAuth 登录并提供基础用户资料。</li><li><strong>Cloudflare Workers 与 D1：</strong>运行应用并保存账户、配置、密文及历史数据。</li><li><strong>esim.gg：</strong>验证你提供的会话并执行号码查询或创建待支付订单。</li><li><strong>Resend：</strong>向你配置的邮箱投递提醒。</li><li><strong>Stripe：</strong>仅在你打开待支付链接后处理付款，本工具不接收支付资料。</li></ul><p>上述服务可能按照各自政策在不同地区处理数据。</p></section>
        <section><h2>5. 保存期限</h2><ul><li>登录会话最长 30 天，过期后不可继续使用。</li><li>一次性 esim.gg 导入码 10 分钟后过期，使用后即失效。</li><li>当前浏览器中的手动查询历史最多保留 50 次，并自动清理 7 天前的数据。</li><li>全站号码目录会清理 30 天未再次出现的号码。</li><li>监控、发现及订单摘要保留至你删除对应监控、请求删除账户数据或服务停止。</li><li>加密的 esim.gg 会话保留至更新、账户数据被删除或服务停止；会话本身也可能由 esim.gg 提前失效。</li></ul></section>
        <section><h2>6. 安全措施</h2><p>应用采用同源请求校验、HttpOnly/Secure/SameSite Cookie、哈希会话凭据、AES-GCM 加密、按 LinuxDo 用户隔离查询及 Cloudflare Secret 管理关键密钥。任何系统都无法保证绝对安全；发现异常时请停止任务并重新登录或更新 esim.gg 会话。</p></section>
        <section><h2>7. 你的选择与权利</h2><p>你可以删除监控任务来删除关联历史，也可以向站点部署者请求访问、更正、导出或删除账户数据，并可通过退出登录和停止使用服务撤回后续处理授权。撤回不影响此前合法完成的处理。</p></section>
        <section><h2>8. Cookie</h2><p>本站仅使用维持 LinuxDo 登录和 OAuth 安全校验所必需的 Cookie，不设置广告或跨站跟踪 Cookie。</p></section>
        <section><h2>9. 政策更新与联系</h2><p>处理目的、数据种类或第三方发生重要变化时，会更新版本并要求重新同意。隐私请求或安全问题可通过站点部署者公开的项目渠道提出；处理请求时可能需要验证 LinuxDo 身份。</p></section>
      </article>

      <article v-else class="legal-document">
        <section><h2>1. 接受协议</h2><p>勾选同意并使用 LinuxDo 登录，即表示你已阅读并接受本协议与《隐私政策》。如果不同意，请不要登录、导入会话或创建监控任务。</p></section>
        <section><h2>2. 服务内容</h2><p>FreeSIM Watch 提供 esim.gg 爱沙尼亚号码的定时查询、全站共享号码目录、本机手动查询历史、价格筛选、邮件提醒及可选的待支付订单创建。功能可能因上游网站、Cloudflare、Resend 或 Stripe 的变化而中断。</p></section>
        <section><h2>3. 非官方与授权边界</h2><p>本工具不是 esim.gg 官方集成。你只能导入自己有权使用的账号会话，并应遵守 esim.gg、LinuxDo、Stripe、Resend 及其他相关服务的条款。不得使用本工具绕过登录、验证码、WAF、访问控制、限流或其他安全措施。</p></section>
        <section><h2>4. 账户和安全责任</h2><ul><li>你应妥善保护 LinuxDo 和 esim.gg 账号，发现异常时立即退出并更新会话。</li><li>不得上传、共享或使用他人的 Cookie、token、支付资料或其他凭据。</li><li>不得通过自动化滥用上游接口、影响其他用户或开展违法活动。</li><li>站点可以限制每用户任务数量，并可暂停明显异常或有安全风险的任务。</li></ul></section>
        <section><h2>5. 待支付订单和费用</h2><p>启用自动动作后，工具只尝试创建待支付订单并发送链接，不会自动打开支付页、确认付款或保存银行卡。号码费显示为 €0.00 不代表整笔订单免费；eSIM、充值、手续费、税费和其他项目仍可能产生费用。你必须在 Stripe 页面核对所有金额并自行决定是否付款。</p></section>
        <section><h2>6. 数据与通知准确性</h2><p>号码可用性、价格和订单状态具有时效性，历史记录不保证代表当前状态。邮件可能延迟、被拦截或投递失败。服务不保证一定发现免费号码、成功创建订单或保留某个号码。</p></section>
        <section><h2>7. 禁止行为</h2><p>禁止未经授权访问他人数据、探测或攻击服务、规避租户隔离、批量滥用订单、转售访问权、植入恶意内容，或以违反法律及第三方条款的方式使用本工具。</p></section>
        <section><h2>8. 服务变更与终止</h2><p>为修复安全问题、适配上游变更或控制资源消耗，服务可能调整频率、功能、配额或暂时停止。严重违规、安全风险或法律要求可能导致会话和任务被终止。</p></section>
        <section><h2>9. 免责声明与责任限制</h2><p>在适用法律允许的范围内，本服务按现状提供，不对持续可用性、数据绝对准确、特定号码获得、邮件送达或交易结果作保证。因用户付款决定、账号管理、违反第三方条款或未经授权使用导致的损失由用户自行承担；法律不得排除的责任不受本条限制。</p></section>
        <section><h2>10. 协议更新</h2><p>协议发生重要变化时会更新版本，并在下次登录时要求重新同意。继续使用即表示接受当时有效的版本。</p></section>
      </article>
    </main>

    <SiteFooter />
    <ScrollRail />
  </div>
</template>
