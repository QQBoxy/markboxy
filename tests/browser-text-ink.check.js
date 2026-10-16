import assert from 'node:assert/strict';

// Run with a fresh local tab and CUA coordinate input, like browser-shapes.check.js.
// This checks editing and editable project save only. Never export an image containing text.
export async function checkTextInk(tab, input) {
  const canvas = tab.playwright.locator('#canvas'), editor = tab.playwright.locator('#text-editor');
  const state = () => canvas.getAttribute('aria-description');
  const rect = () => canvas.evaluate(el => { const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; });
  const r = await rect();
  const p = (x, y) => [r.x + r.w * x, r.y + r.h * y];
  assert.match(await state(), /^0 個標註/);
  await tab.playwright.locator('#text-tool').click();
  await input.click(p(.15, .18));
  assert.equal(await tab.playwright.evaluate(() => document.activeElement?.id), 'text-editor');
  await editor.fill('文字測試 ABC 123\n第二行');
  await editor.press('Meta+Enter');
  assert.match(await state(), /^1 個標註/);
  await input.click(p(.17, .2), { clickCount: 2 });
  assert.equal(await editor.isVisible(), true);
  await editor.fill('文字測試 ABC 123\n重新編輯成功');
  await editor.press('Meta+Enter');
  await tab.playwright.locator('#color-toggle').click();
  await tab.playwright.locator('[data-color="#1e90ff"]').click();
  await tab.playwright.locator('#size-toggle').click();
  await tab.playwright.locator('[data-size]').last().click();
  await input.click(p(.17, .2), { clickCount: 2 });
  const geometry = () => editor.evaluate(el => { const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height, font: getComputedStyle(el).fontSize }; });
  const before = await geometry();
  await editor.press('Meta+Enter');
  await input.drag([before.x + before.w, before.y + before.h / 2], [before.x + before.w + 140, before.y + before.h / 2]);
  await input.click([before.x + 20, before.y + 20], { clickCount: 2 });
  const wider = await geometry();
  assert.ok(wider.w > before.w + 100, 'side handle changes wrap width');
  assert.equal(wider.font, before.font, 'side handle preserves font size');
  await editor.press('Meta+Enter');
  await input.drag([wider.x + wider.w, wider.y + wider.h], [wider.x + wider.w + 100, wider.y + wider.h + 40]);
  await input.click([wider.x + 20, wider.y + 20], { clickCount: 2 });
  assert.ok(Number.parseFloat((await geometry()).font) > Number.parseFloat(wider.font), 'corner handle scales text');
  await editor.press('Meta+Enter');
  await canvas.press('Backspace');
  assert.match(await state(), /^0 個標註/);
  assert.equal(await canvas.evaluate(el => getComputedStyle(el).outlineStyle), 'none', 'deleting does not leave a canvas frame');
  await canvas.press('Meta+z');
  assert.match(await state(), /^1 個標註/);

  await tab.playwright.locator('#pen-tool').click();
  await tab.playwright.locator('[data-tool="pen"]').click();
  await input.drag(p(.12, .6), p(.36, .66));
  await input.drag(p(.14, .75), p(.38, .75));
  assert.match(await state(), /^2 個標註/, 'two continuous strokes form one object');
  assert.equal(await canvas.getAttribute('data-ink'), 'drying');
  await tab.playwright.waitForTimeout(1100); // Explicitly exercise the native one-second dry boundary.
  assert.equal(await canvas.getAttribute('data-ink'), 'dry');
  await input.drag(p(.6, .65), p(.8, .78));
  assert.match(await state(), /^3 個標註/, 'drawing after drying starts a new group');
  // Stay in marker mode: an older dry group must still be selectable and movable.
  await input.click(p(.24, .63));
  assert.match(await state(), /選取第 2 個標註/);
  assert.equal(await tab.playwright.locator('#pen-tool').getAttribute('aria-pressed'), 'true');
  await input.drag(p(.24, .63), p(.28, .59));
  await tab.playwright.locator('#size-toggle').click();
  await tab.playwright.locator('[data-size]').last().click();
  await canvas.press('Backspace');
  assert.match(await state(), /^2 個標註/);
  assert.equal(await canvas.evaluate(el => getComputedStyle(el).outlineStyle), 'none');
  await canvas.press('Meta+z');
  assert.match(await state(), /^3 個標註/);

  await tab.playwright.locator('#pen-tool').click();
  await tab.playwright.locator('[data-tool="highlighter"]').click();
  await input.drag(p(.6, .35), p(.85, .35));
  assert.match(await state(), /^4 個標註/);
  assert.equal(await canvas.getAttribute('data-ink'), 'dry', 'highlighter does not borrow unverified marker grouping');
  await tab.playwright.locator('#capture').click();
  await tab.playwright.locator('#save-project').click();
  assert.equal(await tab.playwright.locator('#download').isVisible(), true);
  return tab.playwright.locator('#download').getAttribute('download');
}
