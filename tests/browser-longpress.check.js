import assert from 'node:assert/strict';

// Run through cua_repl with a fresh preview tab at 390 × 844; no browser test dependency.
export async function checkLongPress(tab) {
  const menu = tab.playwright.locator('#arrow-menu');
  const state = () => tab.playwright.locator('#canvas').getAttribute('aria-description');
  assert.match(await state(), /^1 個箭頭/);
  assert.equal(await tab.playwright.locator('#delete-selected').count(), 0);
  await tab.drag([280, 380], [310, 480]);
  await tab.click([172, 423]);
  assert.equal(await menu.isVisible(), false, 'short press only selects');
  await tab.click([172, 423], { durationMs: 750 });
  assert.equal(await menu.isVisible(), true, 'hold opens delete menu');
  await tab.playwright.getByRole('button', { name: '刪除', exact: true }).click();
  assert.match(await state(), /^1 個箭頭/, 'delete only one arrow');
  await tab.playwright.getByRole('button', { name: '復原刪除', exact: true }).click();
  assert.match(await state(), /^2 個箭頭/, 'undo restores deleted arrow');
  await tab.drag([172, 423], [182, 443]);
  assert.equal(await menu.isVisible(), false, 'drag cancels hold');
  await tab.pressKey(null, 'super+z');
  await tab.click([172, 423]);
  await tab.pressKey(null, 'shift+F10');
  assert.equal(await menu.isVisible(), true, 'keyboard can open menu');
  await tab.pressKey(null, 'Escape');
  assert.equal(await menu.isVisible(), false, 'Escape dismisses');
  await tab.click([172, 423], { mouseButton: 'right' });
  assert.equal(await menu.isVisible(), true, 'right click opens menu');
  await tab.playwright.getByLabel('文件名稱', { exact: true }).click();
  assert.equal(await menu.isVisible(), false, 'outside input dismisses');
}
