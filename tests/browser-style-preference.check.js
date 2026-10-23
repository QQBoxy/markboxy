import assert from 'node:assert/strict';

export async function checkStylePreference(tab, input) {
  const color = () => tab.playwright.locator('#color').evaluate(el => el.value);
  const size = () => tab.playwright.locator('#size-toggle').getAttribute('aria-description');
  async function choose(value, index) {
    await tab.playwright.locator('#color-toggle').click();
    await tab.playwright.locator(`[data-color="${value}"]`).click();
    await tab.playwright.locator('#size-toggle').click();
    await tab.playwright.locator('[data-size]').nth(index).click();
  }
  await choose('#ff2600', 1);
  const r = await tab.playwright.locator('#canvas').evaluate(el => { const r = el.getBoundingClientRect(); return { x: r.x, y: r.y }; });
  await input.drag([r.x + 160, r.y + 150], [r.x + 400, r.y + 250]);
  await choose('#00d500', 3);
  await input.click([r.x + 310, r.y + 212]);
  assert.equal(await color(), '#ff2600', 'selecting an old annotation still displays its own style');
  assert.equal(await size(), '粗細第 2 級');
  await tab.playwright.locator('#trash').click();
  await tab.playwright.locator('#confirm-clear').click();
  await tab.reload();
  assert.equal(await color(), '#00d500', 'reload restores the chosen preference, not the inspected annotation');
  assert.equal(await size(), '粗細第 4 級');
}

export async function checkCustomColor(tab) {
  const customSelected = () => tab.playwright.locator('.custom-color').getAttribute('class');
  const selectedPresets = () => tab.playwright.locator('[data-color][aria-pressed="true"]').count();
  for (const color of ['#1267ab', '#ff2600']) {
    await tab.playwright.locator('#color-toggle').click();
    await tab.playwright.locator('#color').fill(color);
    await tab.playwright.locator('#color-toggle').click();
    assert.match(await customSelected(), /selected-color/);
    assert.equal(await selectedPresets(), 0, 'custom choice remains distinct even when its RGB matches a preset');
    await tab.reload();
    await tab.playwright.locator('#color-toggle').click();
    assert.match(await customSelected(), /selected-color/, 'reload retains the chosen color source');
    assert.equal(await selectedPresets(), 0);
    await tab.playwright.locator('[data-color="#ff2600"]').click();
    await tab.playwright.locator('#color-toggle').click();
    assert.doesNotMatch(await customSelected(), /selected-color/);
    assert.equal(await selectedPresets(), 1);
    await tab.playwright.locator('[data-color="#ff2600"]').click();
  }
}
