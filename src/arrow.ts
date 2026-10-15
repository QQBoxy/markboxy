export type Point = { x: number; y: number };
export type Arrow = { start: Point; end: Point; size: number; color: string };

export const referenceArrow: Arrow = {
  start: { x: 159.14417177914112, y: 224.5398773006135 },
  end: { x: 540.861963190184, y: 348.0368098159509 },
  size: 58.35153922542205,
  color: '#1977ff',
};

/** A sample-calibrated outline, not a claim to recover Skitch's full algorithm. */
export function arrowPath({ start, end, size }: Pick<Arrow, 'start' | 'end' | 'size'>): string {
  if (![start.x, start.y, end.x, end.y, size].every(Number.isFinite) || size <= 0) {
    throw new RangeError('Arrow coordinates must be finite and size must be positive.');
  }
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const length = Math.hypot(dx, dy);
  if (!Number.isFinite(length)) throw new RangeError('Arrow length is too large.');
  if (length < 0.01) return '';

  // ponytail: calibrated from one outline; add targeted samples before claiming full Skitch parity.
  // Limit thickness on short arrows to keep the head and neck from crossing the tail.
  const s = Math.min(size, length * 0.28);
  const neck = length - s * 1.5696543677;
  const head = length - s * 1.7266294603;
  const point = (x: number, y: number) => {
    const px = start.x + (x * dx - y * dy) / length;
    const py = start.y + (x * dy + y * dx) / length;
    return `${px.toFixed(6)},${py.toFixed(6)}`;
  };
  return [
    `M${point(0, -s * 0.08)}`,
    `C${point(neck * 0.5, -s * 0.1581)} ${point(neck * 0.82395717, -s * 0.2362037)} ${point(neck, -s * 0.39241195)}`,
    `L${point(head, -s * 0.86331014)}`,
    `L${point(length, 0)}`,
    `L${point(head, s * 0.86331014)}`,
    `L${point(neck, s * 0.39241195)}`,
    `C${point(neck * 0.82395717, s * 0.2362037)} ${point(neck * 0.5, s * 0.1581)} ${point(0, s * 0.08)}`,
    `C${point(-s * 0.11979353, s * 0.07295007)} ${point(-s * 0.11979353, -s * 0.07295007)} ${point(0, -s * 0.08)}Z`,
  ].join('');
}

/** Exact extrema of this arrow's lines and cubic curves, excluding shadow/handles. */
export function expandedCanvas(width: number, height: number, arrow: Arrow) {
  if (![width, height].every(value => Number.isFinite(value) && value > 0)) throw new RangeError('Invalid canvas size.');
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
  const offsetX = Math.max(0, -Math.floor(Math.min(...extrema.map(p => p.x))));
  const offsetY = Math.max(0, -Math.floor(Math.min(...extrema.map(p => p.y))));
  const nextWidth = Math.max(width, Math.ceil(Math.max(...extrema.map(p => p.x)))) + offsetX;
  const nextHeight = Math.max(height, Math.ceil(Math.max(...extrema.map(p => p.y)))) + offsetY;
  // ponytail: bound P0 canvas/data-URL memory; revisit with large-image/Blob export.
  if (nextWidth > 4096 || nextHeight > 4096) throw new RangeError('畫布延展上限為 4096 × 4096 像素。');
  return { width: nextWidth, height: nextHeight, offsetX, offsetY };
}
