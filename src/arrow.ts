// ponytail: 50 MP bounds full-size surface memory; raise only after large-image device tests.
export const MAX_PIXELS = 50_000_000;

export type Point = { x: number; y: number };
export type Arrow = { start: Point; end: Point; size: number; color: string; scale?: number };

export const referenceArrow: Arrow = {
  start: { x: 159.14417177914112, y: 224.5398773006135 },
  end: { x: 540.861963190184, y: 348.0368098159509 },
  size: 58.35153922542205,
  color: '#1977ff',
};

/** Skitch outline reconstructed from runtime exports and the native geometry procedure. */
export function arrowPath({ start, end, size, scale = 1 }: Pick<Arrow, 'start' | 'end' | 'size' | 'scale'>): string {
  if (![start.x, start.y, end.x, end.y, size, scale].every(Number.isFinite) || size <= 0 || scale <= 0) {
    throw new RangeError('Arrow coordinates must be finite and size must be positive.');
  }
  const dx = end.x - start.x, dy = end.y - start.y;
  const length = Math.hypot(dx, dy);
  if (!Number.isFinite(length)) throw new RangeError('Arrow length is too large.');
  if (length < 0.01 * scale) return '';
  // 120 original vectors cover five native sizes, three lengths and eight directions.
  const s = Math.min(size * scale, length / 5);
  const headScale = (s - 1.5 * scale) * .7 + 6 * scale;
  const headLength = Math.min(length * .4, Math.max(6 * scale, headScale * 2));
  const tail = Math.max(s * .08, 1.5 * scale);
  const neckHalf = Math.max(tail, Math.min(headLength * .25, headScale * .5));
  const neck = length - headLength, head = length - headLength * 1.1;
  const headHalf = headLength * .55;
  const c1x = neck * .5, c2x = (length * .5 + neck) * .5;
  const c2y = (tail + neckHalf) * .5, c1y = (tail + c2y) * .5;
  const tangent = Math.hypot(neck, neckHalf - tail);
  const capX = -tail * 1.5 * neck / tangent;
  const capY = tail - tail * 1.5 * (neckHalf - tail) / tangent;
  const point = (x: number, y: number) => {
    const px = start.x + (x * dx - y * dy) / length;
    const py = start.y + (x * dy + y * dx) / length;
    return `${px.toFixed(6)},${py.toFixed(6)}`;
  };
  return [
    `M${point(0, -tail)}`,
    `C${point(c1x, -c1y)} ${point(c2x, -c2y)} ${point(neck, -neckHalf)}`,
    `L${point(head, -headHalf)}L${point(length, 0)}L${point(head, headHalf)}L${point(neck, neckHalf)}`,
    `C${point(c2x, c2y)} ${point(c1x, c1y)} ${point(0, tail)}`,
    `C${point(capX, capY)} ${point(capX, -capY)} ${point(0, -tail)}Z`,
  ].join('');
}

/** Exact extrema of this arrow's lines and cubic curves, excluding shadow/handles. */
export function expandedCanvas(width: number, height: number, arrow: Arrow, margin = 0) {
  if (![width, height].every(value => Number.isFinite(value) && value > 0)) throw new RangeError('Invalid canvas size.');
  if (!Number.isFinite(margin) || margin < 0) throw new RangeError('Invalid canvas margin.');
  const values = [...arrowPath(arrow).matchAll(/-?\d+(?:\.\d+)?/g)].map(match => Number(match[0]));
  if (!values.length) return { width, height, offsetX: 0, offsetY: 0 };
  const points = Array.from({ length: values.length / 2 }, (_, i) => ({ x: values[i * 2]!, y: values[i * 2 + 1]! }));
  const extrema = [points[0]!, ...points.slice(3, 8), points[10]!, points[13]!];
  for (const [start, c1, c2, end] of [[0, 1, 2, 3], [7, 8, 9, 10], [10, 11, 12, 13]]) {
    for (const axis of ['x', 'y'] as const) {
      const p0 = points[start!]![axis], p1 = points[c1!]![axis], p2 = points[c2!]![axis], p3 = points[end!]![axis];
      const a = -p0 + 3 * p1 - 3 * p2 + p3;
      const b = 2 * (p0 - 2 * p1 + p2);
      const c = p1 - p0;
      const discriminant = b * b - 4 * a * c;
      const roots = Math.abs(a) < 1e-10 ? (Math.abs(b) < 1e-10 ? [] : [-c / b]) :
        discriminant < 0 ? [] : [(-b + Math.sqrt(discriminant)) / (2 * a), (-b - Math.sqrt(discriminant)) / (2 * a)];
      for (const t of roots.filter(t => t > 0 && t < 1)) {
        const point = { x: 0, y: 0 };
        for (const component of ['x', 'y'] as const) {
          point[component] = (1 - t) ** 3 * points[start!]![component] + 3 * (1 - t) ** 2 * t * points[c1!]![component] +
            3 * (1 - t) * t * t * points[c2!]![component] + t ** 3 * points[end!]![component];
        }
        extrema.push(point);
      }
    }
  }
  const offsetX = Math.max(0, -Math.floor(Math.min(...extrema.map(p => p.x)) - margin));
  const offsetY = Math.max(0, -Math.floor(Math.min(...extrema.map(p => p.y)) - margin));
  const nextWidth = Math.max(width, Math.ceil(Math.max(...extrema.map(p => p.x)) + margin)) + offsetX;
  const nextHeight = Math.max(height, Math.ceil(Math.max(...extrema.map(p => p.y)) + margin)) + offsetY;
  if (nextWidth * nextHeight > MAX_PIXELS) throw new RangeError('畫布總像素上限為 5000 萬（寬 × 高）。');
  return { width: nextWidth, height: nextHeight, offsetX, offsetY };
}
