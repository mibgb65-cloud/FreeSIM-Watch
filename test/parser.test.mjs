import assert from 'node:assert/strict';
import test from 'node:test';
import { buildDiscoveryEmail, buildManualOrderEmail, buildMonitorCreatedEmail, normalizeManualOrderInput, normalizeNumberRankingInput, normalizeNumberSearchInput, normalizeRechargeAction, parseCandidates, resolveTemplate, validateTargetUrl } from '../dist-test/index.js';

test('parses and filters a generic JSON response', () => {
  const input = JSON.stringify({
    data: {
      numbers: [
        { msisdn: '+372 5319 8043', cost: '€0.00', currency: 'EUR', url: 'https://shop.example/buy/1' },
        { msisdn: '+372 5319 0385', cost: '€0.80', currency: 'EUR', url: 'https://shop.example/buy/2' },
        { msisdn: '+371 2000 0000', cost: 0, currency: 'EUR' },
      ],
    },
  });

  const result = parseCandidates(input, {
    format: 'json',
    itemsPath: 'data.numbers',
    numberPath: 'msisdn',
    pricePath: 'cost',
    currencyPath: 'currency',
    purchaseUrlPath: 'url',
  }, { freeOnly: true, maxPrice: 0, numberPrefix: '+372', currency: 'EUR' });

  assert.equal(result.length, 1);
  assert.equal(result[0].number, '+372 5319 8043');
  assert.equal(result[0].price, 0);
  assert.equal(result[0].purchaseUrl, 'https://shop.example/buy/1');
});

test('parses text with regular expressions', () => {
  const result = parseCandidates('number=+37253198043 price=0.00', {
    format: 'text',
    numberRegex: 'number=(\\+372\\d+)',
    priceRegex: 'price=(\\d+\\.\\d+)',
  }, { freeOnly: true });

  assert.equal(result.length, 1);
  assert.equal(result[0].number, '+37253198043');
  assert.equal(result[0].price, 0);
});

test('applies a fixed number-fee discount and currency', () => {
  const result = parseCandidates(JSON.stringify({ search: [
    { msisdn: '37253198043', price: 0.2 },
    { msisdn: '37253190385', price: 1.14 },
  ] }), {
    format: 'json',
    itemsPath: 'search',
    numberPath: 'msisdn',
    pricePath: 'price',
    priceSubtract: 0.2,
    currencyValue: 'EUR',
  }, { freeOnly: true, maxPrice: 0, currency: 'EUR', numberPrefix: '372' });

  assert.equal(result.length, 1);
  assert.equal(result[0].price, 0);
  assert.equal(result[0].currency, 'EUR');
});

test('accepts paid numbers up to the configured automatic-order price', () => {
  const result = parseCandidates(JSON.stringify({ search: [
    { msisdn: '37253198043', price: 0.2 },
    { msisdn: '37253190385', price: 1.14 },
    { msisdn: '37253199122', price: 1.21 },
  ] }), {
    format: 'json',
    itemsPath: 'search',
    numberPath: 'msisdn',
    pricePath: 'price',
    priceSubtract: 0.2,
    currencyValue: 'EUR',
  }, { freeOnly: false, maxPrice: 1, currency: 'EUR', numberPrefix: '372' });

  assert.deepEqual(result.map((item) => item.price), [0, 0.94]);
});

test('rejects obvious local targets', () => {
  assert.throws(() => validateTargetUrl('http://127.0.0.1/private'), /private or local/);
  assert.throws(() => validateTargetUrl('file:///etc/passwd'), /http or https/);
  assert.equal(validateTargetUrl('https://api.example.com/numbers'), 'https://api.example.com/numbers');
});

test('resolves candidate variables and provider secrets', () => {
  const output = resolveTemplate(
    '{"number":"{{number}}","cookie":"{{secret:PROVIDER_SESSION_COOKIE}}"}',
    { number: '+37253198043' },
    { PROVIDER_SESSION_COOKIE: 'session=secret-value' },
  );
  assert.equal(output, '{"number":"+37253198043","cookie":"session=secret-value"}');
  assert.throws(
    () => resolveTemplate('{{secret:MISSING_SECRET}}', {}, {}),
    /Missing provider secret/,
  );
});

test('normalizes database number search filters', () => {
  const result = normalizeNumberSearchInput({ query: '+372 5319', minPrice: 0.5, maxPrice: 1, currency: 'eur' });
  assert.deepEqual(result, { query: '+372 5319', minPrice: 0.5, maxPrice: 1, currency: 'EUR', limit: 100 });
  assert.throws(() => normalizeNumberSearchInput({ query: 'DROP TABLE' }), /phone-number characters/);
  assert.throws(() => normalizeNumberSearchInput({ minPrice: 2, maxPrice: 1 }), /cannot exceed/);
});

test('normalizes number ranking filters', () => {
  assert.deepEqual(normalizeNumberRankingInput({ order: 'DESC', limit: '500' }), {
    order: 'desc', limit: 200,
  });
  assert.deepEqual(normalizeNumberRankingInput({ order: null, limit: null }), {
    order: 'asc', limit: 100,
  });
  assert.equal(normalizeNumberRankingInput({ limit: 0.1 }).limit, 1);
  assert.throws(() => normalizeNumberRankingInput({ order: 'price desc' }), /asc or desc/);
  assert.throws(() => normalizeNumberRankingInput({ limit: 0 }), /positive number/);
});

test('requires an exact phone number and explicit acknowledgement for manual orders', () => {
  assert.deepEqual(normalizeManualOrderInput({ number: ' 37253198043 ', expectedPrice: 0.94, acknowledged: true }), {
    number: '37253198043', expectedPrice: 0.94, acknowledged: true,
  });
  assert.throws(() => normalizeManualOrderInput({ number: '37253198043', expectedPrice: 0.94, acknowledged: false }), /手动完成/);
  assert.throws(() => normalizeManualOrderInput({ number: 'DROP TABLE', expectedPrice: 0.94, acknowledged: true }), /格式无效/);
  assert.throws(() => normalizeManualOrderInput({ number: '37253198043', expectedPrice: null, acknowledged: true }), /价格无效/);
});

test('enforces esim.gg minimum recharge amount and writes it into the checkout body', () => {
  const template = JSON.stringify({ msisdn: '{{number}}', recharge_amount: 1 });
  const minimum = normalizeRechargeAction(template, 0.02);
  assert.equal(minimum.rechargeAmount, 0.02);
  assert.equal(JSON.parse(minimum.bodyTemplate).recharge_amount, 0.02);
  assert.equal(normalizeRechargeAction(template, undefined).rechargeAmount, 1);
  assert.throws(() => normalizeRechargeAction(template, 0), /€0\.02/);
  assert.throws(() => normalizeRechargeAction(template, 0.01), /€0\.02/);
});

test('renders branded price-condition emails without legacy free-number wording or API purchase links', () => {
  const monitor = {
    id: 'monitor-1', name: 'esim.gg Estonia 免费号码', filters: { maxPrice: 1, currency: 'EUR' },
    action: { maxCandidatePrice: 1 },
  };
  const item = {
    id: 'discovery-1', number: '37253198971', price: 0.94, currency: 'EUR', fingerprint: 'fingerprint-1',
  };
  const discovery = buildDiscoveryEmail('https://app.example.com', monitor, [item], new Map());
  assert.match(discovery.subject, /符合价格条件/);
  assert.match(discovery.html, /号码费不高于/);
  assert.match(discovery.html, /在控制台生成支付链接/);
  assert.match(discovery.html, /monitorId=monitor-1/);
  assert.match(discovery.html, /name="color-scheme" content="light dark"/);
  assert.match(discovery.html, /<body[^>]+background:#f5f5f7/);
  assert.match(discovery.html, /@media \(prefers-color-scheme:dark\)/);
  assert.doesNotMatch(discovery.html, /name="color-scheme" content="dark"/);
  assert.doesNotMatch(discovery.html, /免费号码|api\.esim\.gg/);

  const manual = buildManualOrderEmail(monitor, item, {
    status: 'created', paymentUrl: 'https://checkout.stripe.com/example', total: 4.83, currency: 'EUR',
  });
  assert.match(manual.html, /打开 Stripe 并核对付款/);
  assert.match(manual.html, /€4\.83/);
  assert.doesNotMatch(manual.html, /免费号码/);
});

test('renders monitor creation confirmation emails with delivery-chain details', () => {
  const monitor = {
    name: 'esim.gg Estonia 号码监控',
    notifyEmail: 'owner@example.com',
    intervalMinutes: 5,
    filters: { maxPrice: 0, currency: 'EUR' },
  };
  const message = buildMonitorCreatedEmail(monitor);
  assert.match(message.subject, /监控任务已创建/);
  assert.match(message.text, /owner@example\.com/);
  assert.match(message.text, /每 5 分钟/);
  assert.match(message.html, /通知链路测试成功/);
  assert.doesNotMatch(message.html, /ESIMGG_SESSION_TOKEN|RESEND_API_KEY/);
});
