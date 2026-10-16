import assert from 'node:assert/strict';

// Run on a fresh preview tab, with a cua.getTab handle for the same page.
export async function checkSizeIcon(tab, input) {
  const toggle = tab.playwright.locator('#size-toggle');
  const weight = () => toggle.evaluate(el => el.style.getPropertyValue('--size-weight'));
  assert.equal(await weight(), '2', 'startup icon matches default level 2');
  const choose = async level => {
    await toggle.click();
    const sizes = [8.977159880834161, 17.954319761668323, 26.931479642502484, 35.908639523336646, 58.35153922542205];
    await tab.playwright.locator(`[data-size="${sizes[level - 1]}"]`).click();
    assert.equal(await weight(), String(level));
    assert.equal(await toggle.getAttribute('aria-description'), `粗細第 ${level} 級`);
    const indicators = await tab.playwright.locator('#size-panel [data-size]').evaluateAll(buttons => ({
      selected: buttons.filter(b => b.getAttribute('aria-pressed') === 'true').length,
      rings: buttons.filter(b => getComputedStyle(b, '::before').content === '""').length,
      staticIcons: buttons.filter(b => b.querySelector('svg')).length,
    }));
    assert.equal(indicators.selected, 1);
    assert.equal(indicators.rings, 1, 'only current size has an outer ring');
    assert.equal(indicators.staticIcons, 0, 'no preset icon contains a permanent circle');

  };
  for (const level of [1, 2, 3, 4, 5]) await choose(level);
  const r = await tab.playwright.locator('#canvas').evaluate(el => {
    const box = el.getBoundingClientRect(); return { x: box.x, y: box.y, w: box.width, h: box.height };
  });
  const point = (x, y) => [r.x + r.w * x, r.y + r.h * y];
  await input.drag(point(.2, .25), point(.7, .25));
  await choose(1);
  await input.drag(point(.2, .65), point(.7, .65));
  await input.click(point(.45, .25));
  assert.equal(await weight(), '5', 'selecting thick arrow updates icon');
  await input.click(point(.45, .65));
  assert.equal(await weight(), '1', 'selecting thin arrow updates icon');
  await choose(3);
  assert.equal(await weight(), '3', 'editing selected arrow updates icon');
}
