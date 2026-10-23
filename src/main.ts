import { desktop, nativeOpen, nativeCapture, nativeSave, desktopEvents } from './desktop.ts';
import { arrowPath, type Point } from './arrow.ts';

import { TOOL_SIZES, resizeScene, readStylePreference, shapePath, shapeStroke, expandedScene, sceneFrame, loadImage, isInk, inkAlpha, textSize, textFont, textLines, type Annotation, type Background, type Crop, readProject, type Project } from './document.ts';

let background: Background | null = null;
let tool: NonNullable<Annotation['kind']> = 'arrow';
let opening = 0;
let crop: Crop | null = null;
let cropDraft: Crop | null = null;
let resizeScale: number | null = null;
let resizeInput: 'width' | 'height' | null = null;
let cropDrag: { id: number; origin: Point; corner: number; before: Crop } | null = null;
let format: 'png' | 'jpeg' = 'png';
const exportFormat = document.querySelector<HTMLSelectElement>('#export-format')!;
let width = 1130;
let height = 732;
let renderArea: Crop = { x: 0, y: 0, width, height };
type Snapshot = { width: number; height: number; background: Background | null; arrows: Annotation[]; crop: Crop | null; name: string };
const canvas = document.querySelector<HTMLCanvasElement>('#canvas')!;
document.querySelector('#i-arrow path')!.setAttribute('d', arrowPath({ start: { x: 70, y: 250 }, end: { x: 250, y: 70 }, size: 52 }));
const toolIcons = { arrow: 'arrow', rectangle: 'shape', roundedRectangle: 'rounded', ellipse: 'ellipse', line: 'line', crop: 'crop', text: 'text', pen: 'pen', highlighter: 'highlighter' };
const toolCursors = Object.fromEntries(Object.entries(toolIcons).map(([kind, icon]) => {
  const shape = document.querySelector(`#i-${icon}`)!.innerHTML;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40" viewBox="0 0 40 40"><path d="M1 28h14M8 21v14" fill="none" stroke="white" stroke-width="3"/><path d="M1 28h14M8 21v14" fill="none" stroke="black"/><svg x="17" y="2" width="22" height="22" viewBox="0 0 32 32" color="${kind === 'crop' ? 'black' : 'TOOL_COLOR'}">${shape}</svg></svg>`;
  return [kind, `url("data:image/svg+xml,${encodeURIComponent(svg)}") 8 28, crosshair`];
}));
const textToolPath = new Path2D(document.querySelector('#i-text path')!.getAttribute('d')!);
const arrowMenu = document.querySelector<HTMLElement>('#arrow-menu')!;
let holdTimer: ReturnType<typeof setTimeout> | undefined;
const workspace = document.querySelector<HTMLElement>('#workspace')!;
const stage = document.querySelector<HTMLElement>('#stage')!;
const download = document.querySelector<HTMLAnchorElement>('#download')!;
const name = document.querySelector<HTMLInputElement>('#name')!;
const dialog = document.querySelector<HTMLDialogElement>('#export-dialog')!;
const clearDialog = document.querySelector<HTMLDialogElement>('#clear-dialog')!;
const exportName = document.querySelector<HTMLInputElement>('#export-name')!;
const customColor = document.querySelector<HTMLInputElement>('#color')!;
let arrows: Annotation[] = [];
let selected: number | null = null;
const stylePreferenceKey = 'markboxy.tool-style.v1';
function loadStylePreference() {
  try {
    const stored = localStorage.getItem(stylePreferenceKey), preference = readStylePreference(stored);
    if (stored !== null && stored !== JSON.stringify(preference)) {
      try { localStorage.setItem(stylePreferenceKey, JSON.stringify(preference)); }
      catch { /* Reading preferences still works when migration cannot be written. */ }
    }
    return preference;
  }
  catch { return readStylePreference(null); }
}
let preferredStyle = loadStylePreference();
let style: { color: string; size: number } = { color: preferredStyle.color, size: TOOL_SIZES[preferredStyle.sizeLevel - 1]! };
const presetColors = new Set(Array.from(document.querySelectorAll<HTMLButtonElement>('[data-color]'), button => button.dataset.color!));
let customColorSelected = preferredStyle.customColor === true || !presetColors.has(style.color);
function useAnnotationStyle(item: Annotation) {
  style = { color: item.color.toLowerCase(), size: item.size };
  customColorSelected = !presetColors.has(style.color);
}
let zoom = 1;
let fit = true;
let changed = false;
let revision = 0;
let panel: 'color' | 'size' | 'shape' | 'pen' | null = null;
let pinned = false;
const undo: Snapshot[] = [];
const redo: Snapshot[] = [];
let drag: {
  pointerId: number; target: 'new' | 'move' | 'start' | 'end' | 'ne' | 'sw' | 'ink'; index: number;
  origin: Point; before: Snapshot; previousSelection: number | null; moved: boolean;
} | null = null;
const textEditor = document.querySelector<HTMLTextAreaElement>('#text-editor')!;
let editingText: { index: number; before: Snapshot } | null = null;
let wet: { index: number; before: Snapshot; ended: number | null } | null = null;
let wetTimer: ReturnType<typeof setTimeout> | undefined;
let wetFrame = 0;
let savedState = snapshot();

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
function matches(state: Snapshot) {
  return state.width === width && state.height === height && state.background === background && state.name === name.value && JSON.stringify(state.crop) === JSON.stringify(crop) && JSON.stringify(state.arrows) === JSON.stringify(arrows);
}
function hasUnsavedChanges() { return changed && !matches(savedState); }
function restore(state: Snapshot) {
  ({ width, height, background, arrows, crop } = state);
  name.value = state.name;
  resizeName();
  layout();
}
function commit(before: Snapshot) {
  if (matches(before)) return;
  // ponytail: 100 annotation snapshots share immutable image data; opening a new image drops older history to bound decoded-image memory.
  undo.push(before);
  if (undo.length > 100) undo.shift();
  redo.length = 0;
  changed = true; revision++;
  invalidateDownload();
}
function finishWetInk() {
  clearTimeout(wetTimer); cancelAnimationFrame(wetFrame);
  if (!wet) return;
  const before = wet.before;
  wet = null;
  commit(before); refresh();
}
function animateInk() {
  refresh();
  if (wet?.ended !== null && wet) wetFrame = requestAnimationFrame(animateInk);
}
function updateTextGeometry(item: Annotation) {
  const ctx = canvas.getContext('2d')!;
  ctx.save(); ctx.font = textFont(item);
  item.end.y = item.start.y + 8 * (item.scale ?? 1) + textLines(item, s => ctx.measureText(s).width).length * (item.fontSize ?? textSize(item.size)) * 1.4;
  ctx.restore();
}
function placeTextEditor() {
  if (!editingText) return;
  const item = arrows[editingText.index]!, area = view();
  Object.assign(textEditor.style, {
    left: `${(item.start.x - area.x) * zoom}px`, top: `${(item.start.y - area.y) * zoom}px`,
    width: `${item.end.x - item.start.x}px`, height: `${item.end.y - item.start.y}px`,
    padding: `${4 * (item.scale ?? 1)}px ${8 * (item.scale ?? 1)}px`, font: textFont(item), lineHeight: '1.4', transform: `scale(${zoom})`,
  });
}
function finishText(cancel = false) {
  if (!editingText) return true;
  const { index, before } = editingText;
  editingText = null; textEditor.hidden = true;
  const item = arrows[index]!;
  if (cancel) { selected = null; restore(before); }
  else {
    try {
      if (!item.text?.trim()) {
        if (!before.arrows[index]) restore(before);
        else { arrows.splice(index, 1); shrinkCanvas(); }
        selected = null;
      }
      else { updateTextGeometry(item); expandFor(item); selected = index; }
      commit(before);
    } catch (error) {
      // Keep the draft editable when it exceeds canvas limits, so typed content is not lost.
      editingText = { index, before }; selected = index; textEditor.hidden = false;
      notice(`${String(error)} 請縮短文字或調整位置；輸入內容仍保留。`); refresh(); textEditor.focus(); return false;
    }
  }
  refresh();
  return true;
}
function beginText(point: Point, index: number | null = null) {
  if (!finishText()) return;
  finishWetInk();
  if (index === null && arrows.length >= 500) { notice('目前文件最多容納 500 個標註。'); return; }
  const before = snapshot();
  const creating = index === null;
  if (index === null) {
    arrows.push({ kind: 'text', start: point, end: { x: point.x + 240, y: point.y + 40 }, ...style, text: '', fontSize: textSize(style.size) });
    index = arrows.length - 1;
  }
  selected = index;
  const item = arrows[index]!;
  useAnnotationStyle(item);
  editingText = { index, before };
  textEditor.value = item.text ?? '';
  updateTextGeometry(item);
  if (creating) {
    try { expandFor(item); }
    catch (error) {
      editingText = null; selected = null; restore(before); notice(String(error)); return;
    }
  }
  textEditor.hidden = false;
  refresh(); textEditor.focus();
}
textEditor.addEventListener('input', () => {
  if (!editingText) return;
  const item = arrows[editingText.index]!;
  item.text = textEditor.value;
  updateTextGeometry(item);
  changed = true; revision++; invalidateDownload(); refresh();
});
textEditor.addEventListener('keydown', event => {
  if (event.isComposing) return;
  if (event.key === 'Escape' || ((event.metaKey || event.ctrlKey) && event.key === 'Enter')) {
    event.preventDefault(); event.stopPropagation(); if (finishText(event.key === 'Escape')) canvas.focus();
  }
});
document.addEventListener('pointerdown', event => {
  if (event.button === 0 && event.isPrimary && event.target instanceof Element && event.target.closest('#canvas,#text-editor') && (onEditingTextFrame(position(event)) || onTextIcon(position(event)))) {
    // A frame drag is still part of the text edit; finishing here deletes an empty draft.
    event.preventDefault(); event.stopImmediatePropagation(); startDrag(event); return;
  }
  if (editingText && event.target instanceof Element && !event.target.closest('#text-editor,.rail')) {
    const blank = event.button === 0 && event.isPrimary && event.target.matches('#canvas,#workspace,#stage') && hit(position(event)) === null;
    if (!finishText()) { event.preventDefault(); event.stopImmediatePropagation(); return; }
    if (blank) {
      event.preventDefault(); event.stopImmediatePropagation();
      selected = null; refresh(); canvas.focus();
    }
  }
}, true);
textEditor.addEventListener('pointermove', event => {
  textEditor.style.cursor = onEditingTextFrame(position(event)) ? 'move' : 'text';
});
canvas.addEventListener('dblclick', event => {
  if (cropDraft) return;
  const index = hit(position(event));
  if (index !== null && arrows[index]!.kind === 'text') { cancelDrag(); beginText(position(event), index); }
});
function view(): Crop { return ((!cropDraft || resizeScale !== null) && crop) || { x: 0, y: 0, width, height }; }
function drawScene(target: HTMLCanvasElement, editing = false) {
  const ctx = target.getContext('2d');
  if (!ctx) throw new Error('瀏覽器無法建立繪圖畫布，可能超過此裝置的畫布尺寸或記憶體限制。');
  const area = editing ? renderArea : view();
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
    ctx.shadowBlur = 2 * scale * (arrow.scale ?? 1);
    ctx.shadowOffsetY = 2 * scale * (arrow.scale ?? 1);
    if (arrow.kind === 'text') {
      const fontSize = arrow.fontSize ?? textSize(arrow.size);
      ctx.font = textFont(arrow); ctx.textBaseline = 'alphabetic';
      ctx.lineJoin = 'round'; ctx.strokeStyle = '#fff'; ctx.lineWidth = Math.max(arrow.scale ?? 1, fontSize * .06);
      ctx.shadowBlur = scale * (arrow.scale ?? 1); ctx.shadowOffsetY = scale * (arrow.scale ?? 1);
      const lines = textLines(arrow, s => ctx.measureText(s).width);
      lines.forEach((line, i) => {
        const x = arrow.start.x + 8 * (arrow.scale ?? 1), y = arrow.start.y + 4 * (arrow.scale ?? 1) + fontSize * 1.1 + i * fontSize * 1.4;
        ctx.shadowColor = 'rgba(0,0,0,0.2)';
        ctx.strokeText(line, x, y);
        ctx.shadowColor = 'transparent';
        ctx.fillText(line, x, y);
      });
    } else if (arrow.kind && arrow.kind !== 'arrow') {
      if (isInk(arrow)) {
        ctx.shadowColor = 'transparent';
        ctx.globalAlpha = arrow.kind === 'highlighter' ? .4 : editing && wet?.index === index ? (wet.ended === null ? .25 : inkAlpha(performance.now() - wet.ended)) : 1;
      }
      ctx.strokeStyle = arrow.color;
      ctx.lineWidth = shapeStroke(arrow.size) * (arrow.scale ?? 1) * (arrow.kind === 'highlighter' ? 2 : 1);
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      ctx.stroke(path);
    } else ctx.fill(path);
    ctx.restore();
    if (editing && !cropDraft && selected === index) {
      ctx.strokeStyle = '#71d8e9';
      ctx.lineWidth = 1 / zoom;
      ctx.stroke(path);
      if (arrow.kind === 'text') {
        const x = (arrow.start.x + arrow.end.x) / 2, y = arrow.start.y - 18 / zoom;
        ctx.beginPath(); ctx.arc(x, y, 12 / zoom, 0, Math.PI * 2); ctx.fillStyle = '#21aece'; ctx.fill();
        ctx.save(); ctx.translate(x - 9 / zoom, y - 9 / zoom); ctx.scale(18 / (32 * zoom), 18 / (32 * zoom));
        ctx.strokeStyle = '#fff'; ctx.lineWidth = 2.25; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.stroke(textToolPath); ctx.restore();
      }
      for (const [i, p] of handles(arrow).entries()) {
        ctx.beginPath();
        ctx.arc(p.x, p.y, 6.5 / zoom, 0, Math.PI * 2);
        ctx.fillStyle = arrow.kind === 'text' && i < 2 ? '#fff' : '#21aece';
        ctx.fill();
        ctx.strokeStyle = arrow.kind === 'text' && i < 2 ? '#21aece' : '#fff';
        ctx.lineWidth = 1.5 / zoom;
        ctx.stroke();
      }
    }
  });
  if (editing && cropDraft && resizeScale === null) {
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
  const area = view();
  renderArea = area;
  const active = drag && arrows[drag.index];
  if (active && !crop && !cropDraft) {
    try { renderArea = sceneFrame(area, [active]); }
    catch (error) { notice(String(error)); }
  }
  const text = selected === null ? null : arrows[selected];
  if (!cropDraft && text?.kind === 'text') {
    // Selection controls belong to the preview, including the icon 30 screen pixels above the frame.
    const x = Math.min(renderArea.x, text.start.x - 8 / zoom, (text.start.x + text.end.x) / 2 - 13 / zoom);
    const y = Math.min(renderArea.y, text.start.y - 31 / zoom);
    renderArea = { x, y, width: Math.max(renderArea.x + renderArea.width, text.end.x + 8 / zoom, (text.start.x + text.end.x) / 2 + 13 / zoom) - x,
      height: Math.max(renderArea.y + renderArea.height, text.end.y + 8 / zoom) - y };
  }
  Object.assign(canvas.style, { left: `${(renderArea.x - area.x) * zoom}px`, top: `${(renderArea.y - area.y) * zoom}px`, width: `${renderArea.width * zoom}px`, height: `${renderArea.height * zoom}px` });
  // ponytail: cap preview memory and surface dimensions; exports retain the full document size.
  const ratio = Math.min(devicePixelRatio, 2, Math.min(Math.sqrt(16_000_000 / (renderArea.width * renderArea.height)), 4096 / Math.max(renderArea.width, renderArea.height)) / zoom);
  const bitmapWidth = Math.max(1, Math.floor(renderArea.width * zoom * ratio)), bitmapHeight = Math.max(1, Math.floor(renderArea.height * zoom * ratio));
  if (canvas.width !== bitmapWidth) canvas.width = bitmapWidth;
  if (canvas.height !== bitmapHeight) canvas.height = bitmapHeight;
  drawScene(canvas, true);
  placeTextEditor();
  workspace.style.setProperty('--tool-cursor', toolCursors[cropDraft ? 'crop' : tool]!.replace('TOOL_COLOR', encodeURIComponent(style.color)));
  canvas.style.cursor = 'var(--tool-cursor)';
  document.querySelector<HTMLElement>('#current-color')!.style.setProperty('--swatch', style.color);
  customColor.value = style.color;
  for (const button of document.querySelectorAll<HTMLButtonElement>('[data-color]')) {
    button.setAttribute('aria-pressed', String(!customColorSelected && button.dataset.color === style.color));
  }
  document.querySelector('.custom-color')!.classList.toggle('selected-color', customColorSelected);
  customColor.setAttribute('aria-description', customColorSelected ? '目前選取自訂色彩' : '選擇自訂色彩');
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
  document.querySelector<HTMLButtonElement>('#trash')!.disabled = arrows.length === 0 && !background && !crop && width === 1130 && height === 732;
  for (const button of document.querySelectorAll<HTMLButtonElement>('[data-tool]')) {
    const active = !cropDraft && button.dataset.tool === tool;
    button.classList.toggle('selected', active);
    button.setAttribute('aria-pressed', String(active));
  }
  const shapeIcons: Partial<Record<typeof tool, string>> = { rectangle: '#i-shape', roundedRectangle: '#i-rounded', ellipse: '#i-ellipse', line: '#i-line' };
  const shapeIcon = shapeIcons[tool];
  document.querySelector('#shape-tool')!.classList.toggle('selected', !cropDraft && !!shapeIcon);
  document.querySelector('#shape-tool')!.setAttribute('aria-pressed', String(!cropDraft && !!shapeIcon));
  document.querySelector('#shape-tool use')!.setAttribute('href', shapeIcon ?? '#i-shape');
  const penActive = !cropDraft && (tool === 'pen' || tool === 'highlighter');
  document.querySelector('#pen-tool')!.classList.toggle('selected', penActive);
  document.querySelector('#pen-tool')!.setAttribute('aria-pressed', String(penActive));
  document.querySelector('#pen-tool use')!.setAttribute('href', tool === 'highlighter' ? '#i-highlighter' : '#i-pen');
  canvas.dataset.ink = wet ? wet.ended === null ? 'writing' : 'drying' : 'dry';
  const dimensions = cropDraft ? (crop ?? { width, height }) : view();
  document.querySelector('#dimensions')!.textContent = `${dimensions.width} x ${dimensions.height}`;
  document.querySelector('#export-form p')!.textContent = `${view().width} × ${view().height} 像素`;
}
function layout() {
  document.querySelector('main')!.classList.toggle('cropping', !!cropDraft);
  document.querySelector('main')!.classList.toggle('resizing', resizeScale !== null);
  document.querySelector<HTMLElement>('#resize-footer')!.hidden = resizeScale === null;
  document.querySelector('#crop-mode-switch')!.setAttribute('aria-checked', String(resizeScale !== null));
  for (const side of ['width', 'height']) document.querySelector(`#crop-${side}`)!.setAttribute('aria-label', `${resizeScale === null ? '裁切' : '縮放'}${side === 'width' ? '寬度' : '高度'}`);
  if (resizeScale !== null) { fit = false; zoom = resizeScale; }
  document.querySelector('#crop-tool')!.classList.toggle('selected', !!cropDraft);
  const area = view();
  if (fit) {
    const padding = innerWidth <= 600 ? 72 : 80;
    zoom = Math.max(.05, Math.min(1, (workspace.clientWidth - padding) / area.width, (workspace.clientHeight - padding - (cropDraft ? 56 : 0)) / area.height));
  }
  stage.style.width = `${area.width * zoom}px`;
  stage.style.height = `${area.height * zoom}px`;
  document.querySelector('#zoom')!.innerHTML = `${Math.round(zoom * 100)}%<svg class="chevron" aria-hidden="true"><use href="#i-chevron"/></svg>`;
  refresh();
}
new ResizeObserver(layout).observe(workspace);

function setPanel(value: typeof panel) {
  panel = value;
  document.querySelector<HTMLElement>('#tools')!.hidden = value !== null;
  document.querySelector<HTMLElement>('#color-panel')!.hidden = value !== 'color';
  document.querySelector<HTMLElement>('#size-panel')!.hidden = value !== 'size';
  document.querySelector<HTMLElement>('#shape-panel')!.hidden = value !== 'shape';
  document.querySelector<HTMLElement>('#pen-panel')!.hidden = value !== 'pen';
  document.querySelector('#pen-tool')!.setAttribute('aria-expanded', String(value === 'pen'));
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
  delete canvas.dataset.tabFocus;
  if (event.target instanceof Element && !event.target.closest('#arrow-menu')) arrowMenu.hidePopover();
  if (!(event.target instanceof Element) || !event.target.closest('.capture,.footer-control,#arrow-menu')) closeMenus();
});
function selectTool(value: typeof tool) {
  cancelDrag();
  if (!finishText()) return;
  finishWetInk();
  if (cropDraft) finishCrop(false);
  tool = value;
  selected = null;
  if (!pinned) setPanel(null);
  refresh();
  canvas.focus();
}
document.querySelector('#shape-tool')!.addEventListener('click', () => {
  selectTool(['rectangle', 'roundedRectangle', 'ellipse', 'line'].includes(tool) ? tool : 'rectangle');
  setPanel('shape');
});
document.querySelector('#pen-tool')!.addEventListener('click', () => {
  selectTool(tool === 'highlighter' ? 'highlighter' : 'pen'); setPanel('pen');
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

function translateScene(dx: number, dy: number) {
  for (const item of arrows) {
    item.start = { x: item.start.x + dx, y: item.start.y + dy };
    item.end = { x: item.end.x + dx, y: item.end.y + dy };
  }
  if (background) background = { ...background, x: background.x + dx, y: background.y + dy };
}
function shrinkCanvas() {
  if (background && !crop) applyCanvasFrame(sceneFrame(background, arrows));
}
function applyCanvasFrame(frame: Crop) {
  const previousHeight = height;
  if (frame.width !== width || frame.height !== height || frame.x !== 0 || frame.y !== 0) {
    translateScene(-frame.x, -frame.y);
    width = frame.width;
    height = frame.height;
    fit = false;
    layout();
    workspace.scrollLeft -= frame.x * zoom;
    workspace.scrollTop += Math.max(-frame.y, height - previousHeight) * zoom;
  }
}
function expandFor(item: Annotation) {
  if (crop) return;
  if (background) { shrinkCanvas(); return; }
  const expanded = expandedScene(width, height, item);
  applyCanvasFrame({ x: -expanded.offsetX, y: -expanded.offsetY, width: expanded.width, height: expanded.height });
}
function setStyle(value: Partial<typeof style>, sizeLevel?: number, customColorChoice?: boolean) {
  if (!finishText()) return;
  finishWetInk();
  const before = snapshot(), previousStyle = style, previousCustomColor = customColorSelected;
  style = { ...style, ...value };
  if (customColorChoice !== undefined) customColorSelected = customColorChoice;
  if (selected !== null) {
    try {
      Object.assign(arrows[selected]!, value);
      if (arrows[selected]!.kind === 'text') {
        if (value.size !== undefined) arrows[selected]!.fontSize = textSize(value.size) * (arrows[selected]!.scale ?? 1);
        updateTextGeometry(arrows[selected]!);
      }
      expandFor(arrows[selected]!);
      commit(before);
    } catch (error) {
      style = previousStyle; customColorSelected = previousCustomColor; restore(before);
      notice(error instanceof Error ? error.message : '無法調整樣式，原文件仍保留。');
      refresh(); return;
    }
  }
  // Persist successful choices in the style controls; selecting existing annotations does not overwrite them.
  preferredStyle = { color: style.color, sizeLevel: sizeLevel ?? preferredStyle.sizeLevel, customColor: customColorSelected };
  try { localStorage.setItem(stylePreferenceKey, JSON.stringify(preferredStyle)); }
  catch { notice('目前樣式仍可使用，但無法記住設定；請確認此環境允許本機儲存。'); }
  refresh();
}
for (const button of document.querySelectorAll<HTMLButtonElement>('[data-color],[data-size]')) {
  button.addEventListener('click', () => {
    setStyle(button.dataset.color ? { color: button.dataset.color } : { size: Number(button.dataset.size) }, button.dataset.sizeLevel ? Number(button.dataset.sizeLevel) : undefined, button.dataset.color ? false : undefined);
    if (!pinned) setPanel(null);
    canvas.focus();
  });
}
customColor.addEventListener('input', () => setStyle({ color: customColor.value }, undefined, true));
customColor.addEventListener('change', () => { if (!pinned) setPanel(null); });

function position(event: MouseEvent): Point {
  const rect = canvas.getBoundingClientRect();
  const area = renderArea;
  return {
    x: area.x + (event.clientX - rect.left) * area.width / rect.width,
    y: area.y + (event.clientY - rect.top) * area.height / rect.height,
  };
}
function handles(item: Annotation) {
  if (isInk(item)) return [];
  if (item.kind === 'text') return [{ x: item.start.x, y: (item.start.y + item.end.y) / 2 }, { x: item.end.x, y: (item.start.y + item.end.y) / 2 }, item.end];
  return !item.kind || item.kind === 'arrow' || item.kind === 'line' ? [item.start, item.end] :
    [item.start, item.end, { x: item.end.x, y: item.start.y }, { x: item.start.x, y: item.end.y }];
}
function onTextIcon(point: Point) {
  const item = selected === null ? null : arrows[selected];
  return !cropDraft && item?.kind === 'text' && Math.hypot(point.x - (item.start.x + item.end.x) / 2, point.y - item.start.y + 18 / zoom) <= 12 / zoom;
}
function onEditingTextFrame(point: Point) {
  if (!editingText) return false;
  const item = arrows[editingText.index]!, margin = 6 / zoom;
  return handles(item).some(p => Math.hypot(p.x - point.x, p.y - point.y) <= 12 / zoom) ||
    (point.x >= item.start.x - margin && point.x <= item.end.x + margin && point.y >= item.start.y - margin && point.y <= item.end.y + margin &&
      Math.min(Math.abs(point.x - item.start.x), Math.abs(point.x - item.end.x), Math.abs(point.y - item.start.y), Math.abs(point.y - item.end.y)) <= margin);
}
function hit(point: Point) {
  const ctx = canvas.getContext('2d')!;
  ctx.save();
  ctx.resetTransform();
  ctx.lineCap = 'round';
  ctx.lineWidth = 8 / zoom;
  let result: number | null = null;
  for (let index = arrows.length - 1; index >= 0; index--) {
    const item = arrows[index]!;
    const path = new Path2D(shapePath(item));
    if (item.kind === 'text' && ctx.isPointInPath(path, point.x, point.y)) { result = index; break; }
    const isArrow = !arrows[index]!.kind || arrows[index]!.kind === 'arrow';
    ctx.lineWidth = (isArrow ? 0 : shapeStroke(item.size) * (item.scale ?? 1) * (item.kind === 'highlighter' ? 2 : 1)) + 8 / zoom;
    if ((isArrow && ctx.isPointInPath(path, point.x, point.y)) || ctx.isPointInStroke(path, point.x, point.y)) {
      result = index;
      break;
    }
  }
  ctx.restore();
  return result;
}
function startDrag(event: PointerEvent) {
  if (cropDraft) return;
  if (event.button !== 0 || !event.isPrimary || drag) return;
  closeMenus();
  if (!pinned) setPanel(null);
  document.querySelector<HTMLElement>('#notification')!.hidden = true;
  const point = position(event);
  const textFrame = onEditingTextFrame(point);
  const textIcon = onTextIcon(point);
  const onHandle = selected !== null && handles(arrows[selected]!).some(p => Math.hypot(p.x - point.x, p.y - point.y) <= 12 / zoom);
  if (tool === 'text' && !textFrame && !textIcon && !onHandle && hit(point) === null) {
    event.preventDefault();
    if (selected !== null) { selected = null; refresh(); canvas.focus(); }
    else beginText(point);
    return;
  }
  const inkHit = hit(point);
  const selectsInk = inkHit !== null && isInk(arrows[inkHit]!) && wet?.index !== inkHit;
  if ((tool === 'pen' || tool === 'highlighter') && !selectsInk && !textIcon) {
    if (wet && arrows[wet.index]?.kind !== tool) finishWetInk();
    if (wet && arrows[wet.index]!.strokes!.length >= 2000) finishWetInk();
    if (!wet) {
      if (arrows.length >= 500) { notice('目前文件最多容納 500 個標註。'); return; }
      const before = snapshot();
      arrows.push({ kind: tool, start: { ...point }, end: { ...point }, ...style, strokes: [] });
      wet = { index: arrows.length - 1, before, ended: null };
    }
    clearTimeout(wetTimer); cancelAnimationFrame(wetFrame);
    wet.ended = null;
    const before = snapshot(), item = arrows[wet.index]!;
    item.strokes!.push([{ x: point.x - item.start.x, y: point.y - item.start.y }]);
    drag = { pointerId: event.pointerId, target: 'ink', index: wet.index, origin: point, before, previousSelection: null, moved: false };
    selected = null; changed = true; revision++; invalidateDownload();
    canvas.setPointerCapture(event.pointerId); canvas.focus(); refresh(); return;
  }
  finishWetInk();
  const before = snapshot();
  const previousSelection = selected;
  let target: 'new' | 'move' | 'start' | 'end' | 'ne' | 'sw' = 'move';
  if (selected !== null && !textIcon) {
    const arrow = arrows[selected]!;
    const distances = handles(arrow).map(p => Math.hypot(p.x - point.x, p.y - point.y));
    if (Math.min(...distances) <= 12 / zoom) target = (['start', 'end', 'ne', 'sw'] as const)[distances.indexOf(Math.min(...distances))]!;
  }
  if (target === 'move' && !textIcon) selected = textFrame ? editingText!.index : hit(point);
  if (selected === null) {
    if (arrows.length >= 500) { notice('目前文件最多容納 500 個標註。'); return; }
    arrows.push({ kind: tool, start: point, end: point, ...style });
    selected = arrows.length - 1;
    target = 'new';
  } else {
    useAnnotationStyle(arrows[selected]!);
  }
  drag = { pointerId: event.pointerId, target, index: selected, origin: point, before, previousSelection, moved: false };
  if (target === 'new') selected = null;
  if (target !== 'new' && !editingText) {
    const index = selected!;
    holdTimer = setTimeout(() => {
      cancelDrag();
      showArrowMenu(index, event.clientX, event.clientY);
    }, 550);
  }
  canvas.setPointerCapture(event.pointerId);
  canvas.focus();
  refresh();
}
canvas.addEventListener('pointerdown', startDrag);
workspace.addEventListener('pointerdown', event => {
  if (event.target !== workspace && event.target !== stage) return;
  if (event.button !== 0 || !event.isPrimary || space || cropDraft) return;
  if (crop) { notice('請先復原裁切，才能在畫布外新增標註。'); return; }
  event.preventDefault();
  startDrag(event);
});
function move(event: PointerEvent) {
  if (!drag || drag.pointerId !== event.pointerId) return;
  let point = position(event);
  const arrow = arrows[drag.index]!;
  if (drag.target === 'ink') {
    const stroke = arrow.strokes!.at(-1)!;
    // ponytail: keep up to 100k sampled points per group; stop this stroke rather than silently discard input at the limit.
    let count = arrow.strokes!.reduce((count, s) => count + s.length, 0);
    if (count >= 100000) { notice('這組筆畫已達 100,000 點，請放開後另起一組。'); return; }
    for (const sample of event.getCoalescedEvents?.().length ? event.getCoalescedEvents() : [event]) {
      point = position(sample);
      const local = { x: point.x - arrow.start.x, y: point.y - arrow.start.y }, last = stroke.at(-1)!;
      if (Math.hypot(local.x - last.x, local.y - last.y) >= .5 && count < 100000) { stroke.push(local); count++; }
    }
    drag.moved = true; refresh(); return;
  }
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
  } else if (arrow.kind === 'text') {
    const original = drag.before.arrows[drag.index]!;
    if (drag.target === 'start') arrow.start.x = Math.min(point.x, arrow.end.x - 32 * (arrow.scale ?? 1));
    else if (drag.target === 'end') arrow.end.x = Math.max(arrow.start.x + 32 * (arrow.scale ?? 1), point.x);
    else {
      const factor = Math.max(.1, (point.x - original.start.x) / (original.end.x - original.start.x));
      arrow.fontSize = Math.max(8 * (arrow.scale ?? 1), Math.min(256 * (arrow.scale ?? 1), (original.fontSize ?? textSize(original.size)) * factor));
      arrow.end.x = arrow.start.x + Math.max(32 * (arrow.scale ?? 1), (original.end.x - original.start.x) * arrow.fontSize / (original.fontSize ?? textSize(original.size)));
    }
    updateTextGeometry(arrow);
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
  else canvas.style.cursor = space ? 'grab' : cropDraft || (!onEditingTextFrame(position(event)) && !onTextIcon(position(event)) && hit(position(event)) === null) ? 'var(--tool-cursor)' : 'move';
});
function finishDrag(event: PointerEvent) {
  if (!drag || drag.pointerId !== event.pointerId) return;
  clearTimeout(holdTimer);
  move(event);
  const { target, before, moved, index, previousSelection } = drag;
  if (target === 'ink') {
    drag = null;
    if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
    try { expandFor(arrows[index]!); }
    catch (error) { restore(before); notice(String(error)); }
    if (wet) {
      if (!arrows[index]!.strokes?.length) { arrows.splice(index, 1); wet = null; }
      else if (arrows[index]!.kind === 'highlighter' || arrows[index]!.strokes!.reduce((n, s) => n + s.length, 0) >= 100000) finishWetInk();
      else { wet.ended = performance.now(); wetTimer = setTimeout(finishWetInk, 1000); animateInk(); }
    }
    refresh(); return;
  }
  if (target === 'new' && (!moved || !shapePath(arrows[index]!))) {
    restore(before);
    selected = null;
  } else if (target !== 'move' && target !== 'new' && !shapePath(arrows[index]!)) {
    restore(before);
    selected = previousSelection;
  } else {
    try {
      expandFor(arrows[index]!);
      if (!editingText) commit(before);
    } catch (error) {
      selected = previousSelection;
      restore(before);
      notice(error instanceof Error ? error.message : '畫布無法延展，已保留原本的箭頭。');
    }
  }
  drag = null;
  if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
  refresh();
  if (editingText) textEditor.focus();
}
canvas.addEventListener('pointerup', finishDrag);
function cancelDrag() {
  clearTimeout(holdTimer);
  if (!drag) return;
  const { before, previousSelection, pointerId, target, index } = drag;
  drag = null;
  restore(before);
  if (target === 'ink' && wet) {
    if (!arrows[index]?.strokes?.length) { arrows.splice(index, 1); wet = null; }
    else { wet.ended = performance.now(); wetTimer = setTimeout(finishWetInk, 1000); animateInk(); }
  }
  selected = previousSelection;
  if (canvas.hasPointerCapture(pointerId)) canvas.releasePointerCapture(pointerId);
  refresh();
  if (editingText) textEditor.focus();
}
canvas.addEventListener('pointercancel', cancelDrag);
canvas.addEventListener('lostpointercapture', event => {
  if (drag?.pointerId !== event.pointerId) return;
  // Chrome can release capture on a buttons=0 move before delivering pointerup.
  if (event.pointerType === 'mouse' && event.buttons === 0) finishDrag(event);
  else cancelDrag();
});
function history(backwards: boolean) {
  cancelDrag();
  if (!finishText()) return;
  finishWetInk();
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
  if (!finishText()) return;
  finishWetInk();
  closeMenus();
  const before = snapshot();
  arrows = [];
  background = null;
  crop = null;
  cropDraft = null; resizeScale = null; resizeInput = null;
  document.querySelector<HTMLElement>('#crop-bar')!.hidden = true;
  document.querySelector('#crop-tool')!.setAttribute('aria-pressed', 'false');
  width = 1130;
  height = 732;
  selected = null;
  if (newName !== undefined) { name.value = newName; resizeName(); }
  layout();
  commit(before);
  if (newName !== undefined) { savedState = snapshot(); changed = false; }
  refresh();
  canvas.focus();
}
document.querySelector('#blank')!.addEventListener('click', () => {
  clear('空白');
  closeMenus();
  canvas.focus();
});
async function askConfirmation(title: string, description: string, note: string, action: string, icon: string) {
  if (clearDialog.open) return false;
  closeMenus();
  const previousFocus = document.activeElement;
  document.querySelector('#clear-title')!.textContent = title;
  document.querySelector('#clear-description')!.textContent = description;
  document.querySelector('#clear-note')!.textContent = note;
  for (const use of clearDialog.querySelectorAll('use')) use.setAttribute('href', `#i-${icon}`);
  document.querySelector('#confirm-clear span')!.textContent = action;
  clearDialog.returnValue = 'cancel';
  const closed = new Promise<void>(resolve => clearDialog.addEventListener('close', () => resolve(), { once: true }));
  clearDialog.showModal();
  await closed;
  if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus();
  return clearDialog.returnValue === 'clear';
}
document.querySelector('#trash')!.addEventListener('click', async () => {
  if (clearDialog.open) return;
  cancelDrag();
  if (!finishText()) return;
  finishWetInk();
  const before = snapshot();
  if (await askConfirmation('清除畫布？', '所有標註與底圖將移除，畫布會恢復預設大小。', '清除後仍可使用「復原」還原。', '清除畫布', 'trash')) {
    if (!matches(before)) { notice('文件已變更，請重新按垃圾桶確認清除。'); return; }
    clear();
  }
});
function deleteSelected() {
  cancelDrag();
  if (!finishText()) return;
  finishWetInk();
  if (selected === null) return;
  const before = snapshot();
  const index = selected;
  arrows.splice(index, 1);
  selected = null;
  try { shrinkCanvas(); }
  catch (error) {
    restore(before); selected = index; refresh(); notice(`${String(error)} 原文件仍保留。`); return;
  }
  commit(before);
  refresh();
  document.querySelector<HTMLElement>('#notification')!.hidden = true;
}
function showArrowMenu(index: number, x: number, y: number) {
  selected = index;
  useAnnotationStyle(arrows[index]!);
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
  if (!finishText()) return;
  cancelDrag(); finishWetInk();
  const request = ++opening;
  try {
    const loaded = /\.markboxy$/i.test(file.name) ? await readProject(file) : null;
    const next = loaded ? loaded.background : await loadImage(file);
    if (request !== opening) return;
    if (hasUnsavedChanges() && !await askConfirmation('取代目前文件？', '開啟或貼上圖片會取代目前文件，尚有未儲存的編輯。', '取代後仍可使用「復原」還原目前內容。', '取代文件', 'folder')) return;
    if (request !== opening) return;
    cancelDrag(); closeMenus();
    const before = snapshot();
    undo.length = 0; redo.length = 0;
    background = next; width = loaded?.project.width ?? next!.width; height = loaded?.project.height ?? next!.height; arrows = loaded?.project.annotations ?? []; crop = loaded?.project.crop ?? null; cropDraft = null; resizeScale = null; resizeInput = null; document.querySelector<HTMLElement>('#crop-bar')!.hidden = true; selected = null; fit = true;
    name.value = loaded?.project.name ?? (file.name.replace(/\.[^.]+$/, '').slice(0, 100) || '空白');
    name.style.width = `${Math.min(240, Math.max(28, name.value.length * 12))}px`;
    layout(); commit(before); refresh(); canvas.focus();
    changed = !loaded;
    if (loaded) savedState = snapshot();
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
    if (resizeScale !== null) { if (button.dataset.zoom !== 'fit') setResizeScale(Number(button.dataset.zoom)); closeMenus(); return; }
    fit = button.dataset.zoom === 'fit';
    if (!fit) zoom = Number(button.dataset.zoom);
    closeMenus();
    layout();
  });
}
function setFormat(value: typeof format) {
  format = value; exportFormat.value = value;
  document.querySelector('#format')!.innerHTML = `.${value === 'jpeg' ? 'jpg' : 'png'}<svg class="chevron" aria-hidden="true"><use href="#i-chevron"/></svg>`;
  document.querySelector('#quality-label')!.toggleAttribute('hidden', value !== 'jpeg');
  for (const b of document.querySelectorAll<HTMLButtonElement>('[data-format]')) {
    b.setAttribute('aria-pressed', String(b.dataset.format === value));
  }
  document.querySelector('#export .png-file b')!.textContent = value === 'jpeg' ? 'JPG' : 'PNG';
  document.querySelector('#export')!.setAttribute('aria-label', `匯出 ${value === 'jpeg' ? 'JPEG' : 'PNG'}；拖出 PNG`);
  document.querySelector('#export')!.setAttribute('title', '點一下匯出所選格式；拖出固定使用 PNG');
  document.querySelector('#share')!.setAttribute('aria-label', '匯出圖片');
  document.querySelector('#share')!.setAttribute('title', `匯出 ${value === 'jpeg' ? 'JPG' : 'PNG'}…`);
}
for (const b of document.querySelectorAll<HTMLButtonElement>('[data-format]')) b.addEventListener('click', () => { setFormat(b.dataset.format as typeof format); closeMenus(); });
exportFormat.addEventListener('change', () => setFormat(exportFormat.value as typeof format));
function exportPNG() {
  if (!finishText()) throw new Error('請先完成文字編輯。');
  finishWetInk();
  if (cropDraft) throw new Error('請先套用或取消裁切／縮放。');
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
  if (!finishText()) throw new Error('請先完成文字編輯。');
  finishWetInk();
  if (cropDraft) throw new Error('請先套用或取消裁切／縮放。');
  const output = document.createElement('canvas'); output.width = view().width; output.height = view().height; drawScene(output);
  const quality = Number(document.querySelector<HTMLInputElement>('#quality')!.value) / 100;
  return new Promise<Blob>((resolve, reject) => output.toBlob(blob => blob ? resolve(blob) : reject(new Error('瀏覽器無法編碼圖片，可能超過此裝置的畫布尺寸或記憶體限制。')), `image/${outputFormat}`, quality));
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
  return dialog.open || clearDialog.open || (target instanceof Element && !!target.closest('input,textarea,select,[contenteditable]:not([contenteditable="false"])'));
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
  if (!finishText()) return;
  finishWetInk();
  if (cropDraft) { notice('請先套用或取消裁切／縮放，再儲存文件。'); return; }
  const project: Project = { format: 'markboxy', version: 2, name: name.value, width, height, crop, annotations: arrows, background: background && { src: background.src, x: background.x, y: background.y, width: background.width, height: background.height } };
  const blob = new Blob([JSON.stringify(project)], { type: 'application/json' });
  const savedRevision = revision;
  const savingState = snapshot();
  try {
    if (desktop) {
      if (await nativeSave(blob, filename(name.value, 'markboxy'))) { savedState = savingState; if (savedRevision === revision) changed = false; notice('可編輯文件已儲存。'); }
    } else { offerDownload(blob, filename(name.value, 'markboxy')); notice('已開始下載可編輯文件；請確認下載完成後再關閉，避免遺失編輯。'); }
  } catch (error) { notice(`儲存失敗：${String(error)} 原文件仍保留。`); }
}
document.querySelector('#save-project')!.addEventListener('click', saveProject);
function showExport() {
  cancelDrag();
  closeMenus();
  if (cropDraft) { notice('請先套用或取消裁切／縮放，再匯出。'); return; }
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
  // Native editing shortcuts keep canvas focus; only Tab navigation needs the outer focus ring.
  if (event.key === 'Tab') canvas.dataset.tabFocus = '';
  else if (document.activeElement === canvas) delete canvas.dataset.tabFocus;
  if (dialog.open || clearDialog.open || event.isComposing) return;
  if (event.key === 'Escape') {
    if (drag) cancelDrag();
    else if (cropDraft) finishCrop(false);
    else { selected = null; setPanel(null); closeMenus(); refresh(); canvas.focus(); }
    event.preventDefault();
    return;
  }
  const command = event.metaKey || event.ctrlKey;
  if ((event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement || event.target instanceof HTMLSelectElement) && !(command && ['s', 'o', 'e'].includes(event.key.toLowerCase()))) return;
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
  if (hasUnsavedChanges() && !desktop) { event.preventDefault(); event.returnValue = ''; }
});
function maximumResizeScale() {
  // ponytail: the native device-dependent cap is not fully recovered; use its observed 190% ceiling plus our existing 50 MP memory bound.
  return Math.min(1.9, Math.sqrt(50_000_000 / (width * height)));
}
function setResizeScale(value: number) {
  if (resizeScale === null || !Number.isFinite(value)) return;
  resizeScale = Math.max(.1, Math.min(maximumResizeScale(), value));
  resizeInput = null;
  const area = crop ?? { width, height };
  for (const side of ['width', 'height'] as const) document.querySelector<HTMLInputElement>(`#crop-${side}`)!.value = String(Math.max(1, Math.floor(area[side] * resizeScale)));
  const slider = document.querySelector<HTMLInputElement>('#resize-scale')!;
  slider.max = String(maximumResizeScale()); slider.value = String(resizeScale);
  slider.setAttribute('aria-valuetext', `${Math.round(resizeScale * 100)}%`);
  layout();
  workspace.scrollLeft = Math.max(0, (workspace.scrollWidth - workspace.clientWidth) / 2);
  workspace.scrollTop = Math.max(0, (workspace.scrollHeight - workspace.clientHeight) / 2);
}
function readResizeSize() {
  const area = crop ?? { width, height };
  resizeInput ??= (['width', 'height'] as const).find(side => Number(document.querySelector<HTMLInputElement>(`#crop-${side}`)!.value) !== Math.max(1, Math.floor(area[side] * resizeScale!))) ?? null;
  if (!resizeInput) return true;
  const value = Number(document.querySelector<HTMLInputElement>(`#crop-${resizeInput}`)!.value);
  const factor = value / area[resizeInput];
  if (!Number.isInteger(value) || value < 1 || factor < .1 || factor > maximumResizeScale() + 1e-10) {
    notice(`縮放尺寸須為原尺寸 10%～${Math.floor(maximumResizeScale() * 100)}% 範圍內的正整數。`); return false;
  }
  setResizeScale(factor); return true;
}
function switchCropMode(resize: boolean) {
  if (!cropDraft) return;
  cropDrag = null; resizeInput = null;
  cropDraft = { ...(crop ?? { x: 0, y: 0, width, height }) };
  resizeScale = resize ? 1 : null;
  if (resize) setResizeScale(1);
  else { fit = true; layout(); updateCrop(); }
  canvas.focus();
}
document.querySelector('#crop-mode-switch')!.addEventListener('click', () => switchCropMode(resizeScale === null));
document.querySelector('#choose-crop')!.addEventListener('click', () => switchCropMode(false));
document.querySelector('#choose-resize')!.addEventListener('click', () => switchCropMode(true));
document.querySelector<HTMLInputElement>('#resize-scale')!.addEventListener('input', event => setResizeScale(Number((event.target as HTMLInputElement).value)));
for (const [id, step] of [['resize-decrease', -.1], ['resize-increase', .1]] as const) document.querySelector(`#${id}`)!.addEventListener('click', () => setResizeScale((resizeScale ?? 1) + step));
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
  if (apply) {
    if (resizeScale !== null) {
      try { ({ width, height, background, arrows, crop } = resizeScene(snapshot(), resizeScale)); }
      catch (error) { notice(String(error)); return; }
    } else crop = { ...cropDraft };
  }
  if (resizeScale !== null) fit = true;
  resizeScale = null; resizeInput = null;
  cropDraft = null; cropDrag = null;
  document.querySelector<HTMLElement>('#crop-bar')!.hidden = true;
  document.querySelector('#crop-tool')!.setAttribute('aria-pressed', 'false');
  commit(before); layout(); canvas.focus();
}
document.querySelector('#crop-tool')!.addEventListener('click', () => {
  cancelDrag();
  if (!finishText()) return;
  finishWetInk(); closeMenus(); setPanel(null); selected = null;
  resizeScale = null; resizeInput = null;
  cropDraft = { ...(crop ?? { x: 0, y: 0, width, height }) };
  document.querySelector<HTMLElement>('#crop-bar')!.hidden = false;
  document.querySelector('#crop-tool')!.setAttribute('aria-pressed', 'true');
  fit = true; layout(); updateCrop(); canvas.focus();
});
document.querySelector('#crop-cancel')!.addEventListener('click', () => finishCrop(false));
function readCropSize() {
  if (!cropDraft) return false;
  if (resizeScale !== null) return readResizeSize();
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
  document.querySelector<HTMLInputElement>(`#crop-${side}`)!.addEventListener('change', () => { if (readCropSize()) { if (resizeScale === null) updateCrop(); } });
  document.querySelector<HTMLInputElement>(`#crop-${side}`)!.addEventListener('blur', () => { if (resizeScale !== null) readResizeSize(); });
  document.querySelector<HTMLInputElement>(`#crop-${side}`)!.addEventListener('input', () => { if (resizeScale !== null) resizeInput = side; });
}
canvas.addEventListener('pointerdown', event => {
  if (!cropDraft || resizeScale !== null || event.button !== 0 || !event.isPrimary) return;
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
canvas.addEventListener('lostpointercapture', event => {
  if (cropDrag?.id !== event.pointerId) return;
  if (event.pointerType === 'mouse' && event.buttons === 0) cropDrag = null;
  else cancelCropDrag();
});
window.addEventListener('blur', cancelCropDrag);

let space = false;
let pan: { id: number; x: number; y: number; left: number; top: number } | null = null;
document.addEventListener('keydown', event => {
  if (event.code === 'Space' && !event.ctrlKey && !event.metaKey && !event.altKey && document.activeElement === canvas) { space = true; event.preventDefault(); canvas.style.cursor = 'grab'; }
  if (event.key === 'Enter' && cropDraft && document.activeElement === canvas) { event.preventDefault(); if (readCropSize()) finishCrop(true); }
});
document.addEventListener('keyup', event => { if (event.code === 'Space') { space = false; canvas.style.cursor = 'var(--tool-cursor)'; } });
window.addEventListener('blur', () => { space = false; pan = null; });
canvas.addEventListener('pointerdown', event => {
  if ((cropDraft && resizeScale === null) || (!space && event.button !== 1)) return;
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
  const screenButton = document.querySelector<HTMLButtonElement>('#capture-screen')!;
  captureButton.disabled = screenButton.disabled = false;
  async function capture(fullScreen = false) {
    if (dialog.open || clearDialog.open || cropDraft) { notice('請先關閉對話視窗或完成裁切／縮放，再進行截圖。'); return; }
    closeMenus();
    try { const file = await nativeCapture(fullScreen); if (file) await openFile(file); }
    catch (error) { notice(String(error)); }
  }
  captureButton.addEventListener('click', () => void capture());
  screenButton.addEventListener('click', () => void capture(true));
  void desktopEvents(() => void capture(), async () => !hasUnsavedChanges() || await askConfirmation('關閉這份文件？', '尚有未儲存的編輯，關閉後將無法還原。', '若要保留目前內容，請先取消並儲存文件。', '關閉文件', 'close')).catch(error => notice(`無法連接桌面事件：${String(error)}`));
}
layout();
