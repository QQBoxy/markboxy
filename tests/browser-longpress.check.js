import assert from 'node:assert/strict';

// Run through cua_repl with a fresh preview tab at 390 × 844; no browser test dependency.
export async function checkLongPress(tab) {
  const menu = tab.playwright.locator('#arrow-menu');
  const state = () => tab.playwright.locator('#canvas').getAttribute('aria-description');
  assert.match(await state(), /^0 個標註/);
  const box = await tab.playwright.locator('#canvas').evaluate(el => {
    const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height };
  });
  const point = (x, y) => [box.x + box.width * x, box.y + box.height * y];
  const body = point(.425, .45);
  assert.equal(await tab.playwright.locator('#delete-selected').count(), 0);
  await tab.drag(point(.2, .25), point(.65, .65));
  await tab.drag(point(.75, .2), point(.85, .7));
  await tab.click(body);
  assert.equal(await menu.isVisible(), false, 'short press only selects');
  await tab.click(body, { durationMs: 750 });
  assert.equal(await menu.isVisible(), true, 'hold opens delete menu');
  await tab.playwright.getByRole('button', { name: '刪除', exact: true }).click();
  assert.match(await state(), /^1 個標註/, 'delete only one arrow');
  assert.equal(await tab.playwright.locator('#notification').isVisible(), false, 'delete is silent');
  await tab.playwright.locator('#canvas').press('Meta+z');
  assert.match(await state(), /^2 個標註/, 'undo restores deleted arrow');
  await tab.drag(body, [body[0] + 10, body[1] + 20]);
  assert.equal(await menu.isVisible(), false, 'drag cancels hold');
  await tab.pressKey(null, 'super+z');
  await tab.click(body);
  await tab.pressKey(null, 'shift+F10');
  assert.equal(await menu.isVisible(), true, 'keyboard can open menu');
  await tab.pressKey(null, 'Escape');
  assert.equal(await menu.isVisible(), false, 'Escape dismisses');
  await tab.click(body, { mouseButton: 'right' });
  assert.equal(await menu.isVisible(), true, 'right click opens menu');
  await tab.playwright.getByLabel('文件名稱', { exact: true }).click();
  assert.equal(await menu.isVisible(), false, 'outside input dismisses');
}

// Run on a fresh document. Applying must read current fields even before a blur/change event.
export async function checkCropDimensions(tab) {
  const dimensions = tab.playwright.locator('#dimensions');
  assert.equal(await dimensions.textContent(), '1130 x 732');
  await tab.playwright.locator('#crop-tool').click();
  await tab.playwright.locator('#crop-width').fill('600');
  await tab.playwright.locator('#crop-height').fill('400');
  await tab.playwright.locator('#crop-apply').click();
  assert.equal(await dimensions.textContent(), '600 x 400');
  await tab.playwright.locator('#crop-tool').click();
  await tab.playwright.locator('#crop-width').fill('0');
  await tab.playwright.locator('#crop-width').press('Tab');
  await tab.playwright.locator('#crop-apply').click();
  assert.equal(await tab.playwright.locator('#crop-bar').isVisible(), true, 'invalid size keeps draft open');
  await tab.playwright.locator('#crop-cancel').click();
  assert.equal(await dimensions.textContent(), '600 x 400', 'cancel preserves applied crop');
  await tab.playwright.locator('#canvas').press('Meta+z');
  assert.equal(await dimensions.textContent(), '1130 x 732', 'undo restores full document');
}


export async function checkStartup(tab) {
  assert.match(await tab.playwright.locator('#canvas').getAttribute('aria-description'), /^0 個標註/);
  assert.equal(await tab.playwright.locator('.account,.app-title').count(), 0);
  assert.equal(await tab.playwright.locator('[data-color="#ff2600"]').getAttribute('aria-pressed'), 'true');
  assert.equal(await tab.playwright.locator('[data-size="17.954319761668323"]').getAttribute('aria-pressed'), 'true');
  assert.equal(await tab.playwright.locator('.topbar').evaluate(el => el.getBoundingClientRect().top), 0);
  await tab.playwright.locator('#format').click();
  assert.equal(JSON.stringify((await tab.playwright.locator('#format-menu button').allTextContents()).map(t => t.replace('✓', '').trim())), '["PNG","JPG"]');
  await tab.playwright.locator('#format').click();
  assert.equal(JSON.stringify(await tab.playwright.locator('#export-format option').allTextContents()), '["PNG","JPG"]');
}

export async function checkCopyImage(tab) {
  const dimensions = (await tab.playwright.locator('#dimensions').textContent()).split(' x ').map(Number);
  await tab.playwright.locator('#canvas').press('Meta+c');
  await tab.playwright.getByText('已複製圖片，可貼到其他軟體；圖片不包含選取控制點。', { exact: true }).waitFor({ state: 'visible' });
  const items = await tab.clipboard.read();
  const png = items.flatMap(item => item.entries).find(entry => entry.mimeType === 'image/png');
  assert.ok(png?.base64, 'clipboard contains actual PNG bytes');
  const bytes = Buffer.from(png.base64, 'base64');
  assert.equal(bytes.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
  assert.equal(bytes.readUInt32BE(16), dimensions[0]);
  assert.equal(bytes.readUInt32BE(20), dimensions[1]);
}
