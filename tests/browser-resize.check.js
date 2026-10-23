import assert from 'node:assert/strict';

// Run through cua_repl on a fresh local editor (no text annotations for export tests).
export async function checkResize(tab) {
  const el = id => tab.playwright.locator(`#${id}`);
  const dimensions = () => el('dimensions').textContent();
  await el('crop-tool').click(); await el('choose-resize').click();
  assert.equal(await el('crop-mode-switch').getAttribute('aria-checked'), 'true');
  assert.equal(await el('resize-footer').isVisible(), true);
  await el('crop-width').fill('565'); await el('crop-width').press('Tab');
  assert.equal(await el('crop-height').evaluate(e => e.value), '366');
  assert.equal(await dimensions(), '1130 x 732', 'draft must not change document dimensions');
  await el('resize-increase').click();
  assert.equal(await el('crop-width').evaluate(e => e.value), '678');
  await el('crop-apply').click();
  assert.equal(await dimensions(), '678 x 439');
  await el('canvas').press('Meta+z'); assert.equal(await dimensions(), '1130 x 732');
  await el('canvas').press('Meta+Shift+z'); assert.equal(await dimensions(), '678 x 439');
  await el('canvas').press('Meta+z');
  await el('crop-tool').click(); await el('crop-mode-switch').click();
  await el('crop-width').fill('0'); await el('crop-apply').click();
  assert.equal(await el('crop-bar').isVisible(), true, 'invalid input keeps the draft');
  await el('crop-cancel').click(); assert.equal(await dimensions(), '1130 x 732');
  await el('crop-tool').click(); await el('choose-resize').click();
  await el('crop-height').fill('366'); await el('crop-apply').click();
  assert.equal(await dimensions(), '565 x 366', 'apply consumes the focused field');
  await el('canvas').press('Meta+z');
  await el('crop-tool').click(); await el('choose-resize').click();
  await el('resize-decrease').click(); await el('canvas').press('Escape');
  assert.equal(await dimensions(), '1130 x 732');
  assert.equal(await el('resize-footer').isVisible(), false);
}
