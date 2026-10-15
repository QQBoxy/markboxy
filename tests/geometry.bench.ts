import { readFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { arrowPath, type Arrow } from '../src/arrow.ts';

const samples: Arrow[] = JSON.parse(readFileSync(new URL('./fixtures/skitch-arrow-matrix.json', import.meta.url), 'utf8'));
const timings: number[] = [];
let characters = 0;
for (let frame = 0; frame < 70; frame++) {
  const start = performance.now();
  for (let i = 0; i < 500; i++) characters += arrowPath(samples[i % samples.length]!).length;
  if (frame >= 10) timings.push(performance.now() - start);
}
timings.sort((a, b) => a - b);
console.log(JSON.stringify({ scope: '500 arrow geometry paths only; excludes Canvas drawing, shadows, UI and browser memory', node: process.version, architecture: process.arch, iterations: timings.length, p50Ms: timings[Math.floor(timings.length * .5)], p95Ms: timings[Math.floor(timings.length * .95)], characters }, null, 2));
