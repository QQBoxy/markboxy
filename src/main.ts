import './style.css';
import { arrowPath, referenceArrow, type Arrow, type Point } from './arrow.ts';

const WIDTH = 1130;
const HEIGHT = 732;
const canvas = document.querySelector<HTMLCanvasElement>('#canvas')!;
const workspace = document.querySelector<HTMLElement>('#workspace')!;
const stage = document.querySelector<HTMLElement>('#stage')!;
const download = document.querySelector<HTMLAnchorElement>('#download')!;
const name = document.querySelector<HTMLInputElement>('#name')!;
const dialog = document.querySelector<HTMLDialogElement>('#export-dialog')!;
const exportName = document.querySelector<HTMLInputElement>('#export-name')!;
const customColor = document.querySelector<HTMLInputElement>('#color')!;
let arrows: Arrow[] = [{ ...structuredClone(referenceArrow), color: '#1e90ff' }];
let selected: number | null = null;
let style = { color: '#1e90ff', size: referenceArrow.size };
let zoom = 1;
let fit = true;
let changed = false;
let panel: 'color' | 'size' | null = null;
let pinned = false;
const undo: Arrow[][] = [];
const redo: Arrow[][] = [];
let drag: {
  pointerId: number; target: 'new' | 'move' | 'start' | 'end'; index: number;
  origin: Point; before: Arrow[]; previousSelection: number | null; moved: boolean;
} | null = null;

function notice(message: string) {
  document.querySelector('#status')!.textContent = message;
  document.querySelector<HTMLElement>('#notification')!.hidden = false;
}
function invalidateDownload() {
  download.hidden = true;
  download.removeAttribute('href');
}
function commit(before: Arrow[]) {
  if (JSON.stringify(before) === JSON.stringify(arrows)) return;
  // ponytail: 100 in-memory snapshots for this small arrow-only document; revisit with imported images.
  undo.push(before);
  if (undo.length > 100) undo.shift();
  redo.length = 0;
  changed = true;
  invalidateDownload();
}
function drawScene(target: HTMLCanvasElement, editing = false) {
  const ctx = target.getContext('2d');
  if (!ctx) throw new Error('瀏覽器無法建立繪圖畫布。');
  const scale = target.width / WIDTH;
  ctx.resetTransform();
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, target.width, target.height);
  ctx.setTransform(scale, 0, 0, target.height / HEIGHT, 0, 0);
  arrows.forEach((arrow, index) => {
    const path = new Path2D(arrowPath(arrow));
    ctx.save();
    ctx.fillStyle = arrow.color;
    ctx.shadowColor = 'rgba(0,0,0,0.35)';
    ctx.shadowBlur = 2 * scale;
    ctx.shadowOffsetY = 2 * scale;
    ctx.fill(path);
    ctx.restore();
    if (editing && selected === index) {
      ctx.strokeStyle = '#71d8e9';
      ctx.lineWidth = 1 / zoom;
      ctx.stroke(path);
      for (const p of [arrow.start, arrow.end]) {
        ctx.beginPath();
        ctx.arc(p.x, p.y, 6.5 / zoom, 0, Math.PI * 2);
        ctx.fillStyle = '#21aece';
        ctx.fill();
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 1.5 / zoom;
        ctx.stroke();
      }
    }
  });
}
function refresh() {
  drawScene(canvas, true);
  document.querySelector<HTMLElement>('#current-color')!.style.setProperty('--swatch', style.color);
  customColor.value = style.color;
  for (const button of document.querySelectorAll<HTMLButtonElement>('[data-color]')) {
    button.setAttribute('aria-pressed', String(button.dataset.color === style.color));
  }
  for (const button of document.querySelectorAll<HTMLButtonElement>('[data-size]')) {
    button.setAttribute('aria-pressed', String(Math.abs(Number(button.dataset.size) - style.size) < .01));
  }
  // Expose document state as an accessible description, also useful for keyboard users.
  canvas.setAttribute('aria-description', `${arrows.length} 個箭頭；${selected === null ? '未選取' : `選取第 ${selected + 1} 個箭頭`}。`);
  document.querySelector<HTMLButtonElement>('#trash')!.disabled = arrows.length === 0;
}
function layout() {
  if (fit) {
    const padding = innerWidth <= 600 ? 60 : 80;
    zoom = Math.max(.05, Math.min(1, (workspace.clientWidth - padding) / WIDTH, (workspace.clientHeight - padding) / HEIGHT));
  }
  stage.style.width = `${WIDTH * zoom}px`;
  stage.style.height = `${HEIGHT * zoom}px`;
  canvas.width = Math.max(1, Math.round(WIDTH * zoom * devicePixelRatio));
  canvas.height = Math.max(1, Math.round(HEIGHT * zoom * devicePixelRatio));
  document.querySelector('#zoom')!.innerHTML = `${Math.round(zoom * 100)}%<small>▾</small>`;
  refresh();
}
new ResizeObserver(layout).observe(workspace);

function setPanel(value: typeof panel) {
  panel = value;
  document.querySelector<HTMLElement>('#tools')!.hidden = value !== null;
  document.querySelector<HTMLElement>('#color-panel')!.hidden = value !== 'color';
  document.querySelector<HTMLElement>('#size-panel')!.hidden = value !== 'size';
  document.querySelector('#color-toggle')!.setAttribute('aria-expanded', String(value === 'color'));
  document.querySelector('#size-toggle')!.setAttribute('aria-expanded', String(value === 'size'));
  if (value === null) {
    pinned = false;
    document.querySelectorAll('.pin').forEach(button => button.setAttribute('aria-pressed', 'false'));
  }
}
function closeMenus() {
  for (const id of ['capture', 'zoom', 'format']) {
    document.getElementById(`${id}-menu`)!.hidden = true;
    document.getElementById(id)!.setAttribute('aria-expanded', 'false');
  }
}
for (const id of ['capture', 'zoom', 'format']) {
  document.getElementById(id)!.addEventListener('click', () => {
    const menu = document.getElementById(`${id}-menu`)!;
    const open = menu.hidden;
    closeMenus();
    menu.hidden = !open;
    document.getElementById(id)!.setAttribute('aria-expanded', String(open));
  });
}
document.addEventListener('pointerdown', event => {
  if (!(event.target instanceof Element) || !event.target.closest('.capture,.footer-control')) closeMenus();
});
document.querySelector('#color-toggle')!.addEventListener('click', () => setPanel('color'));
document.querySelector('#size-toggle')!.addEventListener('click', () => setPanel('size'));
document.querySelectorAll('.pin').forEach(button => button.addEventListener('click', () => {
  pinned = !pinned;
  button.setAttribute('aria-pressed', String(pinned));
}));
function setStyle(value: Partial<typeof style>) {
  const before = structuredClone(arrows);
  style = { ...style, ...value };
  if (selected !== null) {
    Object.assign(arrows[selected]!, value);
    commit(before);
  }
  refresh();
}
for (const button of document.querySelectorAll<HTMLButtonElement>('[data-color],[data-size]')) {
  button.addEventListener('click', () => {
    setStyle(button.dataset.color ? { color: button.dataset.color } : { size: Number(button.dataset.size) });
    if (!pinned) setPanel(null);
    canvas.focus();
  });
}
customColor.addEventListener('input', () => setStyle({ color: customColor.value }));
customColor.addEventListener('change', () => { if (!pinned) setPanel(null); });

function position(event: PointerEvent): Point {
  const rect = canvas.getBoundingClientRect();
  return {
    x: Math.max(0, Math.min(WIDTH, (event.clientX - rect.left) * WIDTH / rect.width)),
    y: Math.max(0, Math.min(HEIGHT, (event.clientY - rect.top) * HEIGHT / rect.height)),
  };
}
function hit(point: Point) {
  const ctx = canvas.getContext('2d')!;
  ctx.save();
  ctx.resetTransform();
  ctx.lineWidth = 8 / zoom;
  let result: number | null = null;
  for (let index = arrows.length - 1; index >= 0; index--) {
    const path = new Path2D(arrowPath(arrows[index]!));
    if (ctx.isPointInPath(path, point.x, point.y) || ctx.isPointInStroke(path, point.x, point.y)) {
      result = index;
      break;
    }
  }
  ctx.restore();
  return result;
}
canvas.addEventListener('pointerdown', event => {
  if (event.button !== 0 || !event.isPrimary || drag) return;
  if (!pinned) setPanel(null);
  document.querySelector<HTMLElement>('#notification')!.hidden = true;
  const point = position(event);
  const before = structuredClone(arrows);
  const previousSelection = selected;
  let target: 'new' | 'move' | 'start' | 'end' = 'move';
  if (selected !== null) {
    const arrow = arrows[selected]!;
    const distances = [arrow.start, arrow.end].map(p => Math.hypot(p.x - point.x, p.y - point.y));
    if (Math.min(...distances) <= 12 / zoom) target = distances[0]! < distances[1]! ? 'start' : 'end';
  }
  if (target === 'move') selected = hit(point);
  if (selected === null) {
    if (arrows.length >= 500) { notice('目前箭頭原型最多容納 500 個箭頭。'); return; }
    arrows.push({ start: point, end: point, ...style });
    selected = arrows.length - 1;
    target = 'new';
  } else {
    style = { color: arrows[selected]!.color, size: arrows[selected]!.size };
  }
  drag = { pointerId: event.pointerId, target, index: selected, origin: point, before, previousSelection, moved: false };
  if (target === 'new') selected = null;
  canvas.setPointerCapture(event.pointerId);
  canvas.focus();
  refresh();
});
function move(event: PointerEvent) {
  if (!drag || drag.pointerId !== event.pointerId) return;
  let point = position(event);
  const arrow = arrows[drag.index]!;
  const dx = point.x - drag.origin.x;
  const dy = point.y - drag.origin.y;
  if (Math.hypot(dx, dy) * zoom > 2) drag.moved = true;
  if (!drag.moved) return;
  if (drag.target === 'move') {
    const original = drag.before[drag.index]!;
    const tx = Math.max(-Math.min(original.start.x, original.end.x), Math.min(WIDTH - Math.max(original.start.x, original.end.x), dx));
    const ty = Math.max(-Math.min(original.start.y, original.end.y), Math.min(HEIGHT - Math.max(original.start.y, original.end.y), dy));
    arrow.start = { x: original.start.x + tx, y: original.start.y + ty };
    arrow.end = { x: original.end.x + tx, y: original.end.y + ty };
  } else {
    const end = drag.target === 'new' ? 'end' : drag.target;
    if (event.shiftKey) {
      const anchor = end === 'end' ? arrow.start : arrow.end;
      const angle = Math.round(Math.atan2(point.y - anchor.y, point.x - anchor.x) / (Math.PI / 4)) * Math.PI / 4;
      const length = Math.hypot(point.x - anchor.x, point.y - anchor.y);
      const vx = Math.cos(angle), vy = Math.sin(angle);
      const boundX = Math.abs(vx) < 1e-10 ? Infinity : (vx > 0 ? WIDTH - anchor.x : -anchor.x) / vx;
      const boundY = Math.abs(vy) < 1e-10 ? Infinity : (vy > 0 ? HEIGHT - anchor.y : -anchor.y) / vy;
      const bounded = Math.min(length, boundX, boundY);
      point = { x: anchor.x + vx * bounded, y: anchor.y + vy * bounded };
    }
    arrow[end] = point;
  }
  refresh();
}
canvas.addEventListener('pointermove', event => {
  if (drag) move(event);
  else canvas.style.cursor = hit(position(event)) === null ? 'crosshair' : 'move';
});
canvas.addEventListener('pointerup', event => {
  if (!drag || drag.pointerId !== event.pointerId) return;
  move(event);
  const { target, before, moved, index, previousSelection } = drag;
  if (target === 'new' && (!moved || !arrowPath(arrows[index]!))) {
    arrows = before;
    selected = null;
  } else if ((target === 'start' || target === 'end') && !arrowPath(arrows[index]!)) {
    arrows = before;
    selected = previousSelection;
  } else commit(before);
  drag = null;
  canvas.releasePointerCapture(event.pointerId);
  refresh();
});
function cancelDrag() {
  if (!drag) return;
  const { before, previousSelection, pointerId } = drag;
  drag = null;
  arrows = before;
  selected = previousSelection;
  if (canvas.hasPointerCapture(pointerId)) canvas.releasePointerCapture(pointerId);
  refresh();
}
canvas.addEventListener('pointercancel', cancelDrag);
canvas.addEventListener('lostpointercapture', cancelDrag);
function history(backwards: boolean) {
  cancelDrag();
  const source = backwards ? undo : redo;
  const destination = backwards ? redo : undo;
  const state = source.pop();
  if (!state) return;
  destination.push(structuredClone(arrows));
  arrows = state;
  selected = null;
  changed = true;
  invalidateDownload();
  refresh();
}
function clear() {
  cancelDrag();
  const before = structuredClone(arrows);
  arrows = [];
  selected = null;
  commit(before);
  refresh();
}
document.querySelector('#blank')!.addEventListener('click', () => {
  clear();
  name.value = '空白';
  name.style.width = '28px';
  closeMenus();
  canvas.focus();
});
document.querySelector('#trash')!.addEventListener('click', clear);
document.querySelector('#arrow-tool')!.addEventListener('click', () => { selected = null; refresh(); canvas.focus(); });
name.addEventListener('input', () => { name.style.width = `${Math.min(240, Math.max(28, name.value.length * 12))}px`; });
for (const button of document.querySelectorAll<HTMLButtonElement>('[data-zoom]')) {
  button.addEventListener('click', () => {
    fit = button.dataset.zoom === 'fit';
    if (!fit) zoom = Number(button.dataset.zoom);
    closeMenus();
    layout();
  });
}
document.querySelector('#format-menu button')!.addEventListener('click', closeMenus);
function exportPNG() {
  const output = document.createElement('canvas');
  output.width = WIDTH;
  output.height = HEIGHT;
  drawScene(output);
  // ponytail: fixed-size P0 output; use Blob encoding when large-image import is added.
  const url = output.toDataURL('image/png');
  if (!url.startsWith('data:image/png;base64,')) throw new Error('瀏覽器未產生 PNG 格式。');
  return url;
}
function filename(value = name.value) {
  return `${value.trim().replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').replace(/\.png$/i, '') || '空白'}.png`;
}
function showExport() {
  cancelDrag();
  closeMenus();
  exportName.value = name.value.trim() || '空白';
  if (!dialog.open) dialog.showModal();
}
for (const id of ['export', 'share']) document.getElementById(id)!.addEventListener('click', showExport);
document.querySelector('#cancel-export')!.addEventListener('click', () => dialog.close());
document.querySelector('#export-form')!.addEventListener('submit', event => {
  event.preventDefault();
  try {
    download.href = exportPNG();
    download.download = filename(exportName.value);
    download.hidden = false;
    download.click();
    dialog.close();
    notice('已開始下載 1130 × 732 PNG；選取輪廓與端點不會匯出。');
  } catch (error) {
    dialog.close();
    notice(`匯出失敗：${error instanceof Error ? error.message : '請再試一次。'} 畫布仍保留。`);
  }
});
document.querySelector('#export')!.addEventListener('dragstart', event => {
  const dragEvent = event as DragEvent;
  try {
    const url = exportPNG();
    dragEvent.dataTransfer!.setData('DownloadURL', `image/png:${filename()}:${url}`);
    dragEvent.dataTransfer!.effectAllowed = 'copy';
    notice('已準備 PNG 拖出；若瀏覽器不支援，請點底部 PNG 按鈕匯出。');
  } catch { event.preventDefault(); notice('無法拖出圖片，請使用點擊匯出。'); }
});
document.querySelector('#close-notification')!.addEventListener('click', () => { document.querySelector<HTMLElement>('#notification')!.hidden = true; });
document.addEventListener('keydown', event => {
  if (dialog.open) return;
  if (event.key === 'Escape') {
    if (drag) cancelDrag();
    else { selected = null; setPanel(null); closeMenus(); refresh(); canvas.focus(); }
    event.preventDefault();
    return;
  }
  if (event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement) return;
  const command = event.metaKey || event.ctrlKey;
  if (command && ['z', 'y'].includes(event.key.toLowerCase())) {
    event.preventDefault();
    history(event.key.toLowerCase() === 'z' && !event.shiftKey);
  } else if (command && event.key.toLowerCase() === 'e') {
    event.preventDefault(); showExport();
  } else if (document.activeElement === canvas && (event.key === 'Delete' || event.key === 'Backspace') && selected !== null) {
    event.preventDefault();
    const before = structuredClone(arrows);
    arrows.splice(selected, 1);
    selected = null;
    commit(before); refresh();
  }
});
window.addEventListener('beforeunload', event => {
  if (changed) { event.preventDefault(); event.returnValue = ''; }
});
layout();
