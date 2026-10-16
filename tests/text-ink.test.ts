import assert from 'node:assert/strict';
import { test } from 'node:test';
import { annotationBounds, expandedScene, inkAlpha, readProject, shapePath, textLines, TOOL_SIZES, validateProject, type Annotation } from '../src/document.ts';

const pen: Annotation = { kind: 'pen', start: { x: 30, y: 40 }, end: { x: 30, y: 40 }, color: '#ff2600', size: TOOL_SIZES[1], strokes: [[{ x: 0, y: 0 }, { x: 100, y: 20 }], [{ x: -50, y: 60 }]] };
const text: Annotation = { kind: 'text', start: { x: 10, y: 10 }, end: { x: 76, y: 100 }, color: '#123456', size: TOOL_SIZES[1], fontSize: 18, text: '中文 ABC\n第二行' };
const project = { format: 'markboxy', version: 2, name: '文字與筆畫', width: 400, height: 300, crop: null, background: null, annotations: [text, pen] };

test('compound ink keeps separate strokes and dots when moved, and expands for negative local points', () => {
  assert.equal(shapePath(pen), 'M30,40L130,60M-20,100l0.001,0');
  assert.deepEqual(annotationBounds(pen), { left: -20, top: 40, right: 130, bottom: 100 });
  const moved = { ...pen, start: { x: 40, y: 50 } };
  assert.equal(shapePath(moved), 'M40,50L140,70M-10,110l0.001,0');
  assert.ok(expandedScene(100, 100, pen).offsetX > 20);
  assert.throws(() => expandedScene(4096, 4096, { ...pen, start: { x: 4090, y: 0 } }));
  assert.deepEqual([inkAlpha(-100), inkAlpha(0), inkAlpha(500), inkAlpha(1000), inkAlpha(5000)], [.25, .25, .625, 1, 1]);
});

test('text wrapping retains manual newlines, whole words where possible and Unicode characters', () => {
  const measure = (value: string) => Array.from(value).length * 10;
  assert.deepEqual(textLines(text, measure), ['中文 ', 'ABC', '第二行']);
  assert.deepEqual(textLines({ ...text, end: { x: 250, y: 100 } }, measure), ['中文 ABC', '第二行']);
  assert.deepEqual(textLines({ ...text, text: '😀😀😀😀😀😀\n\n長字串', end: { x: 46, y: 100 } }, measure), ['😀😀', '😀😀', '😀😀', '', '長字', '串']);
});

test('editable project retains text and multi-stroke groups and rejects malformed payloads', async () => {
  assert.deepEqual((await readProject(new Blob([JSON.stringify(project)]))).project, project);
  for (const bad of [
    { ...text, fontSize: Infinity }, { ...text, fontSize: 400 }, { ...text, text: '' }, { ...text, text: 'x'.repeat(10001) },
    { ...pen, strokes: [] }, { ...pen, strokes: [[]] }, { ...pen, strokes: [[{ x: NaN, y: 0 }]] },
    { ...pen, strokes: [[{ x: 20000, y: 0 }]] }, { ...pen, strokes: [Array(100001).fill({ x: 0, y: 0 })] },
  ]) assert.throws(() => validateProject({ ...project, annotations: [bad] }));
});
