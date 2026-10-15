import './style.css';
import { arrowPath, expandedCanvas, referenceArrow, type Arrow, type Point } from './arrow.ts';

let width = 1130;
let height = 732;
type Snapshot = { width: number; height: number; arrows: Arrow[] };
const canvas = document.querySelector<HTMLCanvasElement>('#canvas')!;
const arrowMenu = document.querySelector<HTMLElement>('#arrow-menu')!;
let holdTimer: ReturnType<typeof setTimeout> | undefined;
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
const undo: Snapshot[] = [];
const redo: Snapshot[] = [];
let drag: {
  pointerId: number; target: 'new' | 'move' | 'start' | 'end'; index: number;
  origin: Point; before: Snapshot; previousSelection: number | null; moved: boolean;
} | null = null;

function notice(message: string) {
  document.querySelector<HTMLButtonElement>('#undo-delete')!.hidden = true;
  document.querySelector('#status')!.textContent = message;
  document.querySelector<HTMLElement>('#notification')!.hidden = false;
}
function invalidateDownload() {
  download.hidden = true;
  download.removeAttribute('href');
}
function snapshot(): Snapshot { return structuredClone({ width, height, arrows }); }
function restore(state: Snapshot) {
  ({ width, height, arrows } = state);
  layout();
}
function commit(before: Snapshot) {
  if (JSON.stringify(before) === JSON.stringify({ width, height, arrows })) return;
  // ponytail: 100 in-memory snapshots for this small arrow-only document; revisit with imported images.
  undo.push(before);
  if (undo.length > 100) undo.shift();
  redo.length = 0;
  changed = true;
  document.querySelector<HTMLButtonElement>('#undo-delete')!.hidden = true;
  invalidateDownload();
}
function drawScene(target: HTMLCanvasElement, editing = false) {
  const ctx = target.getContext('2d');
  if (!ctx) throw new Error('瀏覽器無法建立繪圖畫布。');
  const scale = target.width / width;
  ctx.resetTransform();
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, target.width, target.height);
  ctx.setTransform(scale, 0, 0, target.height / height, 0, 0);
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
  document.querySelector('#dimensions')!.textContent = `${width} x ${height}`;
  document.querySelector('#export-form p')!.textContent = `${width} × ${height} 像素`;
}
function layout() {
  if (fit) {
    const padding = innerWidth <= 600 ? 72 : 80;
    zoom = Math.max(.05, Math.min(1, (workspace.clientWidth - padding) / width, (workspace.clientHeight - padding) / height));
  }
  stage.style.width = `${width * zoom}px`;
  stage.style.height = `${height * zoom}px`;
  canvas.width = Math.max(1, Math.round(width * zoom * devicePixelRatio));
  canvas.height = Math.max(1, Math.round(height * zoom * devicePixelRatio));
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
  arrowMenu.hidePopover();
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
  if (event.target instanceof Element && !event.target.closest('#arrow-menu')) arrowMenu.hidePopover();
  if (!(event.target instanceof Element) || !event.target.closest('.capture,.footer-control,#arrow-menu')) closeMenus();
});
document.querySelector('#color-toggle')!.addEventListener('click', () => setPanel('color'));
document.querySelector('#size-toggle')!.addEventListener('click', () => setPanel('size'));
document.querySelectorAll('.pin').forEach(button => button.addEventListener('click', () => {
  pinned = !pinned;
  button.setAttribute('aria-pressed', String(pinned));
}));
function setStyle(value: Partial<typeof style>) {
  const before = snapshot();
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

function position(event: MouseEvent): Point {
  const rect = canvas.getBoundingClientRect();
  return {
    x: (event.clientX - rect.left) * width / rect.width,
    y: (event.clientY - rect.top) * height / rect.height,
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
  closeMenus();
  if (!pinned) setPanel(null);
  document.querySelector<HTMLElement>('#notification')!.hidden = true;
  const point = position(event);
  const before = snapshot();
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
  if (target !== 'new') {
    const index = selected!;
    holdTimer = setTimeout(() => {
      cancelDrag();
      showArrowMenu(index, event.clientX, event.clientY);
    }, 550);
  }
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
  if (Math.hypot(dx, dy) * zoom > (event.pointerType === 'touch' ? 8 : 2)) {
    drag.moved = true;
    clearTimeout(holdTimer);
  }
  if (!drag.moved) return;
  if (drag.target === 'move') {
    const original = drag.before.arrows[drag.index]!;
    const tx = dx;
    const ty = dy;
    arrow.start = { x: original.start.x + tx, y: original.start.y + ty };
    arrow.end = { x: original.end.x + tx, y: original.end.y + ty };
  } else {
    const end = drag.target === 'new' ? 'end' : drag.target;
    if (event.shiftKey) {
      const anchor = end === 'end' ? arrow.start : arrow.end;
      const angle = Math.round(Math.atan2(point.y - anchor.y, point.x - anchor.x) / (Math.PI / 4)) * Math.PI / 4;
      const length = Math.hypot(point.x - anchor.x, point.y - anchor.y);
      const vx = Math.cos(angle), vy = Math.sin(angle);
      point = { x: anchor.x + vx * length, y: anchor.y + vy * length };
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
  clearTimeout(holdTimer);
  move(event);
  const { target, before, moved, index, previousSelection } = drag;
  if (target === 'new' && (!moved || !arrowPath(arrows[index]!))) {
    restore(before);
    selected = null;
  } else if ((target === 'start' || target === 'end') && !arrowPath(arrows[index]!)) {
    restore(before);
    selected = previousSelection;
  } else {
    try {
      const expanded = expandedCanvas(width, height, arrows[index]!);
      if (expanded.width !== width || expanded.height !== height) {
        for (const arrow of arrows) {
          for (const point of [arrow.start, arrow.end]) { point.x += expanded.offsetX; point.y += expanded.offsetY; }
        }
        width = expanded.width;
        height = expanded.height;
        fit = false;
        layout();
        workspace.scrollLeft += expanded.offsetX * zoom;
        workspace.scrollTop += Math.max(expanded.offsetY, height - before.height) * zoom;
      }
      commit(before);
    } catch (error) {
      selected = previousSelection;
      restore(before);
      notice(error instanceof Error ? error.message : '畫布無法延展，已保留原本的箭頭。');
    }
  }
  drag = null;
  canvas.releasePointerCapture(event.pointerId);
  refresh();
});
function cancelDrag() {
  clearTimeout(holdTimer);
  if (!drag) return;
  const { before, previousSelection, pointerId } = drag;
  drag = null;
  restore(before);
  selected = previousSelection;
  if (canvas.hasPointerCapture(pointerId)) canvas.releasePointerCapture(pointerId);
  refresh();
}
canvas.addEventListener('pointercancel', cancelDrag);
canvas.addEventListener('lostpointercapture', cancelDrag);
function history(backwards: boolean) {
  cancelDrag();
  closeMenus();
  const source = backwards ? undo : redo;
  const destination = backwards ? redo : undo;
  const state = source.pop();
  if (!state) return;
  destination.push(snapshot());
  restore(state);
  selected = null;
  changed = true;
  document.querySelector<HTMLButtonElement>('#undo-delete')!.hidden = true;
  invalidateDownload();
  refresh();
}
function clear() {
  cancelDrag();
  closeMenus();
  const before = snapshot();
  arrows = [];
  width = 1130;
  height = 732;
  selected = null;
  layout();
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
function deleteSelected() {
  cancelDrag();
  if (selected === null) return;
  const before = snapshot();
  arrows.splice(selected, 1);
  selected = null;
  commit(before);
  refresh();
  notice('已刪除選取的箭頭，其餘箭頭保留。');
  document.querySelector<HTMLButtonElement>('#undo-delete')!.hidden = false;
}
function showArrowMenu(index: number, x: number, y: number) {
  selected = index;
  style = { color: arrows[index]!.color, size: arrows[index]!.size };
  closeMenus();
  refresh();
  arrowMenu.style.left = `${Math.max(8, Math.min(x, innerWidth - 112))}px`;
  arrowMenu.style.top = `${Math.max(8, Math.min(y + 12, innerHeight - 88))}px`;
  arrowMenu.showPopover();
  document.querySelector<HTMLButtonElement>('#delete-arrow')!.focus();
}
canvas.addEventListener('contextmenu', event => {
  event.preventDefault();
  if (arrowMenu.matches(':popover-open')) return;
  cancelDrag();
  const index = hit(position(event));
  if (index !== null) showArrowMenu(index, event.clientX, event.clientY);
});
canvas.addEventListener('keydown', event => {
  if (selected === null || !(event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10'))) return;
  event.preventDefault();
  const rect = canvas.getBoundingClientRect();
  showArrowMenu(selected, rect.left + rect.width / 2, rect.top + rect.height / 2);
});
window.addEventListener('blur', cancelDrag);
document.querySelector('#delete-arrow')!.addEventListener('click', () => {
  closeMenus();
  deleteSelected();
  canvas.focus();
});
document.querySelector('#undo-delete')!.addEventListener('click', () => {
  history(true);
  document.querySelector<HTMLElement>('#notification')!.hidden = true;
});
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
  output.width = width;
  output.height = height;
  drawScene(output);
  // ponytail: canvas sides are capped at 4096; use Blob encoding when larger images are required.
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
    notice(`已開始下載 ${width} × ${height} PNG；選取輪廓與端點不會匯出。`);
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
    deleteSelected();
  }
});
window.addEventListener('beforeunload', event => {
  if (changed) { event.preventDefault(); event.returnValue = ''; }
});
layout();
