<script setup>
import { computed } from 'vue';
import ScrollRail from '../components/ScrollRail.vue';
import SiteFooter from '../components/SiteFooter.vue';
import ThemeToggle from '../components/ThemeToggle.vue';
import { appState } from '../lib/session';

const primaryTarget = computed(() => appState.user ? '/dashboard' : '/login?return_to=/dashboard');
const primaryLabel = computed(() => appState.user ? '进入控制台' : '登录');
</script>

<template>
  <div class="public-site">
    <a class="skip-link" href="#public-main">跳到主要内容</a>
    <header class="public-header">
      <div class="public-header-inner">
        <RouterLink class="brand" to="/" aria-label="FreeSIM Watch 首页">
          <span class="brand-mark" aria-hidden="true"><i></i><i></i><i></i></span>
          <span class="public-brand-copy"><strong>FreeSIM Watch</strong><small>OPEN SOURCE · CLOUDFLARE</small></span>
        </RouterLink>
        <nav class="public-nav" aria-label="公开站导航">
          <a href="#features">产品能力</a>
          <a href="#workflow">工作流程</a>
          <a href="#security">安全设计</a>
        </nav>
        <ThemeToggle />
        <RouterLink class="button button-primary public-login" :to="primaryTarget">{{ primaryLabel }}</RouterLink>
      </div>
    </header>

    <main id="public-main">
      <section class="public-hero public-section">
        <div class="public-hero-copy">
          <p class="eyebrow">ESIM.GG NUMBER OPERATIONS</p>
          <h1>爱沙尼亚号码监控</h1>
          <p class="public-hero-lead">持续检查 esim.gg 的 +372 号码，把每轮价格写入你的私人数据库。找到免费号码后创建待支付订单，并把 Stripe 链接发到邮箱。</p>
          <div class="public-hero-actions">
            <RouterLink class="button button-primary public-cta" :to="primaryTarget">{{ appState.user ? '打开我的监控台' : '登录并开始' }}</RouterLink>
            <a class="public-text-link" href="#workflow">了解工作流程 <span aria-hidden="true">→</span></a>
          </div>
          <div class="public-trust" aria-label="产品特性">
            <span><i aria-hidden="true"></i>每分钟自动检查</span>
            <span><i aria-hidden="true"></i>最终付款人工确认</span>
            <span><i aria-hidden="true"></i>每个用户独立数据</span>
          </div>
        </div>

        <div class="number-preview" aria-label="号码监控预览">
          <div class="preview-window-bar"><span></span><span></span><span></span><small>ESTONIA · +372</small></div>
          <div class="preview-body">
            <div class="preview-heading"><div><small>LIVE NUMBER POOL</small><h2>本轮号码</h2></div><span class="preview-live"><i></i>监控中</span></div>
            <article class="preview-number preview-number-free"><div><small>+372</small><strong>5319 80••</strong></div><span><small>号码费</small><b>€0.00</b></span></article>
            <article class="preview-number"><div><small>+372</small><strong>5762 33••</strong></div><span><small>号码费</small><b>€9.80</b></span></article>
            <article class="preview-number"><div><small>+372</small><strong>5912 26••</strong></div><span><small>号码费</small><b>€2.80</b></span></article>
            <div class="preview-result"><span><i></i><strong>发现免费号码</strong></span><small>待支付链接将发送到你的邮箱</small></div>
          </div>
        </div>
      </section>

      <section id="features" class="public-section public-feature-section">
        <header class="public-section-heading"><p class="eyebrow">BUILT FOR THE WAIT</p><h2>把反复刷新，变成安静的后台任务。</h2><p>监控、搜索和通知集中在同一个 Cloudflare 应用里，浏览器关掉后任务依然运行。</p></header>
        <div class="public-feature-grid">
          <article>
            <span class="feature-index">01</span>
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2a10 10 0 1 0 10 10"/><path d="M12 6v6l4 2"/></svg>
            <h3>持续监控</h3><p>Cron 每分钟触发，每次可连续查询多轮，比手动等待更稳定。</p>
          </article>
          <article>
            <span class="feature-index">02</span>
            <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-4-4M8 11h6"/></svg>
            <h3>全站号码目录</h3><p>汇总所有监控发现的号码与最新价格，不记录来源任务和出现次数，可快速筛选。</p>
          </article>
          <article>
            <span class="feature-index">03</span>
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6h16v12H4z"/><path d="m4 7 8 6 8-6"/></svg>
            <h3>及时通知</h3><p>命中后由 Resend 发送待支付链接，工具不会自动打开页面或替你付款。</p>
          </article>
        </div>
      </section>

      <section id="workflow" class="public-section public-workflow-section">
        <header class="public-section-heading"><p class="eyebrow">HOW IT WORKS</p><h2>三步建立属于你的监控。</h2></header>
        <ol class="public-workflow">
          <li><span>01</span><div><h3>登录你的实例</h3><p>可使用 LinuxDo 多用户登录，个人自托管也可使用站点 Token。</p></div></li>
          <li><span>02</span><div><h3>绑定 esim.gg 会话</h3><p>通过一次性导入码上传，Worker 加密后保存，不在网页展示明文。</p></div></li>
          <li><span>03</span><div><h3>等待邮件提醒</h3><p>发现 €0.00 号码费时创建待支付订单，由你打开链接并最终确认。</p></div></li>
        </ol>
      </section>

      <section id="security" class="public-section public-security-card">
        <div><p class="eyebrow">PRIVATE BY DEFAULT</p><h2>共享号码，不共享账户。</h2><p>全站只共享不含用户来源的号码与最新价格；监控任务、订单记录、通知邮箱和 esim.gg 登录会话仍按登录用户隔离。</p></div>
        <ul>
          <li><span class="security-check" aria-hidden="true"></span>HttpOnly 登录 Cookie</li>
          <li><span class="security-check" aria-hidden="true"></span>AES-GCM 会话加密</li>
          <li><span class="security-check" aria-hidden="true"></span>一次性导入码</li>
          <li><span class="security-check" aria-hidden="true"></span>不自动完成付款</li>
        </ul>
      </section>

      <section class="public-section public-final-cta">
        <p class="eyebrow">READY WHEN YOU ARE</p>
        <h2>让 Worker 替你守着号码池。</h2>
        <p>登录后创建你的 esim.gg 监控任务。</p>
        <RouterLink class="button button-primary public-cta" :to="primaryTarget">{{ appState.user ? '进入控制台' : '登录' }}</RouterLink>
      </section>
    </main>

    <SiteFooter />
    <ScrollRail />
  </div>
</template>
