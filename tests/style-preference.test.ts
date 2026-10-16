import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readStylePreference, TOOL_SIZES } from '../src/document.ts';

test('preferences keep explicit levels, migrate old sizes and reject invalid stored input', () => {
  for (let sizeLevel = 1; sizeLevel <= 5; sizeLevel++) {
    const preference = { color: '#12abef', sizeLevel };
    assert.deepEqual(readStylePreference(JSON.stringify(preference)), preference);
    assert.deepEqual(readStylePreference(JSON.stringify({ color: '#12abef', size: TOOL_SIZES[sizeLevel - 1] })), preference);
  }
  assert.deepEqual(readStylePreference('{"color":"#ABCDEF","size":23.5}'), { color: '#abcdef', sizeLevel: 3 });
  assert.deepEqual(readStylePreference('{"color":"#123456","sizeLevel":4,"size":1}'), { color: '#123456', sizeLevel: 4 });
  for (const customColor of [true, false]) {
    const preference = { color: '#ff2600', sizeLevel: 2, customColor };
    assert.deepEqual(readStylePreference(JSON.stringify(preference)), preference, 'the same RGB can retain either color-picker choice');
  }
  const fallback = { color: '#ff2600', sizeLevel: 2 };
  for (const value of [null, '', '{broken', 'null', '[]', '{}',
    '{"color":"red","size":18}', '{"color":"#123456","size":"18"}',
    '{"color":"#123456","size":0}', '{"color":"#123456","size":101}',
    '{"color":"#123456","size":1e999}',
    ...[0, 6, 1.5, '2', null].map(sizeLevel => JSON.stringify({ color: '#123456', sizeLevel, size: TOOL_SIZES[0] }))]) {
    assert.deepEqual(readStylePreference(value), fallback);
  }
});
