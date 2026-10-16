import { invoke, isTauri } from '@tauri-apps/api/core';
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow';
export const desktop = isTauri();
type OpenedFile = { name: string; data: string };
function decode(file: OpenedFile) {
  const bytes = Uint8Array.from(atob(file.data), c => c.charCodeAt(0));
  return new File([bytes], file.name);
}
export async function nativeOpen() { const file = await invoke<OpenedFile | null>('open_document'); return file && decode(file); }
export async function nativeCapture(fullScreen = false) { const file = await invoke<OpenedFile | null>(fullScreen ? 'capture_screen' : 'capture_region'); return file && decode(file); }
export async function nativeSave(blob: Blob, name: string) {
  const data = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader(); reader.onload = () => resolve(String(reader.result).split(',')[1]!); reader.onerror = () => reject(new Error('無法讀取輸出資料。')); reader.readAsDataURL(blob);
  });
  return invoke<boolean>('save_document', { name, data });
}
export function askDiscard(message: string): Promise<boolean> { return desktop ? invoke('confirm_discard', { message }) : Promise.resolve(confirm(message)); }
export async function desktopEvents(capture: () => void, close: () => Promise<boolean>) {
  const window = getCurrentWebviewWindow();
  await window.listen('capture-requested', capture);
  let closing = false;
  await window.listen('editor-close-requested', async () => {
    if (closing) return;
    closing = true;
    try {
      if (await close()) await invoke('close_editor');
      else await invoke('cancel_quit');
    } catch (error) { await invoke('cancel_quit'); throw error; }
    finally { closing = false; }
  });
}
