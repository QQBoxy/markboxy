import { MAX_PIXELS, arrowPath, expandedCanvas, type Arrow, type Point } from './arrow.ts';

export type Annotation = Arrow & {
  kind?: 'arrow' | 'rectangle' | 'roundedRectangle' | 'ellipse' | 'line' | 'text' | 'pen' | 'highlighter';
  text?: string; fontSize?: number;
  /** Each stroke is local to start, so moving the object preserves all subpaths. */
  strokes?: Point[][];
};
export type Background = { src: string; image: HTMLImageElement; x: number; y: number; width: number; height: number };
export const MAX_FILE_BYTES = 20 * 1024 * 1024;

export const TOOL_SIZES = [8.977159880834161, 17.954319761668323, 26.931479642502484, 35.908639523336646, 58.35153922542205] as const;
export function readStylePreference(value: string | null): { color: string; sizeLevel: number; customColor?: boolean } {
  try {
    const style = JSON.parse(value ?? 'null');
    if (style && typeof style.color === 'string' && /^#[0-9a-f]{6}$/i.test(style.color)) {
      const color = { color: style.color.toLowerCase(), ...(typeof style.customColor === 'boolean' ? { customColor: style.customColor } : {}) };
      if (Number.isInteger(style.sizeLevel) && style.sizeLevel >= 1 && style.sizeLevel <= 5) {
        return { ...color, sizeLevel: style.sizeLevel };
      }
      // One-time compatibility with the earlier preference format; new choices store the level directly.
      if (style.sizeLevel === undefined && typeof style.size === 'number' && Number.isFinite(style.size) && style.size >= 1 && style.size <= 100) {
        const distances = TOOL_SIZES.map(size => Math.abs(size - style.size));
        return { ...color, sizeLevel: distances.indexOf(Math.min(...distances)) + 1 };
      }
    }
  } catch { /* A damaged preference must not prevent opening the editor. */ }
  return { color: '#ff2600', sizeLevel: 2 };
}
const SHAPE_STROKES = [1.1221449851042702, 3.3664349553128106, 7.855014895729891, 16.832174776564052, 34.786494538232375] as const;
export const isInk = (item: Annotation) => item.kind === 'pen' || item.kind === 'highlighter';
export const inkAlpha = (elapsed: number) => Math.min(1, .25 + .75 * Math.max(0, elapsed) / 1000);
export function textSize(size: number) {
  // ponytail: native font metrics are not measured; use five explicit presets until original text samples are measured.
  const sizes = [12, 18, 24, 36, 48];
  const distances = TOOL_SIZES.map(s => Math.abs(s - size));
  return sizes[distances.indexOf(Math.min(...distances))]!;
}
export const textFont = (item: Annotation) => `400 ${item.fontSize ?? textSize(item.size)}px Arial, sans-serif`;
export function textLines(item: Annotation, measure: (text: string) => number): string[] {
  const maxWidth = Math.max(item.scale ?? 1, item.end.x - item.start.x - 16 * (item.scale ?? 1));
  const result: string[] = [];
  for (const paragraph of (item.text ?? '').split('\n')) {
    let line = '';
    // Keep words together when possible, but allow long words and Chinese text to wrap.
    for (const word of paragraph.match(/\s+|[A-Za-z0-9_]+|[^\s]/gu) ?? []) {
      if (line && measure(line + word) > maxWidth) { result.push(line); line = ''; }
      for (const character of word) {
        if (line && measure(line + character) > maxWidth) { result.push(line); line = ''; }
        line += character;
      }
    }
    result.push(line);
  }
  return result;
}
export function annotationBounds(item: Annotation) {
  if (isInk(item)) {
    let left = item.start.x, top = item.start.y, right = left, bottom = top;
    for (const stroke of item.strokes ?? []) for (const p of stroke) {
      left = Math.min(left, item.start.x + p.x); right = Math.max(right, item.start.x + p.x);
      top = Math.min(top, item.start.y + p.y); bottom = Math.max(bottom, item.start.y + p.y);
    }
    return { left, top, right, bottom };
  }
  return { left: Math.min(item.start.x, item.end.x), top: Math.min(item.start.y, item.end.y), right: Math.max(item.start.x, item.end.x), bottom: Math.max(item.start.y, item.end.y) };
}
export function shapeStroke(size: number): number {
  // ponytail: the five native presets are measured; interpolate only for custom sizes from editable files.
  if (size <= TOOL_SIZES[0]) return size * SHAPE_STROKES[0] / TOOL_SIZES[0];
  for (let i = 1; i < TOOL_SIZES.length; i++) {
    if (size <= TOOL_SIZES[i]!) return SHAPE_STROKES[i - 1]! + (size - TOOL_SIZES[i - 1]!) * (SHAPE_STROKES[i]! - SHAPE_STROKES[i - 1]!) / (TOOL_SIZES[i]! - TOOL_SIZES[i - 1]!);
  }
  return size * SHAPE_STROKES[4] / TOOL_SIZES[4];
}

export function shapePath(item: Annotation): string {
  if (!item.kind || item.kind === 'arrow') return arrowPath(item);
  if (isInk(item)) return (item.strokes ?? []).map(stroke => {
    if (!stroke.length) return '';
    const points = stroke.map(p => `${item.start.x + p.x},${item.start.y + p.y}`);
    // A tiny segment gives a single click the same round cap as a normal stroke.
    return `M${points[0]}${stroke.length === 1 ? `l${.001 * (item.scale ?? 1)},0` : `L${points.slice(1).join('L')}`}`;
  }).join('');
  const { start: a, end: b } = item;
  if (![a.x, a.y, b.x, b.y, item.size].every(Number.isFinite) || item.size <= 0) throw new RangeError('無效的圖形座標。');
  const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y), w = Math.abs(a.x - b.x), h = Math.abs(a.y - b.y);
  if (item.kind === 'line') return Math.hypot(w, h) < .01 * (item.scale ?? 1) ? '' : `M${a.x},${a.y}L${b.x},${b.y}`;
  if (w < .01 * (item.scale ?? 1) || h < .01 * (item.scale ?? 1)) return '';
  if (item.kind === 'rectangle' || item.kind === 'text') return `M${x},${y}h${w}v${h}h${-w}Z`;
  if (item.kind === 'roundedRectangle') {
    // ponytail: fixed 12px radius clamped to the box; revisit with measured original corner samples.
    const r = Math.min(12 * (item.scale ?? 1), w / 2, h / 2);
    return `M${x+r},${y}h${w-2*r}a${r},${r} 0 0 1 ${r},${r}v${h-2*r}a${r},${r} 0 0 1 ${-r},${r}h${2*r-w}a${r},${r} 0 0 1 ${-r},${-r}v${2*r-h}a${r},${r} 0 0 1 ${r},${-r}Z`;
  }
  return `M${x},${y + h / 2}a${w / 2},${h / 2} 0 1 0 ${w},0a${w / 2},${h / 2} 0 1 0 ${-w},0Z`;
}
export function expandedScene(width: number, height: number, item: Annotation) {
  if (!item.kind || item.kind === 'arrow') return expandedCanvas(width, height, item, 6 * (item.scale ?? 1));
  const margin = (item.kind === 'text' ? 4 : shapeStroke(item.size) * (item.kind === 'highlighter' ? 1 : .5) + (isInk(item) ? 0 : 6)) * (item.scale ?? 1);
  const bounds = annotationBounds(item);
  const offsetX = Math.max(0, -Math.floor(bounds.left - margin));
  const offsetY = Math.max(0, -Math.floor(bounds.top - margin));
  const nextWidth = Math.max(width, Math.ceil(bounds.right + margin)) + offsetX;
  const nextHeight = Math.max(height, Math.ceil(bounds.bottom + margin)) + offsetY;
  if (nextWidth * nextHeight > MAX_PIXELS) throw new RangeError('畫布總像素上限為 5000 萬（寬 × 高）。');
  return { width: nextWidth, height: nextHeight, offsetX, offsetY };
}

/** Union annotations with the retained canvas, without changing document coordinates. */
export function sceneFrame(base: Crop, items: Annotation[]): Crop {
  let frame = { ...base };
  for (const item of items) {
    const local = { ...item, start: { x: item.start.x - frame.x, y: item.start.y - frame.y }, end: { x: item.end.x - frame.x, y: item.end.y - frame.y } };
    const expanded = expandedScene(frame.width, frame.height, local);
    frame = { x: frame.x - expanded.offsetX, y: frame.y - expanded.offsetY, width: expanded.width, height: expanded.height };
  }
  return frame;
}

/** Read dimensions before decoding so oversized compressed images never reach the decoder. */
export function imageHeader(bytes: Uint8Array) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let width = 0, height = 0, mime = '';
  if (bytes.length >= 24 && [137,80,78,71,13,10,26,10].every((b, i) => bytes[i] === b) && view.getUint32(12) === 0x49484452) {
    width = view.getUint32(16); height = view.getUint32(20); mime = 'image/png';
  } else if (bytes.length >= 4 && bytes[0] === 255 && bytes[1] === 216) {
    let offset = 2;
    while (offset + 4 <= bytes.length) {
      if (bytes[offset++] !== 255) break;
      while (bytes[offset] === 255) offset++;
      const marker = bytes[offset++];
      if (marker === 217 || marker === 218) break;
      if (marker === 1 || (marker !== undefined && marker >= 208 && marker <= 215)) continue;
      if (offset + 2 > bytes.length) break;
      const length = view.getUint16(offset);
      if (length < 2 || offset + length > bytes.length) break;
      if (marker !== undefined && [192,193,194,195,197,198,199,201,202,203,205,206,207].includes(marker) && length >= 8) {
        height = view.getUint16(offset + 3); width = view.getUint16(offset + 5); mime = 'image/jpeg'; break;
      }
      offset += length;
    }
  }
  if (!width || !height || !mime) throw new Error('請選擇可解碼的 PNG 或 JPEG 圖片。');
  if (width * height > MAX_PIXELS) throw new Error(`圖片總像素上限為 5000 萬（寬 × 高）；這張圖片為 ${width} × ${height}。`);
  return { width, height, mime };
}
export async function loadImage(file: Blob): Promise<Background> {
  if (!file.size || file.size > MAX_FILE_BYTES) throw new Error('圖片檔案須介於 1 byte 與 20 MiB。');
  const header = imageHeader(new Uint8Array(await file.arrayBuffer()));
  const blob = file.slice(0, file.size, header.mime);
  const url = URL.createObjectURL(blob);
  const image = new Image();
  try {
    image.src = url;
    await image.decode();
    // Browsers apply EXIF orientation during JPEG decode; a quarter-turn swaps the stored axes.
    const straight = image.naturalWidth === header.width && image.naturalHeight === header.height;
    const rotated = header.mime === 'image/jpeg' && image.naturalWidth === header.height && image.naturalHeight === header.width;
    if (!straight && !rotated) throw new Error('圖片標頭與解碼尺寸不符。');
    const src = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(new Error('無法讀取圖片。'));
      reader.readAsDataURL(blob);
    });
    return { src, image, x: 0, y: 0, width: image.naturalWidth, height: image.naturalHeight };
  } catch { throw new Error('圖片損壞或瀏覽器無法解碼，原文件仍保留。'); }
  finally { URL.revokeObjectURL(url); }
}

export type Crop = { x: number; y: number; width: number; height: number };
export type Project = {
  format: 'markboxy'; version: 2; name: string; width: number; height: number;
  crop: Crop | null; annotations: Annotation[];
  background: Omit<Background, 'image'> | null;
};
/** Resize document coordinates and visual weights together, retaining editable annotations. */
export function resizeScene<T extends { width: number; height: number; crop: Crop | null; background: Background | null; arrows: Annotation[] }>(scene: T, factor: number): T {
  const width = Math.max(1, Math.round(scene.width * factor)), height = Math.max(1, Math.round(scene.height * factor));
  if (!Number.isFinite(factor) || factor <= 0 || width * height > MAX_PIXELS) throw new RangeError('縮放尺寸超過 5000 萬像素上限。');
  const point = (p: Point) => ({ x: p.x * factor, y: p.y * factor });
  const rect = (r: Crop): Crop => {
    const x = Math.min(width - 1, Math.round(r.x * factor)), y = Math.min(height - 1, Math.round(r.y * factor));
    return { x, y, width: Math.max(1, Math.min(width - x, Math.round(r.width * factor))), height: Math.max(1, Math.min(height - y, Math.round(r.height * factor))) };
  };
  return { ...scene, width, height, crop: scene.crop && rect(scene.crop),
    background: scene.background && { ...scene.background, ...rect(scene.background) },
    arrows: scene.arrows.map(item => {
      const scale = (item.scale ?? 1) * factor;
      if (scale < .000001 || scale > 1000000) throw new RangeError('標註已達可縮放範圍，請減少縮放幅度。');
      return { ...item, start: point(item.start), end: point(item.end), scale,
        ...(item.kind === 'text' ? { fontSize: (item.fontSize ?? textSize(item.size)) * factor } : {}),
        ...(item.strokes ? { strokes: item.strokes.map(stroke => stroke.map(point)) } : {}) };
    }) };
}
export function validateProject(value: unknown): Project {
  const fail = (): never => { throw new Error('文件格式無效或版本不支援，原文件仍保留。'); };
  const object = (v: unknown): Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : fail();
  const number = (v: unknown, min: number, max: number) => typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max ? v : fail();
  const integer = (v: unknown, min: number, max: number) => { const n = number(v, min, max); return Number.isInteger(n) ? n : fail(); };
  const p = object(value);
  if (p.format !== 'markboxy' || p.version !== 2 || typeof p.name !== 'string' || p.name.length > 100) fail();
  const width = integer(p.width, 1, MAX_PIXELS), height = integer(p.height, 1, MAX_PIXELS);
  if (width * height > MAX_PIXELS) fail();
  const coordinateLimit = Math.max(4096, width, height);
  let crop: Crop | null = null;
  if (p.crop !== null) {
    const c = object(p.crop);
    crop = { x: integer(c.x, 0, width - 1), y: integer(c.y, 0, height - 1), width: integer(c.width, 1, width), height: integer(c.height, 1, height) };
    if (crop.x + crop.width > width || crop.y + crop.height > height) fail();
  }
  if (!Array.isArray(p.annotations) || p.annotations.length > 500) fail();
  const annotations = (p.annotations as unknown[]).map(v => {
    const a = object(v), s = object(a.start), e = object(a.end);
    if (a.kind !== undefined && !['arrow', 'rectangle', 'roundedRectangle', 'ellipse', 'line', 'text', 'pen', 'highlighter'].includes(String(a.kind))) fail();
    if (typeof a.color !== 'string' || !/^#[0-9a-f]{6}$/i.test(a.color)) fail();
    const item: Annotation = { kind: a.kind as Annotation['kind'], color: a.color as string, size: number(a.size, 1, 100), start: { x: number(s.x, -coordinateLimit, coordinateLimit * 2), y: number(s.y, -coordinateLimit, coordinateLimit * 2) }, end: { x: number(e.x, -coordinateLimit, coordinateLimit * 2), y: number(e.y, -coordinateLimit, coordinateLimit * 2) } };
    if (a.scale !== undefined) item.scale = number(a.scale, 0.000001, 1000000);
    if (item.kind === 'text') {
      if (typeof a.text !== 'string' || !a.text.trim() || a.text.length > 10000 || item.end.x - item.start.x < 16 * (item.scale ?? 1) || item.end.y <= item.start.y) fail();
      item.text = a.text as string; item.fontSize = number(a.fontSize, 8 * (item.scale ?? 1), 256 * (item.scale ?? 1));
    } else if (isInk(item)) {
      if (!Array.isArray(a.strokes) || !a.strokes.length || a.strokes.length > 2000) fail();
      let count = 0;
      item.strokes = (a.strokes as unknown[]).map(stroke => {
        if (!Array.isArray(stroke) || !stroke.length || (count += stroke.length) > 100000) fail();
        return (stroke as unknown[]).map(point => {
          const p = object(point);
          return { x: number(p.x, -coordinateLimit * 3, coordinateLimit * 3), y: number(p.y, -coordinateLimit * 3, coordinateLimit * 3) };
        });
      });
    }
    if (!shapePath(item)) fail();
    return item;
  });
  let background: Project['background'] = null;
  if (p.background !== null) {
    const b = object(p.background);
    if (typeof b.src !== 'string' || b.src.length > Math.ceil(MAX_FILE_BYTES * 4 / 3) + 32 || !/^data:image\/(png|jpeg);base64,[A-Za-z0-9+/]+={0,2}$/.test(b.src)) fail();
    background = { src: b.src as string, x: integer(b.x, 0, width - 1), y: integer(b.y, 0, height - 1), width: integer(b.width, 1, width), height: integer(b.height, 1, height) };
    if (background.x + background.width > width || background.y + background.height > height) fail();
  }
  return { format: 'markboxy', version: 2, name: p.name as string, width, height, crop, annotations, background };
}
export async function readProject(file: Blob) {
  if (!file.size || file.size > 30 * 1024 * 1024) throw new Error('Markboxy 文件最多 30 MiB。');
  const project = validateProject(JSON.parse(await file.text()));
  let background: Background | null = null;
  if (project.background) {
    const b = project.background, comma = b.src.indexOf(',');
    const bytes = Uint8Array.from(atob(b.src.slice(comma + 1)), c => c.charCodeAt(0));
    const decoded = await loadImage(new Blob([bytes]));
    if (!b.src.startsWith(`data:${imageHeader(bytes).mime};`)) throw new Error('內嵌圖片尺寸或格式不符。');
    background = { ...decoded, ...b }; // Display bounds may differ after resizing; retain the original image bytes.
  }
  return { project, background };
}
