import assert from 'node:assert/strict';

// A fresh preview tab and the cua.getTab handle for the same tab; no browser dependency.
export async function checkShapes(tab, input) {
  const state = () => tab.playwright.locator('#canvas').getAttribute('aria-description');
  assert.match(await state(), /^0 個標註/);
  const r = await tab.playwright.locator('#canvas').evaluate(el => {
    const box = el.getBoundingClientRect(); return { x: box.x, y: box.y, w: box.width, h: box.height };
  });
  const point = (x, y) => [r.x + r.w * x, r.y + r.h * y];
  const choose = async kind => {
    await tab.playwright.locator('#shape-tool').click();
    await tab.playwright.locator(`[data-tool="${kind}"]`).click();
  };
  await tab.playwright.locator('#shape-tool').click();
  assert.equal(await tab.playwright.locator('[data-tool="rectangle"]').getAttribute('aria-pressed'), 'true', 'one click selects rectangle');
  assert.equal(await tab.playwright.locator('#arrow-tool').getAttribute('aria-pressed'), 'false');
  await input.drag(point(.1, .1), point(.4, .35));
  assert.match(await state(), /^1 個標註/);
  await choose('roundedRectangle');
  await input.drag(point(.55, .1), point(.85, .35));
  await choose('ellipse');
  await input.drag(point(.1, .55), point(.4, .8));
  await choose('line');
  await input.drag(point(.55, .55), point(.85, .8));
  await input.drag(point(.55, .88), point(.85, .88));
  await input.drag(point(.93, .55), point(.93, .85));
  assert.match(await state(), /^6 個標註/, 'all four tools plus axis-aligned lines draw');
  await input.click(point(.7, .1));
  assert.match(await state(), /選取第 2 個標註/);
  await input.drag(point(.55, .1), point(.52, .08));
  await tab.playwright.locator('#canvas').press('Meta+z');
  assert.match(await state(), /^6 個標註/, 'rounded rectangle resize is undoable');
  await input.click(point(.7, .88));
  assert.match(await state(), /選取第 5 個標註/);
  await tab.playwright.locator('#canvas').press('Backspace');
  assert.match(await state(), /^5 個標註/);
  assert.equal(await tab.playwright.locator('#notification').isVisible(), false);
  await tab.playwright.locator('#canvas').press('Meta+z');
  assert.match(await state(), /^6 個標註/);
}
