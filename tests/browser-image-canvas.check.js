import assert from 'node:assert/strict';

// Inject into a local test copy of index.html, never into the product build.
// Observe real pointer events after the editor has rendered each move.
export const previewObserver = `
const result = document.createElement('output');
result.id = 'preview-observation'; result.hidden = true; document.body.append(result);
const samples = [];
window.addEventListener('pointermove', event => {
  if (!event.buttons || event.target.id !== 'canvas') return;
  const canvas = document.getElementById('canvas'), stage = document.getElementById('stage');
  const c = canvas.getBoundingClientRect(), s = stage.getBoundingClientRect();
  if (c.left >= s.left && c.top >= s.top && c.right <= s.right && c.bottom <= s.bottom) return;
  const pixels = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
  let outsideInk = 0;
  for (let y = 0; y < canvas.height; y += 2) for (let x = 0; x < canvas.width; x += 2) {
    const px = c.left + x * c.width / canvas.width, py = c.top + y * c.height / canvas.height;
    const i = (y * canvas.width + x) * 4;
    if ((px < s.left || px > s.right || py < s.top || py > s.bottom) && pixels[i] > 200 && pixels[i+1] < 100 && pixels[i+2] < 100) outsideInk++;
  }
  samples.push({ outsideInk, width: c.width, height: c.height, stageWidth: s.width, stageHeight: s.height });
  result.textContent = JSON.stringify(samples.slice(-200));
});`;

// Start with a freshly pasted 376 × 348 bitmap, no annotations, and 100% zoom.
export async function checkImageCanvas(tab, input) {
  const canvas = tab.playwright.locator('#canvas');
  const dimensions = () => tab.playwright.locator('#dimensions').textContent();
  const rect = () => canvas.evaluate(el => {
    const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height };
  });
  const state = () => canvas.getAttribute('aria-description');
  await tab.playwright.locator('#arrow-tool').click();
  await tab.playwright.locator('#color-toggle').click();
  await tab.playwright.locator('[data-color="#ff2600"]').click();
  await tab.playwright.locator('#size-toggle').click();
  await tab.playwright.locator('[data-size]').last().click();
  assert.equal(await dimensions(), '376 x 348');
  for (const side of ['left', 'top', 'right', 'bottom']) {
    const r = await rect();
    const starts = { left: [r.x - 60, r.y + 90], top: [r.x + 100, r.y - 60], right: [r.x + r.w + 60, r.y + 90], bottom: [r.x + 100, r.y + r.h + 60] };
    const a = starts[side], b = [r.x + r.w * .45, r.y + r.h * .45];
    await input.drag(a, b);
    assert.match(await state(), /^1 個標註/);
    const expanded = await dimensions();
    assert.notEqual(expanded, '376 x 348');
    const next = await rect();
    const shiftX = next.x - r.x + (side === 'left' ? next.w - r.w : 0);
    const shiftY = next.y - r.y + (side === 'top' ? next.h - r.h : 0);
    await input.click([a[0] * .5 + b[0] * .5 + shiftX, a[1] * .5 + b[1] * .5 + shiftY]);
    assert.match(await state(), /選取第 1 個標註/);
    await canvas.press('Backspace');
    assert.equal(await dimensions(), '376 x 348', 'delete recovers the bitmap bounds');
    assert.match(await state(), /^0 個標註/);
    await canvas.press('Meta+z');
    assert.equal(await dimensions(), expanded, 'undo deletion restores expansion');
    await canvas.press('Meta+Shift+z');
    assert.equal(await dimensions(), '376 x 348', 'redo deletion shrinks again');
  }
  const samples = JSON.parse(await tab.playwright.locator('#preview-observation').textContent());
  assert.ok(samples.some(sample => sample.outsideInk > 10), 'real dragging paints visible arrow pixels beyond the old canvas before pointerup');
  let r = await rect();
  await input.drag([r.x - 60, r.y + 90], [r.x + r.w * .45, r.y + r.h * .45]);
  const leftSize = await dimensions();
  r = await rect();
  const a = [r.x + r.w + 60, r.y + 220], b = [r.x + r.w * .65, r.y + 250];
  await input.drag(a, b);
  assert.match(await state(), /^2 個標註/);
  const both = await rect();
  await input.click([(a[0] + b[0]) / 2 + both.x - r.x, (a[1] + b[1]) / 2 + both.y - r.y]);
  assert.match(await state(), /選取第 2 個標註/);
  await canvas.press('Backspace');
  assert.equal(await dimensions(), leftSize, 'deleting the right arrow retains the left extension and arrow');
  assert.match(await state(), /^1 個標註/);
  await canvas.press('Meta+z');
  assert.match(await state(), /^2 個標註/);
  await canvas.press('Meta+z');
  assert.equal(await dimensions(), leftSize);
  await canvas.press('Meta+z');
  assert.equal(await dimensions(), '376 x 348');
  return samples;
}
