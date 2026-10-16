import assert from 'node:assert/strict';

// Run on the local editor through cua_repl with its existing tab handle.
export async function checkIcons(tab) {
  const icons = await tab.playwright.locator('.symbols symbol').evaluateAll(symbols => symbols.map(symbol => ({
    id: symbol.id, viewBox: symbol.getAttribute('viewBox'), geometry: symbol.innerHTML, text: !!symbol.querySelector('text'),
  })));
  assert.equal(icons.length, 25);
  for (const icon of icons) {
    assert.equal(icon.viewBox, '0 0 32 32', `${icon.id} uses the shared grid`);
    assert.ok(icon.geometry.length > 0, `${icon.id} has geometry`);
    assert.equal(icon.text, false, `${icon.id} does not depend on an installed font`);
  }
  const missing = await tab.playwright.locator('use').evaluateAll(uses => uses.map(use => use.getAttribute('href')).filter(href => !href || !document.querySelector(href)));
  assert.equal(missing.length, 0, 'every icon instance resolves');
  const buttonIcons = await tab.playwright.locator('button svg').evaluateAll(icons => icons.every(icon => icon.getAttribute('aria-hidden') === 'true'));
  assert.ok(buttonIcons, 'decorative icons preserve the existing accessible button names');
  for (const id of ['text-tool', 'pen-tool']) {
    await tab.playwright.locator(`#${id}`).click();
    const cursor = await tab.playwright.locator('#canvas').evaluate(el => getComputedStyle(el).cursor);
    assert.match(cursor, /data:image\/svg\+xml/);
  }
  await tab.playwright.locator('#pen-panel [data-tool="highlighter"]').click();
  assert.equal(await tab.playwright.locator('#pen-tool use').first().getAttribute('href'), '#i-highlighter');
  await tab.playwright.locator('#arrow-tool').click();
}
