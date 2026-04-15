use std::path::{Path, PathBuf};
use std::sync::Mutex;

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, RunEvent};

#[derive(Default)]
struct PendingOpenPaths {
    paths: Mutex<Vec<String>>,
}

#[derive(Serialize)]
struct MacSecurityStatus {
    supported: bool,
    allowed: bool,
    quarantined: bool,
    translocated: bool,
    note: Option<String>,
}

#[tauri::command]
fn list_images(dir: String) -> Result<Vec<String>, String> {
    let path = Path::new(&dir);
    if !path.is_dir() {
        return Err("Not a directory".into());
    }

    let mut images = Vec::new();
    let entries = std::fs::read_dir(path).map_err(|e| e.to_string())?;

    for entry in entries.flatten() {
        let p = entry.path();
        if p.is_file() {
            if let Some(ext) = p.extension() {
                let ext = ext.to_string_lossy().to_lowercase();
                if matches!(
                    ext.as_str(),
                    "jpg" | "jpeg" | "png" | "gif" | "bmp" | "webp" | "avif" | "heic" | "heif" | "tif" | "tiff"
                ) {
                    images.push(p.to_string_lossy().into_owned());
                }
            }
        }
    }

    images.sort();
    Ok(images)
}

#[tauri::command]
fn is_dir(path: String) -> bool {
    Path::new(&path).is_dir()
}

#[tauri::command]
fn save_image(path: String, data: Vec<u8>) -> Result<(), String> {
    std::fs::write(&path, data).map_err(|e| e.to_string())
}

fn encode_indexed_png_bytes(data: &[u8], width: u32, height: u32) -> Result<Vec<u8>, String> {
    let pixel_count = (width as usize)
        .checked_mul(height as usize)
        .ok_or_else(|| "image dimensions overflow".to_string())?;
    let expected_len = pixel_count
        .checked_mul(4)
        .ok_or_else(|| "image buffer size overflow".to_string())?;

    if data.len() != expected_len {
        return Err("invalid RGBA buffer length".into());
    }

    let mut palette: Vec<[u8; 4]> = Vec::new();
    let mut indices = Vec::with_capacity(pixel_count);

    for rgba in data.chunks_exact(4) {
        let color = [rgba[0], rgba[1], rgba[2], rgba[3]];
        let idx = if let Some(existing_idx) = palette.iter().position(|c| *c == color) {
            existing_idx
        } else {
            if palette.len() >= 256 {
                return Err("indexed PNG palette exceeds 256 colors".into());
            }
            palette.push(color);
            palette.len() - 1
        };
        indices.push(idx as u8);
    }

    let mut palette_rgb = Vec::with_capacity(palette.len() * 3);
    let mut transparency = Vec::with_capacity(palette.len());
    let mut has_transparency = false;

    for color in &palette {
        palette_rgb.extend_from_slice(&[color[0], color[1], color[2]]);
        transparency.push(color[3]);
        if color[3] < 255 {
            has_transparency = true;
        }
    }

    let mut out = Vec::new();
    {
        let mut encoder = png::Encoder::new(&mut out, width, height);
        encoder.set_color(png::ColorType::Indexed);
        encoder.set_depth(png::BitDepth::Eight);
        encoder.set_palette(palette_rgb);
        if has_transparency {
            encoder.set_trns(transparency);
        }

        let mut writer = encoder.write_header().map_err(|e| e.to_string())?;
        writer.write_image_data(&indices).map_err(|e| e.to_string())?;
    }

    Ok(out)
}

#[tauri::command]
fn encode_indexed_png(data: Vec<u8>, width: u32, height: u32) -> Result<Vec<u8>, String> {
    encode_indexed_png_bytes(&data, width, height)
}

#[tauri::command]
fn read_image(path: String) -> Result<Vec<u8>, String> {
    std::fs::read(&path).map_err(|e| e.to_string())
}

#[tauri::command]
fn copy_image_to_clipboard(path: String) -> Result<(), String> {
    log::info!("copy_image_to_clipboard called with path: {}", path);

    let img = image::open(&path).map_err(|e| {
        log::error!("Failed to open image {}: {}", path, e);
        e.to_string()
    })?;

    log::info!("Image opened: {}x{}", img.width(), img.height());

    // Convert to RGBA
    let rgba = img.to_rgba8();
    let (width, height) = rgba.dimensions();
    let raw_bytes: Vec<u8> = rgba.into_raw();

    log::info!("Converted to RGBA: {}x{}, {} bytes", width, height, raw_bytes.len());

    let image_data = arboard::ImageData {
        width: width as usize,
        height: height as usize,
        bytes: raw_bytes.into(),
    };

    let mut clipboard = arboard::Clipboard::new().map_err(|e| {
        log::error!("Failed to create clipboard: {}", e);
        e.to_string()
    })?;

    clipboard.set_image(image_data).map_err(|e| {
        log::error!("Failed to set image on clipboard: {}", e);
        e.to_string()
    })?;

    log::info!("Successfully copied image to clipboard");
    Ok(())
}

#[tauri::command]
fn take_pending_open_paths(state: tauri::State<'_, PendingOpenPaths>) -> Vec<String> {
    let mut guard = state.paths.lock().expect("pending paths mutex poisoned");
    std::mem::take(&mut *guard)
}

#[cfg(target_os = "macos")]
fn app_bundle_path() -> Option<PathBuf> {
    let exe = std::env::current_exe().ok()?;
    exe.ancestors()
        .find(|p| p.extension().and_then(|e| e.to_str()) == Some("app"))
        .map(Path::to_path_buf)
}

#[cfg(target_os = "macos")]
fn run_cmd_ok(cmd: &str, args: &[&str]) -> bool {
    std::process::Command::new(cmd)
        .args(args)
        .status()
        .map(|status| status.success())
        .unwrap_or(false)
}

#[tauri::command]
fn check_macos_security_status() -> MacSecurityStatus {
    #[cfg(target_os = "macos")]
    {
        let Some(bundle) = app_bundle_path() else {
            return MacSecurityStatus {
                supported: true,
                allowed: true,
                quarantined: false,
                translocated: false,
                note: Some("cannot resolve app bundle path".into()),
            };
        };

        let bundle_str = bundle.to_string_lossy().to_string();
        let allowed = run_cmd_ok("spctl", &["--assess", "--type", "execute", "--verbose", &bundle_str]);
        let quarantined = run_cmd_ok("xattr", &["-p", "com.apple.quarantine", &bundle_str]);
        let translocated = bundle_str.contains("/AppTranslocation/");

        return MacSecurityStatus {
            supported: true,
            allowed,
            quarantined,
            translocated,
            note: None,
        };
    }

    #[cfg(not(target_os = "macos"))]
    {
        MacSecurityStatus {
            supported: false,
            allowed: true,
            quarantined: false,
            translocated: false,
            note: Some("non-macos platform".into()),
        }
    }
}

#[tauri::command]
fn open_macos_security_settings() -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg("x-apple.systempreferences:com.apple.preference.security?General")
            .status()
            .map_err(|e| e.to_string())?;
        return Ok(());
    }

    #[cfg(not(target_os = "macos"))]
    {
        Err("only available on macOS".into())
    }
}

fn collect_startup_file_paths() -> Vec<String> {
    let mut out = Vec::new();
    for arg in std::env::args().skip(1) {
        let p = PathBuf::from(&arg);
        if p.exists() {
            out.push(arg);
        }
    }
    out
}

fn collect_opened_urls(urls: &[tauri::Url]) -> Vec<String> {
    let mut out = Vec::new();
    for url in urls {
        if let Ok(path) = url.to_file_path() {
            out.push(path.to_string_lossy().to_string());
        }
    }
    out
}

fn push_pending_paths(app: &AppHandle, paths: Vec<String>) {
    if paths.is_empty() {
        return;
    }

    let state = app.state::<PendingOpenPaths>();
    {
        let mut guard = state.paths.lock().expect("pending paths mutex poisoned");
        guard.extend(paths.clone());
    }

    let _ = app.emit("open-paths", paths);
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = tauri::Builder::default()
        .manage(PendingOpenPaths::default())
        .plugin(tauri_plugin_log::Builder::default().level(log::LevelFilter::Info).build())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .setup(|app| {
            push_pending_paths(app.handle(), collect_startup_file_paths());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            list_images,
            is_dir,
            save_image,
            encode_indexed_png,
            read_image,
            copy_image_to_clipboard,
            take_pending_open_paths,
            check_macos_security_status,
            open_macos_security_settings
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application");

    app.run(|app, event| {
        #[cfg(any(target_os = "macos", target_os = "ios"))]
        if let RunEvent::Opened { urls } = event {
            push_pending_paths(app, collect_opened_urls(&urls));
        }
    });
}

#[cfg(test)]
mod tests {
    use super::encode_indexed_png_bytes;
    use png::ColorType;
    use std::io::Cursor;

    #[test]
    fn encodes_indexed_png_with_palette() {
        let width = 2;
        let height = 2;
        let data = vec![
            255, 0, 0, 255, // red
            0, 255, 0, 255, // green
            0, 0, 255, 255, // blue
            255, 0, 0, 255, // red again
        ];

        let png_bytes = encode_indexed_png_bytes(&data, width, height).expect("encode should succeed");

        let decoder = png::Decoder::new(Cursor::new(png_bytes));
        let reader = decoder.read_info().expect("png info should be readable");
        assert_eq!(reader.info().color_type, ColorType::Indexed);
        assert!(reader.info().palette.is_some());
    }
}
