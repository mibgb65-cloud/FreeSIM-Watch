import assert from 'node:assert/strict';
import test from 'node:test';
import { couponFromAction } from '../frontend/src/lib/order.js';

test('reads a saved task coupon and supports legacy checkout templates', () => {
  assert.equal(couponFromAction({ coupon: 'saved-code', bodyTemplate: '{"coupon":"legacy"}' }), 'saved-code');
  assert.equal(couponFromAction({ bodyTemplate: '{"coupon":"legacy"}' }), 'legacy');
  assert.equal(couponFromAction({ bodyTemplate: '{}' }), 'setup');
  assert.equal(couponFromAction(null), 'setup');
});
