export function couponFromAction(action) {
  if (typeof action?.coupon === 'string') return action.coupon;
  try {
    const coupon = JSON.parse(action?.bodyTemplate || '{}').coupon;
    return typeof coupon === 'string' ? coupon : 'setup';
  } catch {
    return 'setup';
  }
}
