import assert from 'node:assert/strict';

// A fresh local tab and CUA coordinate input. No image export with text.
export async function checkOutsideCanvas(tab, input) {
  const canvas = tab.playwright.locator('#canvas');
  const dimensions = () => tab.playwright.locator('#dimensions').textContent();
  const state = () => canvas.getAttribute('aria-description');
  const rect = () => canvas.evaluate(el => {
    const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height };
  });
  const original = await dimensions();
  const choose = async kind => {
    if (['rectangle', 'roundedRectangle', 'ellipse', 'line'].includes(kind)) await tab.playwright.locator('#shape-tool').click();
    if (['pen', 'highlighter'].includes(kind)) await tab.playwright.locator('#pen-tool').click();
    await tab.playwright.locator(`[data-tool="${kind}"]`).click();
  };
  for (const [kind, side] of [['arrow', 'left'], ['rectangle', 'top'], ['roundedRectangle', 'right'], ['ellipse', 'bottom'], ['line', 'left'], ['pen', 'right'], ['highlighter', 'bottom']]) {
    await choose(kind);
    const r = await rect();
    const starts = { left: [r.x - 24, r.y + r.h * .3], top: [r.x + r.w * .3, r.y - 24], right: [r.x + r.w + 24, r.y + r.h * .3], bottom: [r.x + r.w * .3, r.y + r.h + 24] };
    await input.drag(starts[side], [r.x + r.w * .5, r.y + r.h * .5]);
    assert.match(await state(), /^1 個標註/, `${kind} starts outside the ${side} edge`);
    assert.notEqual(await dimensions(), original, `${kind} expands the document`);
    await canvas.press('Meta+z');
    assert.match(await state(), /^0 個標註/);
    assert.equal(await dimensions(), original, 'one undo restores annotation and canvas size');
    await canvas.press('Meta+Shift+z');
    assert.match(await state(), /^1 個標註/);
    assert.notEqual(await dimensions(), original);
    await canvas.press('Meta+z');
  }
  // A stroke wholly outside the canvas still creates a visible, undoable object.
  await choose('arrow');
  let r = await rect();
  await input.drag([r.x - 24, r.y + r.h * .3], [r.x - 24, r.y + r.h * .6]);
  assert.match(await state(), /^1 個標註/);
  assert.notEqual(await dimensions(), original);
  await canvas.press('Meta+z');
  await input.click([r.x - 24, r.y + r.h * .3]);
  assert.match(await state(), /^0 個標註/, 'a click without a drag leaves no empty arrow');
  assert.equal(await dimensions(), original);

  await choose('text');
  const editor = tab.playwright.locator('#text-editor');
  r = await rect();
  const outside = [r.x + r.w + 24, r.y + r.h * .3];
  await input.click(outside);
  assert.equal(await editor.isVisible(), true);
  assert.notEqual(await dimensions(), original, 'text expands immediately to fit its input frame');
  await editor.press('Escape');
  assert.equal(await dimensions(), original, 'cancel restores the canvas size');
  assert.match(await state(), /^0 個標註/);
  await input.click(outside);
  await tab.playwright.locator('#arrow-tool').click();
  assert.equal(await dimensions(), original, 'leaving an empty text draft restores the canvas');
  assert.match(await state(), /^0 個標註/);
  await choose('text');
  await input.click(outside);
  await editor.fill('畫布外文字');
  await editor.press('Meta+Enter');
  assert.match(await state(), /^1 個標註/);
  await canvas.press('Meta+z');
  assert.equal(await dimensions(), original);
  assert.match(await state(), /^0 個標註/, 'text and expansion share one undo');
}
