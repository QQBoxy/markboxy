use base64::{engine::general_purpose::STANDARD, Engine};
use std::{fs, io::Cursor, path::{Path, PathBuf}, sync::Mutex, time::{Duration, SystemTime, UNIX_EPOCH}};
use tauri::{ipc::Channel, Manager};

static PREPARING: Mutex<()> = Mutex::new(());
const MAX_IMAGE: usize = 84 * 1024 * 1024;
const MAX_CACHE: u64 = 512 * 1024 * 1024;
const RETENTION: Duration = Duration::from_secs(24 * 60 * 60);

fn decode_image(name: &str, data: &str) -> Result<Vec<u8>, String> {
    let stem = name.split('.').next().unwrap_or("").to_ascii_uppercase();
    let reserved = ["CON", "PRN", "AUX", "NUL"].contains(&stem.as_str()) || (stem.len() == 4 && (stem.starts_with("COM") || stem.starts_with("LPT")) && matches!(stem.as_bytes()[3], b'1'..=b'9'));
    if name.is_empty() || name.len() > 200 || reserved || name.contains(['/', '\\', ':', '<', '>', '"', '|', '?', '*']) || name.chars().any(char::is_control) || name.ends_with([' ', '.']) {
        return Err("拖出檔名無效。".into());
    }
    if data.len() > MAX_IMAGE * 4 / 3 + 4 { return Err("拖出圖片超過 84 MiB，請使用點擊匯出。".into()); }
    let bytes = STANDARD.decode(data).map_err(|_| "拖出圖片編碼無效。")?;
    let valid = match Path::new(name).extension().and_then(|v| v.to_str()) {
        Some("png") => bytes.starts_with(b"\x89PNG\r\n\x1a\n"),
        Some("jpg") => bytes.starts_with(&[0xff, 0xd8, 0xff]) && bytes.ends_with(&[0xff, 0xd9]),
        _ => false,
    };
    if !valid || bytes.len() > MAX_IMAGE { return Err("拖出圖片與副檔名不符。".into()); }
    Ok(bytes)
}

fn decode_preview(data: &str) -> Result<Vec<u8>, String> {
    if data.len() > 256 * 1024 { return Err("拖出預覽過大。".into()); }
    let bytes = STANDARD.decode(data).map_err(|_| "拖出預覽編碼無效。")?;
    let mut decoder = png::Decoder::new(Cursor::new(&bytes));
    decoder.set_limits(png::Limits { bytes: 1024 * 1024 });
    let mut reader = decoder.read_info().map_err(|_| "拖出預覽不是有效 PNG。")?;
    if reader.info().width == 0 || reader.info().height == 0 || reader.info().width > 160 || reader.info().height > 160 {
        return Err("拖出預覽尺寸無效。".into());
    }
    let size = reader.output_buffer_size().ok_or("拖出預覽尺寸無效。")?;
    reader.next_frame(&mut vec![0; size]).map_err(|_| "拖出預覽資料損壞。")?;
    Ok(bytes)
}

fn clean_cache(root: &Path, now: SystemTime) -> std::io::Result<u64> {
    let mut size = 0;
    for entry in fs::read_dir(root)? {
        let entry = entry?;
        if !entry.file_name().to_string_lossy().starts_with("drag-") || !entry.file_type()?.is_dir() { continue; }
        if now.duration_since(entry.metadata()?.modified()?).unwrap_or_default() >= RETENTION {
            fs::remove_dir_all(entry.path())?;
        } else {
            for file in fs::read_dir(entry.path())? { size += file?.metadata()?.len(); }
        }
    }
    Ok(size)
}

fn prepare(root: &Path, name: &str, bytes: &[u8]) -> Result<PathBuf, String> {
    let _lock = PREPARING.lock().map_err(|_| "拖出暫存工作中斷。")?;
    let result = (|| -> std::io::Result<PathBuf> {
        fs::create_dir_all(root)?;
        let now = SystemTime::now();
        // ponytail: retain exports for 24h for delayed readers; cap disk use at 512 MiB.
        // Add receiver-specific lifetime management only if this bounded cache is insufficient.
        if clean_cache(root, now)? + bytes.len() as u64 > MAX_CACHE {
            return Err(std::io::Error::other("拖出暫存空間已滿，請使用點擊匯出；過期暫存會於下次拖出清理。"));
        }
        let stamp = now.duration_since(UNIX_EPOCH).map_err(std::io::Error::other)?.as_nanos();
        let directory = root.join(format!("drag-{}-{stamp}", std::process::id()));
        let mut builder = fs::DirBuilder::new();
        #[cfg(unix)] { use std::os::unix::fs::DirBuilderExt; builder.mode(0o700); }
        builder.create(&directory)?;
        let path = directory.join(name);
        if let Err(error) = super::atomic_write(&path, bytes) { let _ = fs::remove_dir_all(directory); return Err(std::io::Error::other(error)); }
        Ok(path)
    })();
    result.map_err(|error| format!("無法準備拖出圖片：{error}"))
}

#[cfg(target_os = "macos")]
fn left_mouse_down() -> bool { objc2_app_kit::NSEvent::pressedMouseButtons() & 1 != 0 }
#[cfg(target_os = "windows")]
fn left_mouse_down() -> bool {
    #[link(name = "user32")]
    extern "system" { fn GetAsyncKeyState(key: i32) -> i16; fn GetSystemMetrics(index: i32) -> i32; }
    // Only the current physical state; ignore the low bit's historical presses.
    unsafe { GetAsyncKeyState(if GetSystemMetrics(23) != 0 { 2 } else { 1 }) < 0 }
}

#[tauri::command]
pub async fn start_image_drag(app: tauri::AppHandle, window: tauri::WebviewWindow, name: String, data: String, preview: String, on_end: Channel<bool>) -> Result<bool, String> {
    let root = app.path().app_cache_dir().map_err(|_| "無法取得拖出暫存位置。")?.join("drag-out");
    let (path, preview) = tauri::async_runtime::spawn_blocking(move || {
        let bytes = decode_image(&name, &data)?;
        let preview = decode_preview(&preview)?;
        Ok::<_, String>((prepare(&root, &name, &bytes)?, preview))
    }).await.map_err(|_| "準備拖出圖片的工作中斷。")??;
    let (tx, rx) = std::sync::mpsc::channel();
    let cleanup = path.parent().unwrap().to_path_buf();
    app.run_on_main_thread(move || {
        // Encoding and IPC may finish after mouse-up. Never start a stale drag session.
        let result = if !left_mouse_down() { Ok(false) } else {
            let cancelled = cleanup.clone();
            drag::start_drag(&window, drag::DragItem::Files(vec![path]), drag::Image::Raw(preview), move |result, _| {
                if matches!(result, drag::DragResult::Cancel) { let _ = fs::remove_dir_all(&cancelled); }
                let _ = on_end.send(matches!(result, drag::DragResult::Dropped));
            }, drag::Options::default()).map(|_| true).map_err(|error| format!("無法開始拖出：{error}"))
        };
        if !matches!(result, Ok(true)) { let _ = fs::remove_dir_all(cleanup); }
        let _ = tx.send(result);
    }).map_err(|_| "無法啟動原生拖曳。")?;
    tauri::async_runtime::spawn_blocking(move || rx.recv()).await.map_err(|_| "拖出工作中斷。")?.map_err(|_| "拖出視窗已關閉。")?
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn rejects_paths_bad_formats_and_corrupt_previews() {
        let png = STANDARD.encode(b"\x89PNG\r\n\x1a\n");
        for name in ["../x.png", "x/y.png", "x\\y.png", "x:evil.png", "x.png\0", "x.png.", "x.jpg", "x.exe", "CON.png", "com1.png", "x?.png"] {
            assert!(decode_image(name, &png).is_err(), "{name}");
        }
        assert!(decode_image("x.png", "invalid").is_err());
        assert!(decode_preview(&png).is_err());
        let mut bytes = Vec::new();
        { let mut encoder = png::Encoder::new(&mut bytes, 2, 1); encoder.set_color(png::ColorType::Rgb); encoder.write_header().unwrap().write_image_data(&[255, 0, 0, 0, 0, 255]).unwrap(); }
        assert_eq!(decode_preview(&STANDARD.encode(&bytes)).unwrap(), bytes);
        let mut large = Vec::new();
        { let mut encoder = png::Encoder::new(&mut large, 161, 1); encoder.set_color(png::ColorType::Rgb); encoder.write_header().unwrap().write_image_data(&vec![0; 161 * 3]).unwrap(); }
        assert!(decode_preview(&STANDARD.encode(large)).is_err());
    }
    #[test]
    fn snapshots_do_not_overwrite_and_cleanup_preserves_recent_files() {
        let root = std::env::temp_dir().join(format!("markboxy-drag-test-{}", std::process::id()));
        let a = prepare(&root, "same.png", b"first").unwrap();
        let b = prepare(&root, "same.png", b"second").unwrap();
        assert_ne!(a, b); assert_eq!(fs::read(&a).unwrap(), b"first");
        assert_eq!(clean_cache(&root, SystemTime::now()).unwrap(), 11);
        assert!(a.exists() && b.exists());
        assert_eq!(clean_cache(&root, SystemTime::now() + RETENTION + Duration::from_secs(1)).unwrap(), 0);
        assert!(!a.exists() && !b.exists()); fs::remove_dir_all(root).unwrap();
    }
}
