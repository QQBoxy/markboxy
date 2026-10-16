import assert from 'node:assert/strict';

// Run against a fresh local preview with a CUA tab handle.
export async function checkCursorAndFormat(tab) {
  const cursor = () => tab.playwright.locator('#canvas').evaluate(el => getComputedStyle(el).cursor);
  const checkCursor = async icon => {
    const value = await cursor();
    assert.match(value, /8 28, crosshair$/);
    const svg = decodeURIComponent(value.match(/data:image\/svg\+xml,([^\"]+)/)[1]);
    const shape = await tab.playwright.locator(`#i-${icon}`).evaluate(el => el.innerHTML);
    assert.ok(svg.includes(shape), `cursor includes ${icon} tool icon`);
    assert.ok(svg.includes('x="17" y="2"'), 'icon is above and right of hotspot');
    const color = await tab.playwright.locator('#color').evaluate(el => el.value);
    assert.ok(svg.includes(`color="${color}"`), 'tool icon follows current color');
    assert.ok(svg.includes('stroke="black"'), 'crosshair remains black');
  };
  await checkCursor('arrow');
  for (const color of ['#1e90ff', '#ffffff', '#ff2600']) {
    await tab.playwright.locator('#color-toggle').click();
    await tab.playwright.locator(`[data-color="${color}"]`).click();
    await checkCursor('arrow');
  }
  for (const [tool, icon] of [['rectangle', 'shape'], ['roundedRectangle', 'rounded'], ['ellipse', 'ellipse'], ['line', 'line']]) {
    await tab.playwright.locator('#shape-tool').click();
    await tab.playwright.locator(`[data-tool="${tool}"]`).click();
    await checkCursor(icon);
  }
  await tab.playwright.locator('#crop-tool').click();
  await checkCursor('crop');
  await tab.playwright.locator('#crop-cancel').click();
  await tab.playwright.locator('#arrow-tool').click();
  await checkCursor('arrow');
  for (const [format, label] of [['jpeg', 'JPG'], ['png', 'PNG'], ['jpeg', 'JPG']]) {
    await tab.playwright.locator('#format').click();
    await tab.playwright.locator(`[data-format="${format}"]`).click();
    assert.equal(await tab.playwright.locator('#format-menu [aria-pressed="true"]').textContent(), `✓ ${label}`);
    const labels = await tab.playwright.locator('[data-format]').allTextContents();
    assert.equal(labels.filter(text => text.includes('✓')).length, 1);
    assert.equal(await tab.playwright.locator('#format').textContent(), `.${label.toLowerCase()}▾`);
    assert.equal(await tab.playwright.locator('#export .png-file b').textContent(), label);
    await tab.playwright.locator('#export').click();
    assert.equal(await tab.playwright.locator('#export-format').evaluate(el => el.value), format);
    assert.equal(await tab.playwright.locator('#quality-label').isVisible(), format === 'jpeg');
    await tab.playwright.locator('#cancel-export').click();
  }
  await tab.playwright.locator('#export').click();
  await tab.playwright.locator('#export-format').selectOption('png');
  await tab.playwright.locator('#cancel-export').click();
  assert.equal(await tab.playwright.locator('[data-format="png"]').textContent(), '✓ PNG');
  await tab.playwright.locator('#format').click();
}
