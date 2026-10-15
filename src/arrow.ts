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
