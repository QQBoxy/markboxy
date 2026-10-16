import { arrowPath, expandedCanvas, type Arrow } from './arrow.ts';

export type Annotation = Arrow & { kind?: 'arrow' | 'rectangle' | 'roundedRectangle' | 'ellipse' | 'line' };
export type Background = { src: string; image: HTMLImageElement; x: number; y: number; width: number; height: number };
export const MAX_SIDE = 4096;
export const MAX_FILE_BYTES = 20 * 1024 * 1024;

export const TOOL_SIZES = [8.977159880834161, 17.954319761668323, 26.931479642502484, 35.908639523336646, 58.35153922542205] as const;
const SHAPE_STROKES = [1.1221449851042702, 3.3664349553128106, 7.855014895729891, 16.832174776564052, 34.786494538232375] as const;
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
  const { start: a, end: b } = item;
  if (![a.x, a.y, b.x, b.y, item.size].every(Number.isFinite) || item.size <= 0) throw new RangeError('無效的圖形座標。');
  const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y), w = Math.abs(a.x - b.x), h = Math.abs(a.y - b.y);
  if (item.kind === 'line') return Math.hypot(w, h) < .01 ? '' : `M${a.x},${a.y}L${b.x},${b.y}`;
  if (w < .01 || h < .01) return '';
  if (item.kind === 'rectangle') return `M${x},${y}h${w}v${h}h${-w}Z`;
  if (item.kind === 'roundedRectangle') {
    // ponytail: fixed 12px radius clamped to the box; revisit with measured original corner samples.
    const r = Math.min(12, w / 2, h / 2);
    return `M${x+r},${y}h${w-2*r}a${r},${r} 0 0 1 ${r},${r}v${h-2*r}a${r},${r} 0 0 1 ${-r},${r}h${2*r-w}a${r},${r} 0 0 1 ${-r},${-r}v${2*r-h}a${r},${r} 0 0 1 ${r},${-r}Z`;
  }
  return `M${x},${y + h / 2}a${w / 2},${h / 2} 0 1 0 ${w},0a${w / 2},${h / 2} 0 1 0 ${-w},0Z`;
}
export function expandedScene(width: number, height: number, item: Annotation) {
  if (!item.kind || item.kind === 'arrow') return expandedCanvas(width, height, item);
  const margin = shapeStroke(item.size) / 2;
  const offsetX = Math.max(0, -Math.floor(Math.min(item.start.x, item.end.x) - margin));
  const offsetY = Math.max(0, -Math.floor(Math.min(item.start.y, item.end.y) - margin));
  const nextWidth = Math.max(width, Math.ceil(Math.max(item.start.x, item.end.x) + margin)) + offsetX;
  const nextHeight = Math.max(height, Math.ceil(Math.max(item.start.y, item.end.y) + margin)) + offsetY;
  if (nextWidth > MAX_SIDE || nextHeight > MAX_SIDE) throw new RangeError('畫布延展上限為 4096 × 4096 像素。');
  return { width: nextWidth, height: nextHeight, offsetX, offsetY };
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
  if (width > MAX_SIDE || height > MAX_SIDE) throw new Error('圖片每邊最多 4096 像素。');
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
export function validateProject(value: unknown): Project {
  const fail = (): never => { throw new Error('文件格式無效或版本不支援，原文件仍保留。'); };
  const object = (v: unknown): Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : fail();
  const number = (v: unknown, min: number, max: number) => typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max ? v : fail();
  const integer = (v: unknown, min: number, max: number) => { const n = number(v, min, max); return Number.isInteger(n) ? n : fail(); };
  const p = object(value);
  if (p.format !== 'markboxy' || p.version !== 2 || typeof p.name !== 'string' || p.name.length > 100) fail();
  const width = integer(p.width, 1, MAX_SIDE), height = integer(p.height, 1, MAX_SIDE);
  let crop: Crop | null = null;
  if (p.crop !== null) {
    const c = object(p.crop);
    crop = { x: integer(c.x, 0, width - 1), y: integer(c.y, 0, height - 1), width: integer(c.width, 1, width), height: integer(c.height, 1, height) };
    if (crop.x + crop.width > width || crop.y + crop.height > height) fail();
  }
  if (!Array.isArray(p.annotations) || p.annotations.length > 500) fail();
  const annotations = (p.annotations as unknown[]).map(v => {
    const a = object(v), s = object(a.start), e = object(a.end);
    if (a.kind !== undefined && !['arrow', 'rectangle', 'roundedRectangle', 'ellipse', 'line'].includes(String(a.kind))) fail();
    if (typeof a.color !== 'string' || !/^#[0-9a-f]{6}$/i.test(a.color)) fail();
    const item: Annotation = { kind: a.kind as Annotation['kind'], color: a.color as string, size: number(a.size, 1, 100), start: { x: number(s.x, -MAX_SIDE, MAX_SIDE * 2), y: number(s.y, -MAX_SIDE, MAX_SIDE * 2) }, end: { x: number(e.x, -MAX_SIDE, MAX_SIDE * 2), y: number(e.y, -MAX_SIDE, MAX_SIDE * 2) } };
    if (!shapePath(item)) fail();
    return item;
  });
  let background: Project['background'] = null;
  if (p.background !== null) {
    const b = object(p.background);
    if (typeof b.src !== 'string' || b.src.length > Math.ceil(MAX_FILE_BYTES * 4 / 3) + 32 || !/^data:image\/(png|jpeg);base64,[A-Za-z0-9+/]+={0,2}$/.test(b.src)) fail();
    background = { src: b.src as string, x: integer(b.x, 0, MAX_SIDE), y: integer(b.y, 0, MAX_SIDE), width: integer(b.width, 1, MAX_SIDE), height: integer(b.height, 1, MAX_SIDE) };
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
    if (decoded.width !== b.width || decoded.height !== b.height || !b.src.startsWith(`data:${imageHeader(bytes).mime};`)) throw new Error('內嵌圖片尺寸或格式不符。');
    background = { ...decoded, x: b.x, y: b.y };
  }
  return { project, background };
}
