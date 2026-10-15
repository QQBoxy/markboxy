import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { arrowPath, expandedCanvas, referenceArrow } from '../src/arrow.ts';

const numbers = (path: string) => [...path.matchAll(/-?\d+(?:\.\d+)?/g)].map(match => Number(match[0]));

test('calibrated outline matches the saved Skitch vector within 0.002 image pixels', () => {
  const sample = JSON.parse(readFileSync(new URL('./fixtures/skitch-arrow.json', import.meta.url), 'utf8'));
  const expected = numbers(sample.path).slice(0, 28);
  const actual = numbers(arrowPath(referenceArrow));
  assert.equal(actual.length, expected.length);
  actual.forEach((value, index) => assert.ok(Math.abs(value - expected[index]) < 0.002, `coordinate ${index}: ${value} vs ${expected[index]}`));
});

test('short, medium and long arrows stay finite and point to the supplied endpoint in eight directions', () => {
  for (const length of [0.02, 2, 20, 220, 800]) {
    for (const size of [16, 28, 42, 58.35153922542205, 82]) {
      for (let direction = 0; direction < 8; direction++) {
        const angle = direction * Math.PI / 4;
        const end = { x: 500 + Math.cos(angle) * length, y: 500 + Math.sin(angle) * length };
        const values = numbers(arrowPath({ start: { x: 500, y: 500 }, end, size }));
        assert.equal(values.length, 28);
        assert.ok(values.every(Number.isFinite));
        assert.ok(Math.abs(values[10] - end.x) < 0.000001);
        assert.ok(Math.abs(values[11] - end.y) < 0.000001);
      }
    }
  }
});

test('zero-length geometry is empty; invalid input is rejected', () => {
  assert.equal(arrowPath({ ...referenceArrow, end: { ...referenceArrow.start } }), '');
  for (const size of [0, -1, NaN, Infinity]) assert.throws(() => arrowPath({ ...referenceArrow, size }), RangeError);
  assert.throws(() => arrowPath({ ...referenceArrow, start: { x: NaN, y: 0 } }), RangeError);
});

test('translation and quarter-turn rotate the complete outline without changing its shape', () => {
  const original = numbers(arrowPath(referenceArrow));
  const transform = ({ x, y }: { x: number; y: number }) => ({ x: 900 - y, y: 50 + x });
  const rotated = numbers(arrowPath({ ...referenceArrow, start: transform(referenceArrow.start), end: transform(referenceArrow.end) }));
  for (let i = 0; i < original.length; i += 2) {
    assert.ok(Math.abs(rotated[i] - (900 - original[i + 1])) < 0.000002);
    assert.ok(Math.abs(rotated[i + 1] - (50 + original[i])) < 0.000002);
  }
});

test('canvas expands for the entire outline and rebases left/top overflow without clipping other arrows', () => {
  assert.deepEqual(expandedCanvas(1130, 732, referenceArrow), { width: 1130, height: 732, offsetX: 0, offsetY: 0 });
  const right = expandedCanvas(1130, 732, { ...referenceArrow, end: { x: 1153, y: 670 } });
  assert.equal(right.width, 1153);
  assert.equal(right.height, 732);
  const below = expandedCanvas(1130, 732, { ...referenceArrow, end: { x: 460, y: 756 } });
  assert.equal(below.height, 756);
  const left = { ...referenceArrow, start: { x: -20, y: 100 }, end: { x: 200, y: 100 } };
  const grown = expandedCanvas(1130, 732, left);
  assert.ok(grown.offsetX > 20, 'include the curved tail beyond the start point');
  assert.equal(grown.width, 1130 + grown.offsetX);
  const shifted = { ...left, start: { x: left.start.x + grown.offsetX, y: 100 }, end: { x: left.end.x + grown.offsetX, y: 100 } };
  assert.deepEqual(expandedCanvas(grown.width, grown.height, shifted), { ...grown, offsetX: 0 });
  const above = expandedCanvas(1130, 732, { ...referenceArrow, start: { x: 100, y: -25 }, end: { x: 200, y: 100 } });
  assert.ok(above.offsetY >= 25);
  assert.equal(above.height, 732 + above.offsetY);
  assert.throws(() => expandedCanvas(1130, 732, { ...referenceArrow, end: { x: 5000, y: 200 } }), RangeError);
});
