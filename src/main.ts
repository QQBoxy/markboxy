import './style.css';
import { desktop, nativeOpen, nativeCapture, nativeSave, askDiscard, desktopEvents } from './desktop.ts';
import { type Point } from './arrow.ts';

import { TOOL_SIZES, shapePath, shapeStroke, expandedScene, loadImage, type Annotation, type Background, type Crop, readProject, type Project } from './document.ts';

let background: Background | null = null;
let tool: NonNullable<Annotation['kind']> = 'arrow';
let opening = 0;
let crop: Crop | null = null;
let cropDraft: Crop | null = null;
let cropDrag: { id: number; origin: Point; corner: number; before: Crop } | null = null;
let format: 'png' | 'jpeg' = 'png';
const exportFormat = document.querySelector<HTMLSelectElement>('#export-format')!;
let width = 1130;
let height = 732;
type Snapshot = { width: number; height: number; background: Background | null; arrows: Annotation[]; crop: Crop | null; name: string };
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
let arrows: Annotation[] = [];
let selected: number | null = null;
let style: { color: string; size: number } = { color: '#ff2600', size: TOOL_SIZES[1] };
let zoom = 1;
let fit = true;
let changed = false;
let revision = 0;
let panel: 'color' | 'size' | 'shape' | null = null;
let pinned = false;
const undo: Snapshot[] = [];
const redo: Snapshot[] = [];
let drag: {
  pointerId: number; target: 'new' | 'move' | 'start' | 'end' | 'ne' | 'sw'; index: number;
  origin: Point; before: Snapshot; previousSelection: number | null; moved: boolean;
} | null = null;

function notice(message: string) {
  document.querySelector('#status')!.textContent = message;
  document.querySelector<HTMLElement>('#notification')!.hidden = false;
}
function invalidateDownload() {
  if (download.href.startsWith('blob:')) URL.revokeObjectURL(download.href);
  download.hidden = true;
  download.removeAttribute('href');
}
function snapshot(): Snapshot { return { width, height, background, arrows: structuredClone(arrows), crop: crop && { ...crop }, name: name.value }; }
function restore(state: Snapshot) {
  ({ width, height, background, arrows, crop } = state);
  name.value = state.name;
  resizeName();
  layout();
}
function commit(before: Snapshot) {
  if (before.width === width && before.height === height && before.background === background && before.name === name.value && JSON.stringify(before.crop) === JSON.stringify(crop) && JSON.stringify(before.arrows) === JSON.stringify(arrows)) return;
  // ponytail: 100 annotation snapshots share immutable image data; opening a new image drops older history to bound decoded-image memory.
  undo.push(before);
  if (undo.length > 100) undo.shift();
  redo.length = 0;
  changed = true; revision++;
  invalidateDownload();
}
function view(): Crop { return (!cropDraft && crop) || { x: 0, y: 0, width, height }; }
function drawScene(target: HTMLCanvasElement, editing = false) {
  const ctx = target.getContext('2d');
  if (!ctx) throw new Error('瀏覽器無法建立繪圖畫布。');
  const area = view();
  const scale = target.width / area.width;
  ctx.resetTransform();
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, target.width, target.height);
  ctx.setTransform(scale, 0, 0, target.height / area.height, -area.x * scale, -area.y * target.height / area.height);
  if (background) ctx.drawImage(background.image, background.x, background.y, background.width, background.height);
  arrows.forEach((arrow, index) => {
    const path = new Path2D(shapePath(arrow));
    ctx.save();
    ctx.fillStyle = arrow.color;
    ctx.shadowColor = 'rgba(0,0,0,0.35)';
    ctx.shadowBlur = 2 * scale;
    ctx.shadowOffsetY = 2 * scale;
    if (arrow.kind && arrow.kind !== 'arrow') {
      ctx.strokeStyle = arrow.color;
      ctx.lineWidth = shapeStroke(arrow.size);
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      ctx.stroke(path);
    } else ctx.fill(path);
    ctx.restore();
    if (editing && !cropDraft && selected === index) {
      ctx.strokeStyle = '#71d8e9';
      ctx.lineWidth = 1 / zoom;
      ctx.stroke(path);
      for (const p of handles(arrow)) {
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
  if (editing && cropDraft) {
    const c = cropDraft;
    ctx.fillStyle = 'rgba(0,0,0,.45)';
    ctx.beginPath(); ctx.rect(0, 0, width, height); ctx.rect(c.x, c.y, c.width, c.height); ctx.fill('evenodd');
    ctx.strokeStyle = '#e5e5e5'; ctx.lineWidth = 1 / zoom; ctx.strokeRect(c.x, c.y, c.width, c.height);
    cropCorners(c).forEach((p, index) => {
      ctx.save(); ctx.translate(p.x, p.y); ctx.scale(1 / zoom, 1 / zoom);
      ctx.fillStyle = '#fff'; ctx.strokeStyle = '#ccc'; ctx.lineWidth = .6;
      ctx.beginPath();
      if (index % 2 === 0) {
        ctx.rotate(index * Math.PI / 4);
        ctx.moveTo(-4, -4); ctx.lineTo(12, -4); ctx.lineTo(12, 2); ctx.lineTo(2, 2); ctx.lineTo(2, 12); ctx.lineTo(-4, 12); ctx.closePath();
      } else if (index % 4 === 1) ctx.rect(-8, -3, 16, 6);
      else ctx.rect(-3, -8, 6, 16);
      ctx.fill(); ctx.stroke(); ctx.restore();
    });
  }
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
  const distances = TOOL_SIZES.map(size => Math.abs(size - style.size));
  const sizeIndex = distances.indexOf(Math.min(...distances));
  const sizeToggle = document.querySelector<HTMLButtonElement>('#size-toggle')!;
  sizeToggle.style.setProperty('--size-weight', String(sizeIndex + 1));
  const sizeDescription = distances[sizeIndex]! < .01 ? `粗細第 ${sizeIndex + 1} 級` : `自訂粗細 ${style.size}`;
  sizeToggle.title = sizeDescription;
  sizeToggle.setAttribute('aria-description', sizeDescription);
  // Expose document state as an accessible description, also useful for keyboard users.
  canvas.setAttribute('aria-description', `${arrows.length} 個標註；${selected === null ? '未選取' : `選取第 ${selected + 1} 個標註`}。`);
  document.querySelector<HTMLButtonElement>('#trash')!.disabled = arrows.length === 0 && !background;
  for (const button of document.querySelectorAll<HTMLButtonElement>('[data-tool]')) {
    const active = !cropDraft && button.dataset.tool === tool;
    button.classList.toggle('selected', active);
    button.setAttribute('aria-pressed', String(active));
  }
  document.querySelector('#shape-tool')!.classList.toggle('selected', !cropDraft && tool !== 'arrow');
  document.querySelector('#shape-tool')!.setAttribute('aria-pressed', String(!cropDraft && tool !== 'arrow'));
  document.querySelector('#shape-tool use')!.setAttribute('href', ({ arrow: '#i-shape', rectangle: '#i-shape', roundedRectangle: '#i-rounded', ellipse: '#i-ellipse', line: '#i-line' }[tool]));
  document.querySelector('#dimensions')!.textContent = `${view().width} x ${view().height}`;
  document.querySelector('#export-form p')!.textContent = `${view().width} × ${view().height} 像素`;
}
function layout() {
  document.querySelector('main')!.classList.toggle('cropping', !!cropDraft);
  document.querySelector('#crop-tool')!.classList.toggle('selected', !!cropDraft);
  const area = view();
  if (fit) {
    const padding = innerWidth <= 600 ? 72 : 80;
    zoom = Math.max(.05, Math.min(1, (workspace.clientWidth - padding) / area.width, (workspace.clientHeight - padding - (cropDraft ? 56 : 0)) / area.height));
  }
  stage.style.width = `${area.width * zoom}px`;
  stage.style.height = `${area.height * zoom}px`;
  // ponytail: bound preview surfaces to 4096 per side even at high DPI/zoom; exports retain full document pixels.
  const ratio = Math.min(devicePixelRatio, 2, 4096 / (Math.max(area.width, area.height) * zoom));
  canvas.width = Math.max(1, Math.round(area.width * zoom * ratio));
  canvas.height = Math.max(1, Math.round(area.height * zoom * ratio));
  document.querySelector('#zoom')!.innerHTML = `${Math.round(zoom * 100)}%<small>▾</small>`;
  refresh();
}
new ResizeObserver(layout).observe(workspace);

function setPanel(value: typeof panel) {
  panel = value;
  document.querySelector<HTMLElement>('#tools')!.hidden = value !== null;
  document.querySelector<HTMLElement>('#color-panel')!.hidden = value !== 'color';
  document.querySelector<HTMLElement>('#size-panel')!.hidden = value !== 'size';
  document.querySelector<HTMLElement>('#shape-panel')!.hidden = value !== 'shape';
  document.querySelector('#shape-tool')!.setAttribute('aria-expanded', String(value === 'shape'));
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
function selectTool(value: typeof tool) {
  cancelDrag();
  if (cropDraft) finishCrop(false);
  tool = value;
  selected = null;
  if (!pinned) setPanel(null);
  refresh();
  canvas.focus();
}
document.querySelector('#shape-tool')!.addEventListener('click', () => {
  selectTool(tool === 'arrow' ? 'rectangle' : tool);
  setPanel('shape');
});
for (const button of document.querySelectorAll<HTMLButtonElement>('[data-tool]')) {
  button.addEventListener('click', () => selectTool(button.dataset.tool as typeof tool));
}
document.querySelector('#color-toggle')!.addEventListener('click', () => setPanel('color'));
document.querySelector('#size-toggle')!.addEventListener('click', () => setPanel('size'));
document.querySelectorAll('.pin').forEach(button => button.addEventListener('click', () => {
  pinned = !pinned;
  button.setAttribute('aria-pressed', String(pinned));
}));

function expandFor(item: Annotation) {
  const previousHeight = height;
  const expanded = crop ? { width, height, offsetX: 0, offsetY: 0 } : expandedScene(width, height, item);
  if (expanded.width !== width || expanded.height !== height) {
    for (const arrow of arrows) {
      for (const point of [arrow.start, arrow.end]) { point.x += expanded.offsetX; point.y += expanded.offsetY; }
    }
    if (background) background = { ...background, x: background.x + expanded.offsetX, y: background.y + expanded.offsetY };
    width = expanded.width;
    height = expanded.height;
    fit = false;
    layout();
    workspace.scrollLeft += expanded.offsetX * zoom;
    workspace.scrollTop += Math.max(expanded.offsetY, height - previousHeight) * zoom;
  }
}
function setStyle(value: Partial<typeof style>) {
  const before = snapshot(), previousStyle = style;
  style = { ...style, ...value };
  if (selected !== null) {
    try {
      Object.assign(arrows[selected]!, value);
      expandFor(arrows[selected]!);
      commit(before);
    } catch (error) {
      style = previousStyle; restore(before);
      notice(error instanceof Error ? error.message : '無法調整樣式，原文件仍保留。');
    }
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
  const area = view();
  return {
    x: area.x + (event.clientX - rect.left) * area.width / rect.width,
    y: area.y + (event.clientY - rect.top) * area.height / rect.height,
  };
}
function handles(item: Annotation) {
  return !item.kind || item.kind === 'arrow' || item.kind === 'line' ? [item.start, item.end] :
    [item.start, item.end, { x: item.end.x, y: item.start.y }, { x: item.start.x, y: item.end.y }];
}
function hit(point: Point) {
  const ctx = canvas.getContext('2d')!;
  ctx.save();
  ctx.resetTransform();
  ctx.lineCap = 'round';
  ctx.lineWidth = 8 / zoom;
  let result: number | null = null;
  for (let index = arrows.length - 1; index >= 0; index--) {
    const path = new Path2D(shapePath(arrows[index]!));
    const isArrow = !arrows[index]!.kind || arrows[index]!.kind === 'arrow';
    ctx.lineWidth = (isArrow ? 0 : shapeStroke(arrows[index]!.size)) + 8 / zoom;
    if ((isArrow && ctx.isPointInPath(path, point.x, point.y)) || ctx.isPointInStroke(path, point.x, point.y)) {
      result = index;
      break;
    }
  }
  ctx.restore();
  return result;
}
canvas.addEventListener('pointerdown', event => {
  if (cropDraft) return;
  if (event.button !== 0 || !event.isPrimary || drag) return;
  closeMenus();
  if (!pinned) setPanel(null);
  document.querySelector<HTMLElement>('#notification')!.hidden = true;
  const point = position(event);
  const before = snapshot();
  const previousSelection = selected;
  let target: 'new' | 'move' | 'start' | 'end' | 'ne' | 'sw' = 'move';
  if (selected !== null) {
    const arrow = arrows[selected]!;
    const distances = handles(arrow).map(p => Math.hypot(p.x - point.x, p.y - point.y));
    if (Math.min(...distances) <= 12 / zoom) target = (['start', 'end', 'ne', 'sw'] as const)[distances.indexOf(Math.min(...distances))]!;
  }
  if (target === 'move') selected = hit(point);
  if (selected === null) {
    if (arrows.length >= 500) { notice('目前文件最多容納 500 個標註。'); return; }
    arrows.push({ kind: tool, start: point, end: point, ...style });
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
      const anchor = end === 'end' ? arrow.start : end === 'ne' ? { x: arrow.start.x, y: arrow.end.y } : end === 'sw' ? { x: arrow.end.x, y: arrow.start.y } : arrow.end;
      if (arrow.kind && arrow.kind !== 'arrow' && arrow.kind !== 'line') {
        const side = Math.max(Math.abs(point.x - anchor.x), Math.abs(point.y - anchor.y));
        point = { x: anchor.x + Math.sign(point.x - anchor.x) * side, y: anchor.y + Math.sign(point.y - anchor.y) * side };
      } else {
      const angle = Math.round(Math.atan2(point.y - anchor.y, point.x - anchor.x) / (Math.PI / 4)) * Math.PI / 4;
      const length = Math.hypot(point.x - anchor.x, point.y - anchor.y);
      const vx = Math.cos(angle), vy = Math.sin(angle);
      point = { x: anchor.x + vx * length, y: anchor.y + vy * length };
      }
    }
    if (end === 'ne') { arrow.end.x = point.x; arrow.start.y = point.y; }
    else if (end === 'sw') { arrow.start.x = point.x; arrow.end.y = point.y; }
    else arrow[end] = point;
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
  if (target === 'new' && (!moved || !shapePath(arrows[index]!))) {
    restore(before);
    selected = null;
  } else if (target !== 'move' && target !== 'new' && !shapePath(arrows[index]!)) {
    restore(before);
    selected = previousSelection;
  } else {
    try {
      expandFor(arrows[index]!);
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
  if (cropDraft) finishCrop(false);
  closeMenus();
  const source = backwards ? undo : redo;
  const destination = backwards ? redo : undo;
  const state = source.pop();
  if (!state) return;
  destination.push(snapshot());
  restore(state);
  selected = null;
  changed = true; revision++;
  invalidateDownload();
  refresh();
}
function clear(newName?: string) {
  opening++;
  cancelDrag();
  closeMenus();
  const before = snapshot();
  arrows = [];
  background = null;
  crop = null;
  cropDraft = null;
  document.querySelector<HTMLElement>('#crop-bar')!.hidden = true;
  document.querySelector('#crop-tool')!.setAttribute('aria-pressed', 'false');
  width = 1130;
  height = 732;
  selected = null;
  if (newName !== undefined) { name.value = newName; resizeName(); }
  layout();
  commit(before);
  refresh();
}
document.querySelector('#blank')!.addEventListener('click', () => {
  clear('空白');
  closeMenus();
  canvas.focus();
});
document.querySelector('#trash')!.addEventListener('click', () => clear());
function deleteSelected() {
  cancelDrag();
  if (selected === null) return;
  const before = snapshot();
  arrows.splice(selected, 1);
  selected = null;
  commit(before);
  refresh();
  document.querySelector<HTMLElement>('#notification')!.hidden = true;
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


const fileInput = document.querySelector<HTMLInputElement>('#open-file')!;
async function chooseFile() {
  closeMenus();
  if (!desktop) { fileInput.click(); return; }
  try { const file = await nativeOpen(); if (file) await openFile(file); }
  catch (error) { notice(String(error)); }
}
document.querySelector('#open-image')!.addEventListener('click', chooseFile);
async function openFile(file: File) {
  const request = ++opening;
  try {
    const loaded = /\.markboxy$/i.test(file.name) ? await readProject(file) : null;
    const next = loaded ? loaded.background : await loadImage(file);
    if (request !== opening) return;
    if (changed && !await askDiscard('開啟檔案會取代目前文件。尚未儲存的內容仍可用復原還原；要繼續嗎？')) return;
    if (request !== opening) return;
    cancelDrag(); closeMenus();
    const before = snapshot();
    undo.length = 0; redo.length = 0;
    background = next; width = loaded?.project.width ?? next!.width; height = loaded?.project.height ?? next!.height; arrows = loaded?.project.annotations ?? []; crop = loaded?.project.crop ?? null; cropDraft = null; document.querySelector<HTMLElement>('#crop-bar')!.hidden = true; selected = null; fit = true;
    name.value = loaded?.project.name ?? (file.name.replace(/\.[^.]+$/, '').slice(0, 100) || '空白');
    name.style.width = `${Math.min(240, Math.max(28, name.value.length * 12))}px`;
    layout(); commit(before); refresh(); canvas.focus();
    changed = !loaded;
    notice(loaded ? '已開啟可編輯文件，圖片與標註均已還原。' : '已開啟圖片，所有編輯都在本機處理。');
  } catch (error) { if (request === opening) notice(error instanceof Error ? error.message : '無法開啟圖片，原文件仍保留。'); }
}
document.addEventListener('paste', event => {
  if (textClipboardTarget(event.target)) return;
  const files = Array.from(event.clipboardData?.files ?? []);
  const image = files.find(file => file.type.startsWith('image/'));
  if (!image) return;
  event.preventDefault();
  void openFile(image);
});
fileInput.addEventListener('change', () => { const file = fileInput.files?.[0]; fileInput.value = ''; if (file) void openFile(file); });
workspace.addEventListener('dragover', event => { if (event.dataTransfer?.types.includes('Files')) { event.preventDefault(); event.dataTransfer.dropEffect = 'copy'; } });
workspace.addEventListener('drop', event => {
  event.preventDefault();
  const files = event.dataTransfer?.files;
  if (files?.length === 1) void openFile(files[0]!);
  else notice('請一次拖入一張 PNG／JPEG 圖片或一份 .markboxy 文件。');
});
function resizeName() { name.style.width = `${Math.min(240, Math.max(28, name.value.length * 12))}px`; }
name.addEventListener('input', () => { resizeName(); changed = true; revision++; invalidateDownload(); });
for (const button of document.querySelectorAll<HTMLButtonElement>('[data-zoom]')) {
  button.addEventListener('click', () => {
    fit = button.dataset.zoom === 'fit';
    if (!fit) zoom = Number(button.dataset.zoom);
    closeMenus();
    layout();
  });
}
function setFormat(value: typeof format) {
  format = value; exportFormat.value = value;
  document.querySelector('#format')!.innerHTML = `.${value === 'jpeg' ? 'jpg' : 'png'}<small>▾</small>`;
  document.querySelector('#quality-label')!.toggleAttribute('hidden', value !== 'jpeg');
  for (const b of document.querySelectorAll<HTMLButtonElement>('[data-format]')) b.setAttribute('aria-pressed', String(b.dataset.format === value));
  document.querySelector('#export .png-file b')!.textContent = value === 'jpeg' ? 'JPG' : 'PNG';
  document.querySelector('#export')!.setAttribute('aria-label', `匯出 ${value === 'jpeg' ? 'JPEG' : 'PNG'}；拖出 PNG`);
  document.querySelector('#export')!.setAttribute('title', '點一下匯出所選格式；拖出固定使用 PNG');
  document.querySelector('#share')!.setAttribute('aria-label', '匯出圖片');
}
for (const b of document.querySelectorAll<HTMLButtonElement>('[data-format]')) b.addEventListener('click', () => { setFormat(b.dataset.format as typeof format); closeMenus(); });
exportFormat.addEventListener('change', () => setFormat(exportFormat.value as typeof format));
function exportPNG() {
  if (cropDraft) throw new Error('請先套用或取消裁切。');
  const output = document.createElement('canvas');
  output.width = view().width;
  output.height = view().height;
  drawScene(output);
  // ponytail: DownloadURL drag-out needs a synchronous URL; normal file exports use Blob encoding.
  const url = output.toDataURL('image/png');
  if (!url.startsWith('data:image/png;base64,')) throw new Error('瀏覽器未產生 PNG 格式。');
  return url;
}
function filename(value = name.value, extension = format === 'jpeg' ? 'jpg' : 'png') {
  return `${value.trim().replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').replace(/\.(png|jpg|jpeg|markboxy)$/i, '') || '空白'}.${extension}`;
}
async function exportImage(outputFormat: typeof format = format) {
  if (cropDraft) throw new Error('請先套用或取消裁切。');
  const output = document.createElement('canvas'); output.width = view().width; output.height = view().height; drawScene(output);
  const quality = Number(document.querySelector<HTMLInputElement>('#quality')!.value) / 100;
  return new Promise<Blob>((resolve, reject) => output.toBlob(blob => blob ? resolve(blob) : reject(new Error('瀏覽器無法編碼圖片。')), `image/${outputFormat}`, quality));
}
async function copyImage() {
  cancelDrag(); closeMenus();
  try {
    if (!navigator.clipboard?.write || typeof ClipboardItem === 'undefined') throw new Error('目前環境不支援圖片剪貼簿，請使用匯出圖片。');
    // Pass the Blob promise immediately to retain Safari/WebKit's user activation.
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': exportImage('png') })]);
    notice('已複製圖片，可貼到其他軟體；圖片不包含選取控制點。');
  } catch (error) { notice(`複製失敗：${error instanceof Error ? error.message : String(error)}`); }
}
function textClipboardTarget(target: EventTarget | null) {
  return dialog.open || (target instanceof Element && !!target.closest('input,textarea,select,[contenteditable]:not([contenteditable="false"])'));
}
document.addEventListener('copy', event => {
  if (textClipboardTarget(event.target) || getSelection()?.toString()) return;
  event.preventDefault(); void copyImage();
});
function offerDownload(blob: Blob, filename: string) {
  invalidateDownload(); download.href = URL.createObjectURL(blob); download.download = filename; download.textContent = '再次下載'; download.hidden = false; download.click();
}
async function saveProject() {
  cancelDrag(); closeMenus();
  if (cropDraft) { notice('請先套用或取消裁切，再儲存文件。'); return; }
  const project: Project = { format: 'markboxy', version: 2, name: name.value, width, height, crop, annotations: arrows, background: background && { src: background.src, x: background.x, y: background.y, width: background.width, height: background.height } };
  const blob = new Blob([JSON.stringify(project)], { type: 'application/json' });
  const savedRevision = revision;
  try {
    if (desktop) {
      if (await nativeSave(blob, filename(name.value, 'markboxy'))) { if (savedRevision === revision) changed = false; notice('可編輯文件已儲存。'); }
    } else { offerDownload(blob, filename(name.value, 'markboxy')); notice('已開始下載可編輯文件；請確認下載完成後再關閉，避免遺失編輯。'); }
  } catch (error) { notice(`儲存失敗：${String(error)} 原文件仍保留。`); }
}
document.querySelector('#save-project')!.addEventListener('click', saveProject);
function showExport() {
  cancelDrag();
  closeMenus();
  if (cropDraft) { notice('請先套用或取消裁切，再匯出。'); return; }
  exportName.value = name.value.trim() || '空白';
  if (!dialog.open) dialog.showModal();
}
for (const id of ['export', 'share']) document.getElementById(id)!.addEventListener('click', showExport);
document.querySelector('#cancel-export')!.addEventListener('click', () => dialog.close());
document.querySelector('#export-form')!.addEventListener('submit', async event => {
  event.preventDefault();
  try {
    const saveName = filename(exportName.value);
    const blob = await exportImage();
    if (desktop) { if (!await nativeSave(blob, saveName)) return; }
    else offerDownload(blob, saveName);
    dialog.close();
    notice(desktop ? '圖片已儲存；可編輯文件仍須另外儲存。' : '已開始下載圖片；選取輪廓與端點不會匯出。');
  } catch (error) {
    dialog.close();
    notice(`匯出失敗：${error instanceof Error ? error.message : '請再試一次。'} 畫布仍保留。`);
  }
});
document.querySelector('#export')!.addEventListener('dragstart', event => {
  const dragEvent = event as DragEvent;
  try {
    const url = exportPNG();
    dragEvent.dataTransfer!.setData('DownloadURL', `image/png:${filename(name.value, 'png')}:${url}`);
    dragEvent.dataTransfer!.effectAllowed = 'copy';
    notice('已準備 PNG 拖出；若瀏覽器不支援，請點底部 PNG 按鈕匯出。');
  } catch { event.preventDefault(); notice('無法拖出圖片，請使用點擊匯出。'); }
});
document.querySelector('#close-notification')!.addEventListener('click', () => { document.querySelector<HTMLElement>('#notification')!.hidden = true; });
document.addEventListener('keydown', event => {
  if (dialog.open) return;
  if (event.key === 'Escape') {
    if (drag) cancelDrag();
    else if (cropDraft) finishCrop(false);
    else { selected = null; setPanel(null); closeMenus(); refresh(); canvas.focus(); }
    event.preventDefault();
    return;
  }
  const command = event.metaKey || event.ctrlKey;
  if ((event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement) && !(command && ['s', 'o', 'e'].includes(event.key.toLowerCase()))) return;
  const active = document.activeElement;
  if (!active?.closest('main,footer,header')) return;
  if (command && event.key.toLowerCase() === 'c') {
    if (!getSelection()?.toString()) { event.preventDefault(); void copyImage(); }
    return;
  }
  if (command && event.key.toLowerCase() === 's') { event.preventDefault(); saveProject(); return; }
  if (command && event.key.toLowerCase() === 'o') { event.preventDefault(); void chooseFile(); return; }
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
  if (changed && !desktop) { event.preventDefault(); event.returnValue = ''; }
});
function cropCorners(c: Crop) {
  return [{ x: c.x, y: c.y }, { x: c.x + c.width / 2, y: c.y }, { x: c.x + c.width, y: c.y }, { x: c.x + c.width, y: c.y + c.height / 2 }, { x: c.x + c.width, y: c.y + c.height }, { x: c.x + c.width / 2, y: c.y + c.height }, { x: c.x, y: c.y + c.height }, { x: c.x, y: c.y + c.height / 2 }];
}
function updateCrop() {
  if (!cropDraft) return;
  document.querySelector<HTMLInputElement>('#crop-width')!.value = String(cropDraft.width);
  document.querySelector<HTMLInputElement>('#crop-height')!.value = String(cropDraft.height);
  refresh();
}
function finishCrop(apply: boolean) {
  if (!cropDraft) return;
  const before = snapshot();
  if (apply) crop = { ...cropDraft };
  cropDraft = null; cropDrag = null;
  document.querySelector<HTMLElement>('#crop-bar')!.hidden = true;
  document.querySelector('#crop-tool')!.setAttribute('aria-pressed', 'false');
  commit(before); layout(); canvas.focus();
}
document.querySelector('#crop-tool')!.addEventListener('click', () => {
  cancelDrag(); closeMenus(); setPanel(null); selected = null;
  cropDraft = { ...(crop ?? { x: 0, y: 0, width, height }) };
  document.querySelector<HTMLElement>('#crop-bar')!.hidden = false;
  document.querySelector('#crop-tool')!.setAttribute('aria-pressed', 'true');
  fit = true; layout(); updateCrop(); canvas.focus();
});
document.querySelector('#crop-cancel')!.addEventListener('click', () => finishCrop(false));
function readCropSize() {
  if (!cropDraft) return false;
  const w = Number(document.querySelector<HTMLInputElement>('#crop-width')!.value);
  const h = Number(document.querySelector<HTMLInputElement>('#crop-height')!.value);
  if (!Number.isInteger(w) || !Number.isInteger(h) || w < 1 || h < 1 || w > width - cropDraft.x || h > height - cropDraft.y) {
    notice('裁切尺寸須為範圍內的正整數。'); return false;
  }
  cropDraft.width = w; cropDraft.height = h;
  return true;
}
document.querySelector('#crop-apply')!.addEventListener('click', () => { if (readCropSize()) finishCrop(true); });
for (const side of ['width', 'height'] as const) {
  document.querySelector<HTMLInputElement>(`#crop-${side}`)!.addEventListener('change', () => { if (readCropSize()) updateCrop(); });
}
canvas.addEventListener('pointerdown', event => {
  if (!cropDraft || event.button !== 0 || !event.isPrimary) return;
  event.stopImmediatePropagation(); event.preventDefault();
  const point = position(event), corners = cropCorners(cropDraft);
  let corner = corners.findIndex(p => Math.hypot(p.x - point.x, p.y - point.y) <= 14 / zoom);
  if (corner < 0 && point.x > cropDraft.x && point.x < cropDraft.x + cropDraft.width && point.y > cropDraft.y && point.y < cropDraft.y + cropDraft.height && (cropDraft.width < width || cropDraft.height < height)) corner = -2;
  cropDrag = { id: event.pointerId, origin: point, corner, before: { ...cropDraft } };
  canvas.setPointerCapture(event.pointerId);
}, true);
canvas.addEventListener('pointermove', event => {
  if (!cropDraft || !cropDrag || event.pointerId !== cropDrag.id) return;
  event.stopImmediatePropagation();
  const point = position(event), b = cropDrag.before, corner = cropDrag.corner;
  if (corner === -2) {
    cropDraft = { ...b, x: Math.round(Math.max(0, Math.min(width - b.width, b.x + point.x - cropDrag.origin.x))), y: Math.round(Math.max(0, Math.min(height - b.height, b.y + point.y - cropDrag.origin.y))) };
  } else {
    const anchor = corner < 0 ? cropDrag.origin : cropCorners(b)[(corner + 4) % 8]!;
    const ax = Math.round(Math.max(0, Math.min(width - 1, anchor.x))), ay = Math.round(Math.max(0, Math.min(height - 1, anchor.y)));
    const x = Math.round(Math.max(0, Math.min(width, point.x))), y = Math.round(Math.max(0, Math.min(height, point.y)));
    cropDraft = { x: Math.min(ax, x), y: Math.min(ay, y), width: Math.max(1, Math.abs(ax - x)), height: Math.max(1, Math.abs(ay - y)) };
    if (corner === 1 || corner === 5) { cropDraft.x = b.x; cropDraft.width = b.width; }
    if (corner === 3 || corner === 7) { cropDraft.y = b.y; cropDraft.height = b.height; }
  }
  updateCrop();
}, true);
function cancelCropDrag() { if (cropDrag) { cropDraft = cropDrag.before; cropDrag = null; updateCrop(); } }
canvas.addEventListener('pointerup', event => {
  if (!cropDrag || cropDrag.id !== event.pointerId) return;
  cropDrag = null; canvas.releasePointerCapture(event.pointerId);
}, true);
canvas.addEventListener('pointercancel', cancelCropDrag);
canvas.addEventListener('lostpointercapture', cancelCropDrag);
window.addEventListener('blur', cancelCropDrag);

let space = false;
let pan: { id: number; x: number; y: number; left: number; top: number } | null = null;
document.addEventListener('keydown', event => {
  if (event.code === 'Space' && !event.ctrlKey && !event.metaKey && !event.altKey && document.activeElement === canvas) { space = true; event.preventDefault(); canvas.style.cursor = 'grab'; }
  if (event.key === 'Enter' && cropDraft && document.activeElement === canvas) { event.preventDefault(); finishCrop(true); }
});
document.addEventListener('keyup', event => { if (event.code === 'Space') { space = false; canvas.style.cursor = 'crosshair'; } });
window.addEventListener('blur', () => { space = false; pan = null; });
canvas.addEventListener('pointerdown', event => {
  if (cropDraft || (!space && event.button !== 1)) return;
  event.stopImmediatePropagation(); event.preventDefault();
  pan = { id: event.pointerId, x: event.clientX, y: event.clientY, left: workspace.scrollLeft, top: workspace.scrollTop };
  canvas.setPointerCapture(event.pointerId); canvas.style.cursor = 'grabbing';
}, true);
canvas.addEventListener('pointermove', event => {
  if (!pan || pan.id !== event.pointerId) return;
  event.stopImmediatePropagation();
  workspace.scrollLeft = pan.left + pan.x - event.clientX;
  workspace.scrollTop = pan.top + pan.y - event.clientY;
}, true);
canvas.addEventListener('pointerup', event => { if (pan?.id === event.pointerId) { pan = null; canvas.releasePointerCapture(event.pointerId); canvas.style.cursor = 'grab'; } }, true);
canvas.addEventListener('pointercancel', () => { pan = null; });
canvas.addEventListener('lostpointercapture', () => { pan = null; });

if (desktop) {
  const captureButton = document.querySelector<HTMLButtonElement>('#capture-region')!;
  captureButton.disabled = false;
  async function capture() {
    if (dialog.open || cropDraft) { notice('請先關閉匯出視窗或完成裁切，再進行截圖。'); return; }
    closeMenus();
    try { const file = await nativeCapture(); if (file) await openFile(file); }
    catch (error) { notice(`截圖失敗：${String(error)}`); }
  }
  captureButton.addEventListener('click', capture);
  void desktopEvents(capture, async () => !changed || await askDiscard('尚有未儲存的編輯。確定關閉 Markboxy 嗎？')).catch(error => notice(`無法連接桌面事件：${String(error)}`));
}
layout();
