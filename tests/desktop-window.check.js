import assert from 'node:assert/strict';

// Run through cua_repl on a fresh isolated Markboxy Test.app (1268 × 900).
export async function checkIndependentWindows(app) {
  let state = await app.getAXState({ emit: false, disableDiffing: true });
  assert.match(state, /button \(disabled\) 清除畫布/, 'startup is blank');
  await app.drag([300, 300], [600, 500]);
  await app.getAXState({ emit: false });
  await app.pressKey('super+n');
  state = await app.getAXState({ emit: false, disableDiffing: true });
  assert.match(state, /button \(disabled\) 清除畫布/, 'new window has its own blank document');
  const close = state.match(/^\s*(\d+) close button$/m);
  assert.ok(close, 'native window close control exists');
  await app.click(Number(close[1]));
  state = await app.getAXState({ emit: false, disableDiffing: true });
  assert.match(state, /button 清除畫布/, 'closing blank window preserves previous document');
  const editedClose = state.match(/^\s*(\d+) close button$/m);
  assert.ok(editedClose);
  await app.click(Number(editedClose[1]));
  state = await app.getAXState({ emit: false, disableDiffing: true });
  assert.match(state, /尚有未儲存的編輯/);
  const cancel = state.match(/^\s*(\d+) button 取消/m);
  assert.ok(cancel);
  await app.click(Number(cancel[1]));
  state = await app.getAXState({ emit: false, disableDiffing: true });
  assert.match(state, /button 清除畫布/, 'cancel preserves edited window');
}
