import assert from 'node:assert/strict';

// Fresh tab; the icon moves the same text object while editing or merely selected.
export async function checkTextIconDrag(tab, input) {
  const canvas = tab.playwright.locator('#canvas'), editor = tab.playwright.locator('#text-editor');
  const geometry = () => editor.evaluate(el => {
    const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height };
  });
  const r = await tab.playwright.locator('#stage').evaluate(el => {
    const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width };
  });
  await tab.playwright.locator('#text-tool').click();
  await input.click([r.x + r.w * .25, r.y + 10]);
  const move = async (before, dx, dy) => {
    const icon = [before.x + before.w / 2, before.y - 18];
    await input.drag(icon, [icon[0] + dx, icon[1] + dy]);
  };
  let before = await geometry();
  await move(before, 30, 40);
  let after = await geometry();
  assert.equal(await editor.isVisible(), true, 'dragging the outside icon keeps an empty draft editable');
  assert.ok(Math.abs(after.x - before.x - 30) < 2 && Math.abs(after.y - before.y - 40) < 2);
  await editor.fill('Icon 拖曳文字');
  before = await geometry();
  await move(before, -20, 25);
  after = await geometry();
  assert.ok(Math.abs(after.x - before.x + 20) < 2 && Math.abs(after.y - before.y - 25) < 2);
  assert.equal(await editor.evaluate(el => el.value), 'Icon 拖曳文字');
  assert.equal(await tab.playwright.evaluate(() => document.activeElement?.id), 'text-editor');
  await editor.press('Meta+Enter');
  await move(after, 35, 20);
  assert.equal(await editor.isVisible(), false, 'selected text moves without entering edit mode');
  assert.match(await canvas.getAttribute('aria-description'), /^1 個標註；選取第 1 個標註/);
  await input.click([after.x + 55, after.y + 35], { clickCount: 2 });
  const moved = await geometry();
  assert.ok(Math.abs(moved.x - after.x - 35) < 2 && Math.abs(moved.y - after.y - 20) < 2);
  assert.equal(await editor.evaluate(el => el.value), 'Icon 拖曳文字');
  await editor.press('Meta+Enter');
  await canvas.press('Meta+z');
  await input.click([after.x + 20, after.y + 15], { clickCount: 2 });
  const undone = await geometry();
  assert.ok(Math.abs(undone.x - after.x) < 2 && Math.abs(undone.y - after.y) < 2, 'undo restores the icon move');
  await editor.press('Meta+Enter');
}

// Fresh local tab. Check preview bounds; never export an image containing text.
export async function checkTextIconOutsideCanvas(tab, input) {
  const canvas = tab.playwright.locator('#canvas'), editor = tab.playwright.locator('#text-editor');
  const dimensions = await tab.playwright.locator('#dimensions').textContent();
  const r = await tab.playwright.locator('#stage').evaluate(el => {
    const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width };
  });
  await tab.playwright.locator('#text-tool').click();
  await input.click([r.x + r.w * .25, r.y + 10]);
  const icon = await tab.playwright.evaluate(() => {
    const canvas = document.querySelector('#canvas'), editor = document.querySelector('#text-editor');
    const c = canvas.getBoundingClientRect(), e = editor.getBoundingClientRect(), stage = document.querySelector('#stage').getBoundingClientRect();
    const x = e.x + e.width / 2, y = e.y - 18;
    return { top: y - 12, canvasTop: c.y, documentTop: stage.y };
  });
  assert.ok(icon.top < icon.documentTop, 'icon extends above document');
  assert.ok(icon.canvasTop <= icon.top, 'preview includes the full icon');
  assert.equal(await tab.playwright.locator('#dimensions').textContent(), dimensions, 'controls do not enlarge the document');
  await editor.fill('頂端文字');
  await editor.press('Meta+Enter');
  assert.equal(await tab.playwright.locator('#dimensions').textContent(), dimensions);
  await input.click([r.x + r.w * .7, r.y + 200]);
  const top = await canvas.evaluate(el => el.getBoundingClientRect().y);
  assert.ok(Math.abs(top - r.y) < 1, 'deselecting removes preview padding');
}

// Fresh tab; a blank click finishes/deselects first, and only the next click creates text.
export async function checkTextBlankClick(tab, input) {
  const canvas = tab.playwright.locator('#canvas'), editor = tab.playwright.locator('#text-editor');
  const state = () => canvas.getAttribute('aria-description');
  const r = await canvas.evaluate(el => {
    const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height };
  });
  const first = [r.x + r.w * .15, r.y + r.h * .18];
  const blank = [r.x + r.w * .7, r.y + r.h * .7];
  await tab.playwright.locator('#text-tool').click();
  await input.click(first);
  await input.click(blank);
  assert.equal(await editor.isVisible(), false, 'blank click dismisses an empty draft');
  assert.match(await state(), /^0 個標註/);
  const outside = await tab.playwright.locator('#workspace').evaluate(el => {
    const r = el.getBoundingClientRect(); return [r.x + 10, r.y + r.height / 2];
  });
  await input.click(first);
  await input.click(outside);
  assert.equal(await editor.isVisible(), false, 'workspace blank also dismisses the draft');
  assert.match(await state(), /^0 個標註/);
  await input.click(first);
  await editor.fill('保留文字 ABC');
  await input.click(blank);
  assert.equal(await editor.isVisible(), false, 'blank click finishes filled text');
  assert.match(await state(), /^1 個標註/);
  assert.doesNotMatch(await state(), /選取第/, 'filled text is deselected');
  await canvas.press('Meta+z');
  assert.match(await state(), /^0 個標註/, 'completed text remains undoable');
  await canvas.press('Meta+Shift+z');
  assert.match(await state(), /^1 個標註/);
  await input.click(first);
  assert.match(await state(), /選取第 1 個標註/);
  await input.click(blank);
  assert.equal(await editor.isVisible(), false, 'selected text is deselected before creating another frame');
  assert.doesNotMatch(await state(), /選取第/);
  await input.click(blank);
  assert.equal(await editor.isVisible(), true, 'next blank click creates a new frame');
  await editor.press('Escape');
  await input.click(first, { clickCount: 2 });
  assert.equal(await editor.evaluate(el => el.value), '保留文字 ABC', 'text survives deselection');
  await input.click(outside);
  assert.equal(await editor.isVisible(), false, 'workspace blank finishes filled text without creating a frame');
  assert.match(await state(), /^1 個標註/);
  assert.doesNotMatch(await state(), /選取第/);
  await input.click(first, { clickCount: 2 });
  await editor.press('Meta+Enter');
}

// A fresh tab; exercise both the canvas side and textarea side of the editing frame.
export async function checkTextFrameDrag(tab, input) {
  const canvas = tab.playwright.locator('#canvas'), editor = tab.playwright.locator('#text-editor');
  const geometry = () => editor.evaluate(el => {
    const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height };
  });
  const state = () => canvas.getAttribute('aria-description');
  const r = await canvas.evaluate(el => {
    const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height };
  });
  await tab.playwright.locator('#text-tool').click();
  await input.click([r.x + r.w * .15, r.y + r.h * .18]);
  const before = await geometry();
  await input.drag([before.x + before.w / 2, before.y - 4], [before.x + before.w / 2 + 24, before.y + 31]);
  assert.equal(await editor.isVisible(), true, 'moving an empty frame keeps its draft');
  const emptyMoved = await geometry();
  assert.ok(Math.abs(emptyMoved.x - before.x - 24) < 2);
  assert.ok(Math.abs(emptyMoved.y - before.y - 35) < 2);
  assert.match(await state(), /^1 個標註/, 'moving does not create another frame');
  assert.equal(await tab.playwright.evaluate(() => document.activeElement?.id), 'text-editor');
  await editor.fill('移動文字框 ABC');
  const filled = await geometry();
  await input.drag([filled.x + filled.w / 2, filled.y + 1], [filled.x + filled.w / 2 - 12, filled.y + 19]);
  const moved = await geometry();
  assert.equal(await editor.isVisible(), true, 'dragging over the textarea border keeps editing');
  assert.ok(Math.abs(moved.x - filled.x + 12) < 2);
  assert.ok(Math.abs(moved.y - filled.y - 18) < 2);
  assert.equal(await editor.evaluate(el => el.value), '移動文字框 ABC');
  await editor.press('Meta+Enter');
  await canvas.press('Meta+z');
  assert.match(await state(), /^0 個標註/, 'undo removes the complete draft without leaving an empty object');
  await canvas.press('Meta+Shift+z');
  assert.match(await state(), /^1 個標註/, 'redo restores the completed text');
}

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
