import assert from 'node:assert/strict';

// Run through cua_repl on a fresh window with a copied PNG/JPEG in the system clipboard.
export async function checkImagePaste(app, dimensions) {
  let state = await app.getAXState({ emit: false, disableDiffing: true });
  assert.match(state, /text 1130 x 732/);
  await app.pressKey('super+v');
  state = await app.getAXState({ emit: false, disableDiffing: true });
  assert.ok(state.includes(`text ${dimensions}`), 'paste imports image at natural dimensions');
  assert.match(state, /已開啟圖片/);
  assert.match(state, /button 清除畫布/, 'pasted image becomes document background');
  await app.pressKey('super+v');
  state = await app.getAXState({ emit: false, disableDiffing: true });
  assert.match(state, /會取代目前文件/);
  const cancel = state.match(/^\s*(\d+) button Cancel,/m);
  assert.ok(cancel);
  await app.click(Number(cancel[1]));
  state = await app.getAXState({ emit: false, disableDiffing: true });
  assert.ok(state.includes(`text ${dimensions}`), 'cancel preserves previous image');
  await app.pressKey('super+z');
  state = await app.getAXState({ emit: false, disableDiffing: true });
  assert.match(state, /text 1130 x 732/, 'undo restores blank document');
  assert.match(state, /button \(disabled\) 清除畫布/, 'undo removes pasted background');
  await app.pressKey('super+shift+z');
  state = await app.getAXState({ emit: false, disableDiffing: true });
  assert.ok(state.includes(`text ${dimensions}`), 'redo restores pasted image');
  assert.match(state, /button 清除畫布/);
}

export async function checkSilentDelete(app) {
  await app.drag([300, 300], [600, 500]);
  await app.getAXState({ emit: false });
  await app.click([450, 400]);
  await app.getAXState({ emit: false });
  await app.pressKey('BackSpace');
  let state = await app.getAXState({ emit: false, disableDiffing: true });
  assert.match(state, /button \(disabled\) 清除畫布/);
  assert.doesNotMatch(state, /已刪除|復原刪除/);
  await app.pressKey('super+z');
  state = await app.getAXState({ emit: false, disableDiffing: true });
  assert.match(state, /button 清除畫布/, 'silent delete remains undoable');
}
