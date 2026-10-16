import assert from 'node:assert/strict';

// Run through cua_repl against a fresh isolated test App, never a user's document.
export async function checkFullScreenCapture(app, expectUnavailable = false) {
  const find = (state, pattern) => {
    const line = state.split('\n').find(line => pattern.test(line));
    assert.ok(line, `missing control: ${pattern}`);
    return Number(line.trim().match(/^\d+/)[0]);
  };
  await app.click(find(await app.getAXState({ emit: false, disableDiffing: true }), /button.*螢幕速拍選單/));
  const menu = await app.getAXState({ emit: false, disableDiffing: true });
  assert.doesNotMatch(menu, /button \(disabled\) 全螢幕/);
  await app.click(find(menu, /button 全螢幕/));
  const result = await app.getAXState({ emit: false, disableDiffing: true });
  if (expectUnavailable) {
    assert.match(result, /截圖失敗/);
    assert.match(result, /could not create image from display/);
    assert.match(result, /Value: 空白/);
    assert.match(result, /text 1130 x 732/);
    assert.doesNotMatch(result, /Value: 截圖/);
    return result;
  }
  assert.match(result, /Value: 截圖/);
  assert.match(result, /text \d+ x \d+/);
  assert.match(result, /已開啟圖片/);
  assert.doesNotMatch(result, /截圖失敗/);
  return result;
}
