import assert from 'node:assert/strict';
import { test } from 'node:test';
import { arrowPath } from '../src/arrow.ts';
import { resizeScene, shapePath, shapeStroke, textLines, validateProject, TOOL_SIZES, type Annotation, type Background } from '../src/document.ts';

test('resize preserves arrow outlines, crop, background and compound strokes without mutating undo state', () => {
  const arrow: Annotation = { start: { x: 100, y: 100 }, end: { x: 700, y: 400 }, size: TOOL_SIZES[1], color: '#ff2600' };
  const ink: Annotation = { ...arrow, kind: 'pen', strokes: [[{ x: 0, y: 0 }, { x: 10, y: 20 }], [{ x: 30, y: 40 }]] };
  const rounded: Annotation = { ...arrow, kind: 'roundedRectangle' };
  const background = { src: 'data:image/png;base64,YQ==', image: {}, x: 0, y: 0, width: 1396, height: 769 } as Background;
  const scene = { width: 1396, height: 769, crop: { x: 20, y: 30, width: 1000, height: 600 }, background, arrows: [arrow, ink, rounded] };
  const saved = JSON.stringify(scene);
  const resized = resizeScene(scene, .6);
  assert.equal(JSON.stringify(scene), saved);
  assert.equal(resized.width, 838); assert.equal(resized.height, 461);
  assert.deepEqual(resized.crop, { x: 12, y: 18, width: 600, height: 360 });
  assert.equal(resized.background!.image, background.image);
  assert.equal(resized.background!.width, 838);
  assert.equal(resized.arrows[1]!.strokes![1]![0]!.x, 18);
  const originalPoints = arrowPath(arrow).match(/-?\d+(?:\.\d+)?/g)!.map(Number);
  const nextPoints = arrowPath(resized.arrows[0]!).match(/-?\d+(?:\.\d+)?/g)!.map(Number);
  originalPoints.forEach((n, i) => assert.ok(Math.abs(nextPoints[i]! - n * .6) < .000002));
  assert.match(shapePath(resized.arrows[2]!), /a7.199999999999999,7.199999999999999|a7.2,7.2/);
  assert.equal(shapeStroke(arrow.size) * resized.arrows[0]!.scale!, shapeStroke(arrow.size) * .6);
  for (const factor of [NaN, Infinity, 0, -1, 100]) assert.throws(() => resizeScene(scene, factor));
});

test('resized editable documents retain style scale and text wrapping through validation', () => {
  const item: Annotation = { kind: 'text', start: { x: 10, y: 10 }, end: { x: 200, y: 100 }, size: TOOL_SIZES[1], fontSize: 18, color: '#ff2600', text: 'ABC 中文\n第二行' };
  const scene = { width: 400, height: 300, crop: null, background: null, arrows: [item] };
  const resized = resizeScene(resizeScene(scene, .1), 1.9);
  assert.deepEqual(textLines(resized.arrows[0]!, s => s.length * 10 * .19), textLines(item, s => s.length * 10));
  const project = { format: 'markboxy', version: 2, name: '縮放', ...resized, annotations: resized.arrows };
  assert.deepEqual(validateProject(JSON.parse(JSON.stringify(project))).annotations, resized.arrows);
  for (const scale of [0, NaN, Infinity, 1000001]) assert.throws(() => validateProject({ ...project, annotations: [{ ...resized.arrows[0], scale }] }));
});
