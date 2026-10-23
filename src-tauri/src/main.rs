#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
use base64::{engine::general_purpose::STANDARD, Engine};
use serde::Serialize;
use std::{fs, io::Write, path::Path, sync::{Mutex, atomic::{AtomicBool, AtomicU64, Ordering}}, time::{SystemTime, UNIX_EPOCH}};
use tauri::{Emitter, Manager};
use tauri_plugin_dialog::DialogExt;
static ALLOW_EXIT: AtomicBool = AtomicBool::new(false);
static QUIT_WINDOWS: Mutex<Option<Vec<String>>> = Mutex::new(None);
static LAST_WINDOW: Mutex<Option<String>> = Mutex::new(None);
static NEXT_WINDOW: AtomicU64 = AtomicU64::new(1);
static CAPTURING: AtomicBool = AtomicBool::new(false);

#[derive(Serialize)]
struct OpenedFile { name: String, data: String }
fn file_data(path: &Path, max: u64) -> Result<OpenedFile, String> {
    let file = fs::File::open(path).map_err(|_| "無法開啟檔案。")?;
    if file.metadata().map_err(|_| "無法讀取檔案資訊。")?.len() > max { return Err("檔案超過大小上限。".into()); }
    // Limit the actual read too: another program could grow the file after metadata inspection.
    use std::io::Read;
    let mut bytes = Vec::new(); file.take(max + 1).read_to_end(&mut bytes).map_err(|_| "無法讀取檔案。")?;
    if bytes.len() as u64 > max { return Err("檔案超過大小上限。".into()); }
    Ok(OpenedFile { name: path.file_name().unwrap_or_default().to_string_lossy().into(), data: STANDARD.encode(bytes) })
}
#[tauri::command]
async fn open_document(app: tauri::AppHandle, window: tauri::WebviewWindow) -> Result<Option<OpenedFile>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let selected = app.dialog().file().set_parent(&window).add_filter("圖片與 Markboxy 文件", &["png", "jpg", "jpeg", "markboxy"]).blocking_pick_file();
        selected.map(|p| p.into_path().map_err(|_| "不支援此檔案位置。".to_string()).and_then(|p| file_data(&p, 30 * 1024 * 1024))).transpose()
    }).await.map_err(|_| "開檔工作中斷。".to_string())?
}
fn atomic_write(path: &Path, bytes: &[u8]) -> Result<(), String> {
    let parent = path.parent().ok_or("儲存位置無效。")?;
    let stamp = SystemTime::now().duration_since(UNIX_EPOCH).map_err(|_| "系統時間無效。")?.as_nanos();
    let temp = parent.join(format!(".markboxy-{}-{stamp}.tmp", std::process::id()));
    let result = (|| {
        let mut options = fs::OpenOptions::new(); options.write(true).create_new(true);
        #[cfg(unix)] { use std::os::unix::fs::OpenOptionsExt; options.mode(0o600); }
        let mut file = options.open(&temp)?;
        if let Ok(metadata) = fs::metadata(path) { file.set_permissions(metadata.permissions())?; }
        file.write_all(bytes)?; file.sync_all()?; drop(file);
        fs::rename(&temp, path)
    })();
    if result.is_err() { let _ = fs::remove_file(&temp); }
    result.map_err(|_| "儲存失敗，原文件及編輯狀態仍保留。請確認磁碟空間與寫入權限。".into())
}
#[tauri::command]
async fn save_document(app: tauri::AppHandle, window: tauri::WebviewWindow, name: String, data: String) -> Result<bool, String> {
    if data.len() > 112 * 1024 * 1024 || name.len() > 500 || name.contains(['/', '\\', '\0']) { return Err("儲存資料無效或過大。".into()); }
    let extension = Path::new(&name).extension().and_then(|v| v.to_str()).unwrap_or("").to_owned();
    if !["png", "jpg", "markboxy"].contains(&extension.as_str()) { return Err("不支援此副檔名。".into()); }
    let bytes = STANDARD.decode(data).map_err(|_| "儲存資料編碼無效。")?;
    tauri::async_runtime::spawn_blocking(move || {
        let selected = app.dialog().file().set_parent(&window).add_filter("Markboxy", &[extension.as_str()]).set_file_name(&name).blocking_save_file();
        if let Some(p) = selected {
            let mut path = p.into_path().map_err(|_| "不支援此檔案位置。")?;
            if path.extension().is_none() { path.set_extension(&extension); }
            if !path.extension().and_then(|v| v.to_str()).is_some_and(|v| v.eq_ignore_ascii_case(&extension)) { return Err(format!("請使用 .{extension} 副檔名，原檔未更動。")); }
            atomic_write(&path, &bytes)?; return Ok(true);
        }
        Ok(false)
    }).await.map_err(|_| "存檔工作中斷。".to_string())?
}
// Quit checks one document at a time; cancelling leaves the remaining windows open.
fn next_quit_window(app: &tauri::AppHandle) {
    loop {
        let label = {
            let mut queue = QUIT_WINDOWS.lock().unwrap();
            let Some(labels) = queue.as_mut() else { return; };
            labels.pop()
        };
        match label {
            Some(label) if app.get_webview_window(&label).is_some() => {
                let _ = app.emit_to(label.as_str(), "editor-close-requested", ()); return;
            }
            Some(_) => continue,
            None => { ALLOW_EXIT.store(true, Ordering::SeqCst); app.exit(0); return; }
        }
    }
}
fn request_quit(app: &tauri::AppHandle) {
    {
        let mut queue = QUIT_WINDOWS.lock().unwrap();
        if queue.is_some() { return; }
        *queue = Some(app.webview_windows().keys().cloned().collect());
    }
    next_quit_window(app);
}
#[tauri::command]
fn cancel_quit() { *QUIT_WINDOWS.lock().unwrap() = None; }
#[tauri::command]
fn close_editor(app: tauri::AppHandle, window: tauri::WebviewWindow) -> Result<(), String> {
    let quitting = QUIT_WINDOWS.lock().unwrap().is_some();
    if !quitting && app.webview_windows().len() == 1 {
        ALLOW_EXIT.store(true, Ordering::SeqCst); app.exit(0); return Ok(());
    }
    window.destroy().map_err(|_| "無法關閉視窗，編輯仍保留。")?;
    if quitting { next_quit_window(&app); }
    Ok(())
}
fn new_editor(app: &tauri::AppHandle) -> tauri::Result<()> {
    if QUIT_WINDOWS.lock().unwrap().is_some() { return Ok(()); }
    let mut config = app.config().app.windows[0].clone();
    config.label = format!("editor-{}", NEXT_WINDOW.fetch_add(1, Ordering::SeqCst));
    tauri::WebviewWindowBuilder::from_config(app, &config)?.build()?;
    Ok(())
}

#[tauri::command]
async fn capture_region(window: tauri::WebviewWindow) -> Result<Option<OpenedFile>, String> {
    capture(window, false).await
}
#[tauri::command]
async fn capture_screen(window: tauri::WebviewWindow) -> Result<Option<OpenedFile>, String> {
    capture(window, true).await
}
async fn capture(window: tauri::WebviewWindow, full_screen: bool) -> Result<Option<OpenedFile>, String> {
    if CAPTURING.swap(true, Ordering::SeqCst) { return Err("正在截圖，請先完成或取消。".into()); }
    let result = tauri::async_runtime::spawn_blocking(move || {
        let stamp = SystemTime::now().duration_since(UNIX_EPOCH).map_err(|_| "系統時間無效。")?.as_nanos();
        let dir = std::env::temp_dir().join(format!("markboxy-capture-{}-{stamp}", std::process::id()));
        let mut builder = fs::DirBuilder::new();
        #[cfg(unix)] { use std::os::unix::fs::DirBuilderExt; builder.mode(0o700); }
        builder.create(&dir).map_err(|_| "無法建立私有截圖暫存目錄。")?;
        let path = dir.join("截圖.png");
        let result = (|| {
            window.hide().map_err(|_| "無法隱藏編輯器。")?;
            // Allow the compositor to remove the editor before an immediate full-screen capture.
            if full_screen { std::thread::sleep(std::time::Duration::from_millis(200)); }
            // ponytail: full-screen captures the primary display; add a display picker only when requested.
            // Native macOS capture owns display scaling and screen-recording permission UI.
            #[cfg(target_os = "macos")]
            let captured = std::process::Command::new("/usr/sbin/screencapture").args(if full_screen { ["-m", "-x", "-t", "png"] } else { ["-i", "-x", "-t", "png"] }).arg(&path).output();
            #[cfg(target_os = "windows")]
            let captured = capture_windows(&path, full_screen);
            #[cfg(not(any(target_os = "macos", target_os = "windows")))]
            let captured: std::io::Result<std::process::Output> = Err(std::io::Error::new(std::io::ErrorKind::Unsupported, "unsupported"));
            match captured {
                Ok(output) if output.status.success() && path.exists() => file_data(&path, 20 * 1024 * 1024).map(Some),
                Ok(output) if !full_screen && (output.status.success() || output.status.code() == Some(1)) && output.stderr.is_empty() && !path.exists() => Ok(None),
                Ok(output) => {
                    let detail = String::from_utf8_lossy(&output.stderr).trim().chars().take(300).collect::<String>();
                    Err(format!("截圖失敗。請確認系統螢幕擷取權限與可用的主螢幕，或先以系統工具截圖再匯入。{}", if detail.is_empty() { String::new() } else { format!("\n系統訊息：{detail}") }))
                }
                Err(_) => Err("無法啟動系統截圖工具。請先以系統工具截圖再匯入。".into()),
            }
        })();
        let _ = window.show(); let _ = window.set_focus();
        let _ = fs::remove_dir_all(&dir); result
    }).await.map_err(|_| "截圖工作中斷。".to_string()).and_then(|r| r);
    CAPTURING.store(false, Ordering::SeqCst); result
}
#[cfg(target_os = "windows")]
fn capture_windows(path: &Path, full_screen: bool) -> std::io::Result<std::process::Output> {
    use std::os::windows::process::CommandExt;
    // Keep the native script within our private temporary directory. Do not bypass execution policy.
    let script = path.with_extension("ps1");
    fs::write(&script, include_str!("capture-windows.ps1"))?;
    let mut command = std::process::Command::new("powershell.exe");
    command
        .args(["-NoLogo", "-NoProfile", "-STA", "-NonInteractive", "-File"])
        .arg(&script).arg("-OutputPath").arg(path).creation_flags(0x08000000);
    if full_screen { command.arg("-FullScreen"); }
    let result = command.output();
    let _ = fs::remove_file(script); result
}
fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().with_handler(|app, _, event| {
            if event.state == tauri_plugin_global_shortcut::ShortcutState::Pressed {
                let windows = app.webview_windows();
                let last = LAST_WINDOW.lock().unwrap().clone();
                if let Some(window) = windows.values().find(|w| w.is_focused().unwrap_or(false))
                    .or_else(|| last.as_ref().and_then(|label| windows.get(label)))
                    .or_else(|| windows.values().next()) {
                    let _ = app.emit_to(window.label(), "capture-requested", ());
                }
            }
        }).build())
        .setup(|app| {
            use tauri_plugin_global_shortcut::GlobalShortcutExt;
            // The default Cocoa Quit item calls terminate: directly, bypassing ExitRequested.
            // In Tauri's native macOS/Windows default menu, the first submenu ends with Quit.
            #[cfg(any(target_os = "macos", target_os = "windows"))]
            {
                use tauri::menu::{Menu, MenuItem};
                let menu = Menu::default(app.handle())?;
                if let Some(submenu) = menu.items()?.first().and_then(|item| item.as_submenu()) {
                    submenu.remove_at(submenu.items()?.len() - 1)?;
                    submenu.append(&MenuItem::with_id(app, "quit-safe", "Quit Markboxy", true, Some("CmdOrCtrl+Q"))?)?;
                }
                let file_index = if cfg!(target_os = "macos") { 1 } else { 0 };
                if let Some(file) = menu.items()?.get(file_index).and_then(|item| item.as_submenu()) {
                    file.insert(&MenuItem::with_id(app, "new-window", "新視窗", true, Some("CmdOrCtrl+N"))?, 0)?;
                }
                app.set_menu(menu)?;
            }
            // Registration failure must not prevent opening or saving existing work.
            if let Err(e) = app.global_shortcut().register("Control+Shift+2") { eprintln!("Capture shortcut unavailable: {e}"); }
            Ok(())
        })
        .on_menu_event(|app, event| {
            match event.id().as_ref() {
                "quit-safe" => request_quit(app),
                "new-window" => if let Err(error) = new_editor(app) {
                    app.dialog().message(format!("無法開啟新視窗：{error}")).title("Markboxy").show(|_| {});
                },
                _ => {}
            }
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::Focused(true) = event { *LAST_WINDOW.lock().unwrap() = Some(window.label().to_owned()); }
            if let tauri::WindowEvent::CloseRequested { api, .. } = event { api.prevent_close(); let _ = window.app_handle().emit_to(window.label(), "editor-close-requested", ()); }
        })
        .invoke_handler(tauri::generate_handler![open_document, save_document, close_editor, cancel_quit, capture_region, capture_screen])
        .build(tauri::generate_context!()).expect("無法啟動 Markboxy")
        .run(|app, event| {
            if let tauri::RunEvent::ExitRequested { api, .. } = event {
                if !ALLOW_EXIT.load(Ordering::SeqCst) { api.prevent_exit(); request_quit(app); }
            }
        });
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn atomic_save_replaces_complete_content() {
        let dir = std::env::temp_dir().join(format!("markboxy-save-test-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap(); let path = dir.join("test.markboxy");
        fs::write(&path, b"old").unwrap(); atomic_write(&path, b"new complete file").unwrap();
        assert_eq!(fs::read(&path).unwrap(), b"new complete file");
        assert!(atomic_write(&dir.join("missing").join("test"), b"bad").is_err());
        assert_eq!(fs::read(&path).unwrap(), b"new complete file");
        fs::remove_dir_all(dir).unwrap();
    }
}
