import assert from 'node:assert/strict';
import { test } from 'node:test';
import { expandedScene, imageHeader, shapePath, shapeStroke, TOOL_SIZES } from '../src/document.ts';

test('shape geometry handles reverse drags and includes thick strokes when expanding', () => {
  const item = { kind: 'rectangle' as const, start: { x: 80, y: 70 }, end: { x: 20, y: 10 }, color: '#123456', size: TOOL_SIZES[4] };
  assert.equal(shapePath(item), 'M20,10h60v60h-60Z');
  assert.match(shapePath({ ...item, kind: 'ellipse' }), /a30,30/);
  assert.equal(shapePath({ ...item, end: item.start }), '');
  const expanded = expandedScene(80, 70, item);
  assert.equal(expanded.width, 98); assert.equal(expanded.height, 96);
  assert.throws(() => expandedScene(4096, 4096, { ...item, end: { x: 5000, y: 10 } }));
});
test('image headers reject oversized, truncated and disguised files before decoding', () => {
  const png = new Uint8Array(24);
  png.set([137,80,78,71,13,10,26,10]);
  const view = new DataView(png.buffer);
  view.setUint32(12, 0x49484452); view.setUint32(16, 640); view.setUint32(20, 480);
  assert.deepEqual(imageHeader(png), { width: 640, height: 480, mime: 'image/png' });
  view.setUint32(16, 99999); assert.throws(() => imageHeader(png), /4096/);
  assert.throws(() => imageHeader(new TextEncoder().encode('<svg onload="alert(1)">')));
  assert.throws(() => imageHeader(Uint8Array.of(255,216,255,192,0,17,8)));
  const jpeg = Uint8Array.of(255,216,255,192,0,8,8,1,224,2,128,3);
  assert.deepEqual(imageHeader(jpeg), { width: 640, height: 480, mime: 'image/jpeg' });
});

test('project round trip retains annotations and crop and rejects unsupported or unsafe inputs', async () => {
  const { validateProject, readProject } = await import('../src/document.ts');
  const project = { format: 'markboxy', version: 2, name: '測試', width: 1130, height: 732, crop: { x: 20, y: 30, width: 600, height: 400 }, background: null, annotations: [{ start: { x: 30, y: 40 }, end: { x: 400, y: 300 }, size: 28, color: '#123456', kind: 'arrow' }] };
  assert.deepEqual(validateProject(JSON.parse(JSON.stringify(project))), project);
  assert.deepEqual((await readProject(new Blob([JSON.stringify(project)]))).project, project);
  for (const bad of [{ ...project, version: 1 }, { ...project, width: Infinity }, { ...project, crop: { x: 1000, y: 0, width: 500, height: 20 } }, { ...project, annotations: [...project.annotations, { ...project.annotations[0], color: 'url(http://evil)' }] }, { ...project, background: { src: 'https://example.com/a.png', x: 0, y: 0, width: 10, height: 10 } }]) assert.throws(() => validateProject(bad));
  await assert.rejects(readProject(new Blob(['{bad json'])));
});


test('five shape stroke widths match the native exports', () => {
  const expected = [1.1221449851042702, 3.3664349553128106, 7.855014895729891, 16.832174776564052, 34.786494538232375];
  TOOL_SIZES.forEach((size, i) => assert.ok(Math.abs(shapeStroke(size) - expected[i]!) < 1e-10));
});

test('rounded boxes and horizontal/vertical lines remain editable through project round trip', async () => {
  const { readProject } = await import('../src/document.ts');
  const base = { start: { x: 10, y: 10 }, end: { x: 90, y: 70 }, size: TOOL_SIZES[1], color: '#ff2600' };
  const rounded = { ...base, kind: 'roundedRectangle' as const };
  assert.match(shapePath(rounded), /a12,12/);
  assert.equal(shapePath({ ...rounded, start: rounded.end, end: rounded.start }), shapePath(rounded));
  assert.match(shapePath({ ...rounded, end: { x: 18, y: 14 } }), /a2,2/);
  const horizontal = { ...base, kind: 'line' as const, end: { x: 90, y: 10 } };
  const vertical = { ...horizontal, end: { x: 10, y: 70 } };
  assert.notEqual(shapePath(horizontal), ''); assert.notEqual(shapePath(vertical), '');
  assert.equal(shapePath({ ...horizontal, end: horizontal.start }), '');
  const project = { format: 'markboxy', version: 2, name: '四種圖形', width: 100, height: 100, crop: null, background: null, annotations: [rounded, horizontal, vertical] };
  assert.deepEqual((await readProject(new Blob([JSON.stringify(project)]))).project, project);
});
