use crate::utils::{load_image, read_image_dimensions};
use base64::Engine;
use image::codecs::png::{CompressionType as PngCompressionType, FilterType as PngFilterType, PngEncoder};
use image::{ColorType, DynamicImage, GenericImageView, ImageEncoder, imageops};
use imagequant::{new as new_imagequant, RGBA as ImageQuantRgba};
use png::{BitDepth, ColorType as PngColorType, Encoder as PngPaletteEncoder};
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::fs;
use std::io::Cursor;
use std::path::{Path, PathBuf};
use std::time::Instant;
use tauri::{AppHandle, Emitter};

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CompressionQuality {
    pub percent: u8,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProcessingOptions {
    pub convert_format: Option<String>,
    pub resize_mode: Option<String>,
    pub resize_width: Option<u32>,
    pub resize_height: Option<u32>,
    pub resize_scale: Option<f32>,
    pub compression_type: Option<String>,
    pub compression_preset: Option<String>,
    pub compression_quality: Option<CompressionQuality>,
    pub target_ratio: Option<f32>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProcessResult {
    pub success: bool,
    pub output_path: String,
    pub original_size: u64,
    pub output_size: u64,
    pub message: String,
    pub steps: Vec<String>,
    pub duration_ms: u128,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImageFileInfo {
    pub path: String,
    pub file_name: String,
    pub size: u64,
    pub width: u32,
    pub height: u32,
    pub preview_data_url: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BatchProcessResult {
    pub success: bool,
    pub total_files: usize,
    pub success_count: usize,
    pub failure_count: usize,
    pub total_original_size: u64,
    pub total_output_size: u64,
    pub output_dir: Option<String>,
    pub message: String,
    pub failures: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ProcessingStageEvent {
    input_path: String,
    stage: String,
    elapsed_ms: u128,
}

#[derive(Debug, Clone, PartialEq, Eq)]
enum CompressionPlan {
    Default,
    QualityPercent(u8),
    TargetSizeBytes(u64),
}

const MAX_TOTAL_PIXELS: u64 = 80_000_000;
const PNG_EXPENSIVE_PROCESSING_LIMIT: u64 = 24_000_000;

fn calculate_resize_dimensions(
    mode: &str,
    orig_width: u32,
    orig_height: u32,
    resize_width: Option<u32>,
    resize_height: Option<u32>,
    resize_scale: Option<f32>,
) -> (u32, u32) {
    match mode {
        "scale" => {
            let scale = resize_scale.unwrap_or(50.0) / 100.0;
            let nw = (orig_width as f32 * scale) as u32;
            let nh = (orig_height as f32 * scale) as u32;
            (nw.max(1), nh.max(1))
        }
        "width" => {
            let width = resize_width.unwrap_or(orig_width);
            let aspect_ratio = orig_height as f32 / orig_width as f32;
            let height = (width as f32 * aspect_ratio) as u32;
            (width, height.max(1))
        }
        "height" => {
            let height = resize_height.unwrap_or(orig_height);
            let aspect_ratio = orig_width as f32 / orig_height as f32;
            let width = (height as f32 * aspect_ratio) as u32;
            (width.max(1), height)
        }
        "dimensions" => match (resize_width, resize_height) {
            (Some(width), Some(height)) => (width.max(1), height.max(1)),
            (Some(width), None) => {
                let aspect_ratio = orig_height as f32 / orig_width as f32;
                let height = (width as f32 * aspect_ratio) as u32;
                (width.max(1), height.max(1))
            }
            (None, Some(height)) => {
                let aspect_ratio = orig_width as f32 / orig_height as f32;
                let width = (height as f32 * aspect_ratio) as u32;
                (width.max(1), height.max(1))
            }
            (None, None) => (orig_width, orig_height),
        },
        _ => (orig_width, orig_height),
    }
}

fn build_output_path(
    input_path: &Path,
    output_dir: Option<&String>,
    output_format: &str,
) -> Result<PathBuf, String> {
    let file_stem = input_path
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("output");
    let ext_with_dot = if output_format.is_empty() {
        String::new()
    } else {
        format!(".{}", output_format)
    };

    let base_dir = if let Some(dir) = output_dir {
        PathBuf::from(dir)
    } else {
        input_path
            .parent()
            .map(Path::to_path_buf)
            .unwrap_or_else(|| PathBuf::from("."))
    };

    let preferred = base_dir.join(format!("{file_stem}{ext_with_dot}"));
    if !preferred.exists() {
        return Ok(preferred);
    }

    let mut attempt = 1u32;
    loop {
        let candidate = base_dir.join(format!("{file_stem} ({attempt}){ext_with_dot}"));
        if !candidate.exists() {
            return Ok(candidate);
        }
        attempt += 1;
    }
}

fn resolve_compression_plan(
    output_format: &str,
    options: &ProcessingOptions,
    original_size: u64,
) -> Result<CompressionPlan, String> {
    if matches!(options.compression_type.as_deref(), Some("preset")) {
        return match options.compression_preset.as_deref().unwrap_or("standard") {
            "standard" => match output_format {
                "png" => Ok(CompressionPlan::QualityPercent(80)),
                "jpg" | "jpeg" => Ok(CompressionPlan::QualityPercent(
                    estimate_jpeg_quality("standard", original_size)
                )),
                _ => Ok(CompressionPlan::Default),
            },
            "strong" => match output_format {
                "png" => Ok(CompressionPlan::QualityPercent(50)),
                "jpg" | "jpeg" => Ok(CompressionPlan::QualityPercent(
                    estimate_jpeg_quality("strong", original_size)
                )),
                _ => Ok(CompressionPlan::Default),
            },
            other => Err(format!("不支持的压缩预设: {other}")),
        };
    }

    match options.compression_type.as_deref().unwrap_or("none") {
        "none" => Ok(CompressionPlan::Default),
        "quality" => Ok(CompressionPlan::QualityPercent(
            options
                .compression_quality
                .as_ref()
                .map(|q| q.percent.clamp(1, 100))
                .unwrap_or(85),
        )),
        "targetSize" => {
            let target_ratio = options
                .target_ratio
                .ok_or_else(|| "目标比例不能为空".to_string())?;
            if !(0.0..1.0).contains(&target_ratio) {
                return Err("目标比例必须大于 0 且小于 1".to_string());
            }
            let target_bytes = (original_size as f32 * target_ratio).floor() as u64;
            if target_bytes == 0 {
                return Err("目标比例过小，换算后的目标大小不能为 0".to_string());
            }
            match output_format {
                "png" | "jpg" | "jpeg" => Ok(CompressionPlan::TargetSizeBytes(target_bytes)),
                _ => Err(format!("{output_format} 当前不支持目标比例压缩")),
            }
        }
        other => Err(format!("不支持的压缩类型: {other}")),
    }
}

fn estimate_jpeg_quality(preset: &str, original_size: u64) -> u8 {
    match preset {
        "standard" => {
            if original_size < 400_000 {
                86
            } else if original_size < 1_000_000 {
                82
            } else if original_size < 2_000_000 {
                78
            } else if original_size < 5_000_000 {
                74
            } else {
                70
            }
        }
        "strong" => {
            if original_size < 2_000_000 {
                50
            } else {
                let ratio = (1_000_000f64 / original_size as f64).clamp(0.1, 1.0);
                let estimated = (78.0 * ratio.powf(0.6)).round() as i32;
                estimated.clamp(30, 60) as u8
            }
        }
        _ => 80,
    }
}

fn compression_ratio_hint(target_bytes: u64, original_size: u64) -> f64 {
    if original_size == 0 {
        return 1.0;
    }

    (target_bytes as f64 / original_size as f64).clamp(0.08, 1.0)
}

fn single_pass_jpeg_quality_for_target(target_bytes: u64, original_size: u64) -> u8 {
    let ratio = compression_ratio_hint(target_bytes, original_size);
    let base_quality = if target_bytes <= 600 * 1024 {
        44i32
    } else if target_bytes <= 1200 * 1024 {
        56
    } else {
        68
    };

    let adjustment = if ratio <= 0.18 {
        -14
    } else if ratio <= 0.3 {
        -10
    } else if ratio <= 0.45 {
        -6
    } else if ratio <= 0.7 {
        0
    } else {
        6
    };

    (base_quality + adjustment).clamp(26, 82) as u8
}

fn encode_jpeg_bytes(img: &DynamicImage, quality: u8) -> Result<Vec<u8>, String> {
    let rgb_img = img.to_rgb8();
    let mut bytes = Vec::new();
    let encoder = image::codecs::jpeg::JpegEncoder::new_with_quality(&mut bytes, quality.clamp(1, 100));
    rgb_img
        .write_with_encoder(encoder)
        .map_err(|e| format!("JPEG 编码失败: {}", e))?;
    Ok(bytes)
}

fn encode_png_bytes(img: &DynamicImage, compression: PngCompressionType) -> Result<Vec<u8>, String> {
    let rgba_img = img.to_rgba8();
    let mut bytes = Vec::new();
    let encoder = PngEncoder::new_with_quality(&mut bytes, compression, PngFilterType::Adaptive);
    let has_alpha = rgba_img.as_raw().chunks_exact(4).any(|pixel| pixel[3] < 255);
    if has_alpha {
        encoder
            .write_image(
                rgba_img.as_raw(),
                rgba_img.width(),
                rgba_img.height(),
                ColorType::Rgba8.into(),
            )
            .map_err(|e| format!("保存 PNG 失败: {}", e))?;
    } else {
        let rgb = img.to_rgb8();
        encoder
            .write_image(
                rgb.as_raw(),
                rgb.width(),
                rgb.height(),
                ColorType::Rgb8.into(),
            )
            .map_err(|e| format!("保存 PNG 失败: {}", e))?;
    }
    Ok(bytes)
}

fn should_keep_original_png(
    original_format: &str,
    output_format: &str,
    did_resize: bool,
    original_size: u64,
    candidate_size: u64,
) -> bool {
    original_format == "png"
        && output_format == "png"
        && !did_resize
        && candidate_size >= original_size
}

fn should_keep_original_jpeg(
    original_format: &str,
    output_format: &str,
    did_resize: bool,
    original_size: u64,
    candidate_size: u64,
) -> bool {
    matches!(original_format, "jpg" | "jpeg")
        && matches!(output_format, "jpg" | "jpeg")
        && !did_resize
        && candidate_size >= original_size
}

#[derive(Clone, Copy)]
struct PngCandidate {
    max_colors: usize,
    quality: u8,
    speed: i32,
}

fn png_candidate_for_preset(preset: &str) -> PngCandidate {
    match preset {
        "strong" => PngCandidate { max_colors: 96, quality: 55, speed: 10 },
        _ => PngCandidate { max_colors: 256, quality: 82, speed: 10 },
    }
}

fn png_candidate_for_target(target_bytes: u64, original_size: u64) -> PngCandidate {
    let ratio = compression_ratio_hint(target_bytes, original_size);

    if target_bytes <= 600 * 1024 {
        if ratio <= 0.18 {
            PngCandidate { max_colors: 48, quality: 35, speed: 10 }
        } else {
            PngCandidate { max_colors: 64, quality: 42, speed: 10 }
        }
    } else if target_bytes <= 1200 * 1024 {
        if ratio <= 0.35 {
            PngCandidate { max_colors: 96, quality: 50, speed: 10 }
        } else {
            PngCandidate { max_colors: 128, quality: 60, speed: 10 }
        }
    } else if ratio <= 0.45 {
        PngCandidate { max_colors: 160, quality: 64, speed: 10 }
    } else {
        PngCandidate { max_colors: 256, quality: 72, speed: 10 }
    }
}

fn png_image_within_palette_limit(img: &DynamicImage, max_colors: usize) -> bool {
    let rgba_img = img.to_rgba8();
    let mut colors = HashSet::new();

    for pixel in rgba_img.as_raw().chunks_exact(4) {
        colors.insert([pixel[0], pixel[1], pixel[2], pixel[3]]);
        if colors.len() > max_colors {
            return false;
        }
    }

    true
}

fn should_skip_png_reprocessing(
    original_format: &str,
    did_resize: bool,
    img: &DynamicImage,
    preset: &str,
) -> bool {
    if original_format != "png" || did_resize {
        return false;
    }

    let candidate = png_candidate_for_preset(preset);
    png_image_within_palette_limit(img, candidate.max_colors)
}

fn encode_png_smart_bytes(img: &DynamicImage, candidate: PngCandidate) -> Result<Vec<u8>, String> {
    let rgba_img = img.to_rgba8();
    let color_count = candidate.max_colors.clamp(16, 256);
    let raw = rgba_img.as_raw();
    let pixels: Vec<ImageQuantRgba> = raw
        .chunks_exact(4)
        .map(|chunk| ImageQuantRgba {
            r: chunk[0],
            g: chunk[1],
            b: chunk[2],
            a: chunk[3],
        })
        .collect();

    let mut attributes = new_imagequant();
    attributes
        .set_speed(candidate.speed)
        .map_err(|e| format!("imagequant 速度设置失败: {}", e))?;
    attributes
        .set_quality(0, candidate.quality)
        .map_err(|e| format!("imagequant 质量设置失败: {}", e))?;
    attributes
        .set_max_colors(color_count as u32)
        .map_err(|e| format!("imagequant 颜色数设置失败: {}", e))?;

    let mut image = attributes
        .new_image(pixels.into_boxed_slice(), rgba_img.width() as usize, rgba_img.height() as usize, 0.0)
        .map_err(|e| format!("imagequant 创建图像失败: {}", e))?;
    let mut result = attributes
        .quantize(&mut image)
        .map_err(|e| format!("imagequant 量化失败: {}", e))?;
    result.set_dithering_level(0.0).ok();

    let (palette, indexed) = result
        .remapped(&mut image)
        .map_err(|e| format!("imagequant 映射调色板失败: {}", e))?;

    let mut palette_rgb = Vec::with_capacity(palette.len() * 3);
    let mut trns = Vec::with_capacity(palette.len());
    for color in palette {
        palette_rgb.extend_from_slice(&[color.r, color.g, color.b]);
        trns.push(color.a);
    }

    let mut bytes = Cursor::new(Vec::new());
    {
        let mut encoder = PngPaletteEncoder::new(&mut bytes, rgba_img.width(), rgba_img.height());
        encoder.set_color(PngColorType::Indexed);
        encoder.set_depth(BitDepth::Eight);
        encoder.set_palette(palette_rgb);
        if trns.iter().any(|alpha| *alpha < 255) {
            encoder.set_trns(trns);
        }
        encoder.set_compression(png::Compression::Fast);
        encoder.set_filter(png::Filter::Adaptive);

        let mut writer = encoder
            .write_header()
            .map_err(|e| format!("写入 PNG 头失败: {}", e))?;
        writer
            .write_image_data(&indexed)
            .map_err(|e| format!("写入 PNG 数据失败: {}", e))?;
    }

    Ok(bytes.into_inner())
}

fn select_png_candidate_result(
    img: &DynamicImage,
    preset: &str,
) -> Result<(Vec<u8>, PngCandidate), String> {
    let candidate = png_candidate_for_preset(preset);
    let bytes = encode_png_smart_bytes(img, candidate)?;
    Ok((bytes, candidate))
}

fn validate_image_for_processing(path: &str) -> Result<(u32, u32), String> {
    let (width, height) = read_image_dimensions(path)?;
    let total_pixels = width as u64 * height as u64;
    if total_pixels > MAX_TOTAL_PIXELS {
        return Err(format!(
            "图片过大（{}x{}，约 {:.1} MP），请先缩小尺寸后再处理",
            width,
            height,
            total_pixels as f64 / 1_000_000.0
        ));
    }

    Ok((width, height))
}

fn should_limit_expensive_png_processing(width: u32, height: u32) -> bool {
    (width as u64 * height as u64) > PNG_EXPENSIVE_PROCESSING_LIMIT
}

fn write_bytes(output_path: &str, bytes: &[u8]) -> Result<(), String> {
    fs::write(output_path, bytes).map_err(|e| format!("写入文件失败: {}", e))
}

fn is_passthrough_jpeg_extension_swap(
    original_format: &str,
    output_format: &str,
    options: &ProcessingOptions,
) -> bool {
    let no_resize = options
        .resize_mode
        .as_deref()
        .unwrap_or("none") == "none";
    let no_compression = options
        .compression_type
        .as_deref()
        .unwrap_or("none") == "none";
    let jpeg_alias_swap = matches!(
        (original_format, output_format),
        ("jpeg", "jpg") | ("jpg", "jpeg")
    );

    jpeg_alias_swap && no_resize && no_compression
}

fn preview_mime_type(path: &str) -> &'static str {
    match Path::new(path)
        .extension()
        .and_then(|ext| ext.to_str())
        .unwrap_or_default()
        .to_lowercase()
        .as_str()
    {
        "jpg" | "jpeg" => "image/jpeg",
        "png" => "image/png",
        "webp" => "image/webp",
        "gif" => "image/gif",
        "bmp" => "image/bmp",
        "tiff" | "tif" => "image/tiff",
        "avif" => "image/avif",
        _ => "application/octet-stream",
    }
}

fn build_preview_data_url(path: &str, file_size: u64) -> Option<String> {
    const MAX_PREVIEW_BYTES: u64 = 8 * 1024 * 1024;

    if file_size > MAX_PREVIEW_BYTES {
        return None;
    }

    let bytes = fs::read(path).ok()?;
    let encoded = base64::engine::general_purpose::STANDARD.encode(bytes);
    Some(format!("data:{};base64,{}", preview_mime_type(path), encoded))
}

fn emit_processing_stage(
    app_handle: Option<&AppHandle>,
    input_path: &str,
    stage: &str,
    started_at: Instant,
) {
    let event = ProcessingStageEvent {
        input_path: input_path.to_string(),
        stage: stage.to_string(),
        elapsed_ms: started_at.elapsed().as_millis(),
    };

    if let Some(handle) = app_handle {
        let _ = handle.emit("image-processing-stage", &event);
    }

    println!(
        "[image-tool] stage file={} stage={} elapsed_ms={}",
        event.input_path, event.stage, event.elapsed_ms
    );
}

fn save_with_plan(
    img: &DynamicImage,
    output_path: &str,
    output_format: &str,
    original_format: &str,
    compression_plan: &CompressionPlan,
    compression_preset: Option<&str>,
    limit_expensive_png_processing: bool,
    app_handle: Option<&AppHandle>,
    input_path: &str,
    started_at: Instant,
    original_size: u64,
    did_resize: bool,
) -> Result<Option<String>, String> {
    match output_format {
        "jpg" | "jpeg" => {
            emit_processing_stage(app_handle, input_path, "encoding", started_at);
            let bytes = match compression_plan {
                CompressionPlan::Default => encode_jpeg_bytes(img, 85)?,
                CompressionPlan::QualityPercent(percent) => encode_jpeg_bytes(img, *percent)?,
                CompressionPlan::TargetSizeBytes(target) => {
                    let quality = single_pass_jpeg_quality_for_target(*target, original_size);
                    let bytes = encode_jpeg_bytes(img, quality)?;
                    emit_processing_stage(app_handle, input_path, "writing", started_at);
                    write_bytes(output_path, &bytes)?;
                    return Ok(Some(format!(
                        "目标档位 {:.2} MB，单次压缩完成，实际 {:.2} MB，JPEG 质量 {}",
                        *target as f64 / 1_000_000.0,
                        bytes.len() as f64 / 1_000_000.0,
                        quality
                    )));
                }
            };
            if should_keep_original_jpeg(
                original_format,
                output_format,
                did_resize,
                original_size,
                bytes.len() as u64,
            ) {
                emit_processing_stage(app_handle, input_path, "writing", started_at);
                let original_bytes = fs::read(input_path).map_err(|e| format!("读取原始 JPEG 失败: {}", e))?;
                write_bytes(output_path, &original_bytes)?;
                return Ok(Some("压缩后未变小，已保留原图".to_string()));
            }
            emit_processing_stage(app_handle, input_path, "writing", started_at);
            write_bytes(output_path, &bytes)?;
            Ok(None)
        }
        "png" => {
            emit_processing_stage(app_handle, input_path, "encoding", started_at);
            let bytes = match compression_plan {
                CompressionPlan::Default => {
                    encode_png_bytes(img, PngCompressionType::Default)?
                }
                CompressionPlan::QualityPercent(_) => {
                    if matches!(compression_preset, Some("standard" | "strong")) {
                        let preset = compression_preset.unwrap_or("standard");
                        if should_skip_png_reprocessing(original_format, did_resize, img, preset) {
                            emit_processing_stage(app_handle, input_path, "writing", started_at);
                            let original_bytes = fs::read(input_path)
                                .map_err(|e| format!("读取原始 PNG 失败: {}", e))?;
                            write_bytes(output_path, &original_bytes)?;
                            return Ok(Some(format!(
                                "PNG 原图颜色数已不超过 {} 色，已保留原图",
                                png_candidate_for_preset(preset).max_colors
                            )));
                        }
                        let (bytes, _) = select_png_candidate_result(img, preset)?;
                        bytes
                    } else {
                        encode_png_bytes(img, PngCompressionType::Best)?
                    }
                }
                CompressionPlan::TargetSizeBytes(target) => {
                    if limit_expensive_png_processing {
                        let bytes = encode_png_bytes(img, PngCompressionType::Default)?;
                        emit_processing_stage(app_handle, input_path, "writing", started_at);
                        write_bytes(output_path, &bytes)?;
                        return Ok(Some(format!(
                            "图片较大，按目标档位执行单次 PNG 压缩，实际 {:.2} MB",
                            bytes.len() as f64 / 1_000_000.0
                        )));
                    }

                    let candidate = png_candidate_for_target(*target, original_size);
                    if should_skip_png_reprocessing(original_format, did_resize, img, "standard")
                        && candidate.max_colors >= png_candidate_for_preset("standard").max_colors
                    {
                        emit_processing_stage(app_handle, input_path, "writing", started_at);
                        let original_bytes = fs::read(input_path)
                            .map_err(|e| format!("读取原始 PNG 失败: {}", e))?;
                        write_bytes(output_path, &original_bytes)?;
                        return Ok(Some(format!(
                            "目标档位 {:.2} MB，单次压缩判断原图已足够，已保留原图",
                            *target as f64 / 1_000_000.0
                        )));
                    }

                    let bytes = encode_png_smart_bytes(img, candidate)?;
                    emit_processing_stage(app_handle, input_path, "writing", started_at);
                    write_bytes(output_path, &bytes)?;
                    return Ok(Some(format!(
                        "目标档位 {:.2} MB，单次压缩完成，实际 {:.2} MB，约 {} 色",
                        *target as f64 / 1_000_000.0,
                        bytes.len() as f64 / 1_000_000.0,
                        candidate.max_colors
                    )));
                }
            };
            if should_keep_original_png(
                original_format,
                output_format,
                did_resize,
                original_size,
                bytes.len() as u64,
            ) {
                emit_processing_stage(app_handle, input_path, "writing", started_at);
                let original_bytes = fs::read(input_path).map_err(|e| format!("读取原始 PNG 失败: {}", e))?;
                write_bytes(output_path, &original_bytes)?;
                return Ok(Some("压缩后未变小，已保留原图".to_string()));
            }
            emit_processing_stage(app_handle, input_path, "writing", started_at);
            write_bytes(output_path, &bytes)?;
            Ok(None)
        }
        _ => {
            emit_processing_stage(app_handle, input_path, "writing", started_at);
            img.save(output_path)
                .map_err(|e| format!("保存图片失败: {}", e))?;
            Ok(None)
        }
    }
}

fn process_single_image(
    input_path: String,
    options: &ProcessingOptions,
    output_dir: Option<&String>,
    app_handle: Option<&AppHandle>,
) -> Result<ProcessResult, String> {
    let mut steps = Vec::new();
    let mut result = ProcessResult {
        success: false,
        output_path: String::new(),
        original_size: 0,
        output_size: 0,
        message: String::new(),
        steps: Vec::new(),
        duration_ms: 0,
    };
    let total_started_at = Instant::now();
    emit_processing_stage(app_handle, &input_path, "preparing", total_started_at);

    // 获取原始文件大小
    if let Ok(metadata) = fs::metadata(&input_path) {
        result.original_size = metadata.len();
    }

    let (source_width, source_height) = validate_image_for_processing(&input_path)?;
    let limit_expensive_png_processing =
        should_limit_expensive_png_processing(source_width, source_height);

    // 加载图片
    let load_started_at = Instant::now();
    emit_processing_stage(app_handle, &input_path, "loading", total_started_at);
    let mut img = match load_image(&input_path) {
        Ok(i) => i,
        Err(e) => {
            result.message = format!("无法加载图片: {}", e);
            return Err(result.message);
        }
    };
    let load_duration_ms = load_started_at.elapsed().as_millis();

    let input_path_obj = Path::new(&input_path);
    let original_ext = input_path_obj
        .extension()
        .and_then(|s| s.to_str())
        .unwrap_or("png")
        .to_lowercase();

    // 确定输出格式
    let output_format = options
        .convert_format
        .as_ref()
        .map(|f| f.to_lowercase())
        .unwrap_or_else(|| original_ext.clone());

    let output_path_buf = build_output_path(input_path_obj, output_dir, &output_format)?;
    let compression_plan = resolve_compression_plan(&output_format, options, result.original_size)?;

    let output_path_str = output_path_buf.to_str()
        .ok_or_else(|| "路径转换失败".to_string())?;

    if is_passthrough_jpeg_extension_swap(&original_ext, &output_format, options) {
        emit_processing_stage(app_handle, &input_path, "writing", total_started_at);
        let original_bytes = fs::read(&input_path).map_err(|e| format!("读取原始 JPEG 失败: {}", e))?;
        write_bytes(output_path_str, &original_bytes)?;

        if let Ok(metadata) = fs::metadata(output_path_str) {
            result.output_size = metadata.len();
        }

        result.success = true;
        result.output_path = output_path_str.to_string();
        result.duration_ms = total_started_at.elapsed().as_millis();
        result.message = "JPEG/JPG 仅更改扩展名，未重新编码".to_string();
        result.steps = vec!["直接复制文件内容并改为 JPG 扩展名".to_string()];
        emit_processing_stage(app_handle, &input_path, "done", total_started_at);
        return Ok(result);
    }

    // 1. 缩放处理
    let transform_started_at = Instant::now();
    emit_processing_stage(app_handle, &input_path, "transforming", total_started_at);
    let mut did_resize = false;
    if let Some(mode) = &options.resize_mode {
        if mode != "none" {
            steps.push("调整图片尺寸".to_string());

            let (orig_width, orig_height) = img.dimensions();
            let (new_width, new_height) = calculate_resize_dimensions(
                mode,
                orig_width,
                orig_height,
                options.resize_width,
                options.resize_height,
                options.resize_scale,
            );

            img = img.resize(new_width, new_height, imageops::FilterType::Triangle);
            did_resize = new_width != orig_width || new_height != orig_height;
        }
    }
    let transform_duration_ms = transform_started_at.elapsed().as_millis();

    steps.push(format!("保存为 {} 格式", output_format));
    match &compression_plan {
        CompressionPlan::QualityPercent(percent) => {
            if matches!(options.compression_type.as_deref(), Some("preset")) {
                match options.compression_preset.as_deref().unwrap_or("standard") {
                    "standard" => {
                        if output_format == "png" {
                            steps.push("标准压缩：PNG 自适应压缩".to_string());
                        } else {
                            steps.push(format!("标准压缩：JPG 质量 {}%", percent));
                        }
                    }
                    "strong" => {
                        if output_format == "png" {
                            steps.push("强力压缩：PNG 自适应压缩".to_string());
                        } else {
                            steps.push(format!("强力压缩：JPG 质量 {}%", percent));
                        }
                    }
                    _ => {}
                }
            } else {
                steps.push(format!("压缩质量 {}%", percent));
            }
        }
        CompressionPlan::TargetSizeBytes(target) => {
            steps.push(format!(
                "目标输出约为原图的 {:.1}%",
                (*target as f64 / result.original_size.max(1) as f64) * 100.0
            ));
        }
        CompressionPlan::Default => {}
    }
    if output_format == "png" && limit_expensive_png_processing {
        steps.push("图片较大：自动跳过高耗时 PNG 深度压缩以避免长时间卡住".to_string());
    }
    let save_started_at = Instant::now();
    emit_processing_stage(app_handle, &input_path, "saving", total_started_at);
    let save_note = save_with_plan(
        &img,
        output_path_str,
        &output_format,
        &original_ext,
        &compression_plan,
        options.compression_preset.as_deref(),
        limit_expensive_png_processing,
        app_handle,
        &input_path,
        total_started_at,
        result.original_size,
        did_resize,
    )?;
    let save_duration_ms = save_started_at.elapsed().as_millis();
    if let Some(note) = save_note {
        steps.push(note.clone());
        result.message = note;
    }

    // 获取输出文件大小
    if let Ok(metadata) = fs::metadata(&output_path_str) {
        result.output_size = metadata.len();
    }

    // 构建结果
    result.success = true;
    result.output_path = output_path_str.to_string();
    result.duration_ms = total_started_at.elapsed().as_millis();
    if result.message.is_empty() {
        result.message = format!("处理完成，共 {} 个步骤", steps.len());
    }
    result.steps = steps;
    emit_processing_stage(app_handle, &input_path, "done", total_started_at);

    println!(
        "[image-tool] processed file={} dims={}x{} format={} compression={:?} load_ms={} transform_ms={} save_ms={} total_ms={}",
        input_path,
        source_width,
        source_height,
        output_format,
        options.compression_preset,
        load_duration_ms,
        transform_duration_ms,
        save_duration_ms,
        result.duration_ms
    );

    Ok(result)
}

#[tauri::command]
pub async fn inspect_images(input_paths: Vec<String>) -> Result<Vec<ImageFileInfo>, String> {
    input_paths
        .into_iter()
        .map(|path| {
            let metadata = fs::metadata(&path).map_err(|error| format!("读取文件信息失败: {}", error))?;
            let (width, height) = read_image_dimensions(&path)?;
            let file_name = Path::new(&path)
                .file_name()
                .and_then(|name| name.to_str())
                .unwrap_or(&path)
                .to_string();

            Ok(ImageFileInfo {
                path: path.clone(),
                file_name,
                size: metadata.len(),
                width,
                height,
                preview_data_url: build_preview_data_url(&path, metadata.len()),
            })
        })
        .collect()
}

#[tauri::command]
pub async fn process_image(
    app_handle: AppHandle,
    input_path: String,
    options: ProcessingOptions,
    output_dir: Option<String>,
) -> Result<ProcessResult, String> {
    process_single_image(input_path, &options, output_dir.as_ref(), Some(&app_handle))
}

#[tauri::command]
pub async fn process_images(
    input_paths: Vec<String>,
    options: ProcessingOptions,
    output_dir: Option<String>,
) -> Result<BatchProcessResult, String> {
    if input_paths.is_empty() {
        return Err("请至少选择一张图片".to_string());
    }

    let mut success_count = 0usize;
    let mut failure_count = 0usize;
    let mut total_original_size = 0u64;
    let mut total_output_size = 0u64;
    let mut failures = Vec::new();

    for input_path in &input_paths {
        match process_single_image(input_path.clone(), &options, output_dir.as_ref(), None) {
            Ok(result) => {
                success_count += 1;
                total_original_size += result.original_size;
                total_output_size += result.output_size;
            }
            Err(error) => {
                failure_count += 1;
                let filename = Path::new(input_path)
                    .file_name()
                    .and_then(|name| name.to_str())
                    .unwrap_or(input_path);
                failures.push(format!("{}: {}", filename, error));
            }
        }
    }

    let total_files = input_paths.len();
    Ok(BatchProcessResult {
        success: success_count > 0,
        total_files,
        success_count,
        failure_count,
        total_original_size,
        total_output_size,
        output_dir,
        message: format!("已处理 {} 张图片，成功 {}，失败 {}", total_files, success_count, failure_count),
        failures,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn create_test_dir(name: &str) -> PathBuf {
        let unique = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_millis();
        let dir = std::env::temp_dir().join(format!("image-tool-{name}-{unique}"));
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn scale_resize_preserves_aspect_ratio() {
        assert_eq!(
            calculate_resize_dimensions("scale", 1200, 800, None, None, Some(50.0)),
            (600, 400)
        );
    }

    #[test]
    fn width_resize_uses_original_height_for_aspect_ratio() {
        assert_eq!(
            calculate_resize_dimensions("width", 1200, 800, Some(300), None, None),
            (300, 200)
        );
    }

    #[test]
    fn dimensions_resize_uses_exact_width_and_height() {
        assert_eq!(
            calculate_resize_dimensions("dimensions", 1200, 800, Some(640), Some(360), None),
            (640, 360)
        );
    }

    #[test]
    fn dimensions_resize_with_only_width_preserves_aspect_ratio() {
        assert_eq!(
            calculate_resize_dimensions("dimensions", 1200, 800, Some(600), None, None),
            (600, 400)
        );
    }

    #[test]
    fn output_path_avoids_overwriting_input_file() {
        let dir = create_test_dir("overwrite-input");
        let input = dir.join("example.png");
        fs::write(&input, b"source").unwrap();
        let output = build_output_path(&input, None, "png").unwrap();
        let filename = output.file_name().and_then(|name| name.to_str()).unwrap_or("");
        assert_eq!(filename, "example (1).png");
        assert_eq!(output.extension().and_then(|ext| ext.to_str()), Some("png"));
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn build_output_path_keeps_original_name_when_available() {
        let dir = create_test_dir("name-available");
        let input_path = dir.join("photo.jpg");

        let output_path = build_output_path(&input_path, Some(&dir.to_string_lossy().to_string()), "jpg")
            .unwrap();

        assert_eq!(output_path, dir.join("photo.jpg"));

        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn build_output_path_uses_browser_style_suffix_when_name_exists() {
        let dir = create_test_dir("name-conflict");
        let input_path = dir.join("photo.jpg");
        fs::write(&input_path, b"source").unwrap();

        let first_duplicate = build_output_path(&input_path, Some(&dir.to_string_lossy().to_string()), "jpg")
            .unwrap();
        assert_eq!(first_duplicate, dir.join("photo (1).jpg"));

        fs::write(dir.join("photo (1).jpg"), b"duplicate").unwrap();
        let second_duplicate = build_output_path(&input_path, Some(&dir.to_string_lossy().to_string()), "jpg")
            .unwrap();
        assert_eq!(second_duplicate, dir.join("photo (2).jpg"));

        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn rejects_lossless_jpeg_claim() {
        let options = ProcessingOptions {
            convert_format: Some("jpg".to_string()),
            resize_mode: None,
            resize_width: None,
            resize_height: None,
            resize_scale: None,
            compression_type: Some("quality".to_string()),
            compression_preset: None,
            compression_quality: None,
            target_ratio: None,
        };

        let plan = resolve_compression_plan("jpg", &options, 0).unwrap();
        assert_eq!(plan, CompressionPlan::QualityPercent(85));
    }

    #[test]
    fn resolves_target_ratio_to_bytes() {
        let options = ProcessingOptions {
            convert_format: Some("jpg".to_string()),
            resize_mode: None,
            resize_width: None,
            resize_height: None,
            resize_scale: None,
            compression_type: Some("targetSize".to_string()),
            compression_preset: None,
            compression_quality: None,
            target_ratio: Some(0.25),
        };

        let plan = resolve_compression_plan("jpg", &options, 4_000_000).unwrap();
        assert_eq!(plan, CompressionPlan::TargetSizeBytes(1_000_000));
    }

    #[test]
    fn single_pass_target_size_chooses_stronger_jpeg_quality_for_smaller_targets() {
        let small = single_pass_jpeg_quality_for_target(500 * 1024, 3_000_000);
        let medium = single_pass_jpeg_quality_for_target(1024 * 1024, 3_000_000);
        let large = single_pass_jpeg_quality_for_target(2 * 1024 * 1024, 3_000_000);

        assert!(small < medium);
        assert!(medium < large);
    }

    #[test]
    fn rejects_invalid_target_ratio() {
        let options = ProcessingOptions {
            convert_format: Some("png".to_string()),
            resize_mode: None,
            resize_width: None,
            resize_height: None,
            resize_scale: None,
            compression_type: Some("targetSize".to_string()),
            compression_preset: None,
            compression_quality: None,
            target_ratio: Some(0.0),
        };

        let err = resolve_compression_plan("png", &options, 0).unwrap_err();
        assert!(err.contains("目标比例"));
    }

    #[test]
    fn quality_mode_uses_percent_value() {
        let options = ProcessingOptions {
            convert_format: Some("png".to_string()),
            resize_mode: None,
            resize_width: None,
            resize_height: None,
            resize_scale: None,
            compression_type: Some("quality".to_string()),
            compression_preset: None,
            compression_quality: Some(CompressionQuality {
                percent: 42,
            }),
            target_ratio: None,
        };

        let plan = resolve_compression_plan("png", &options, 0).unwrap();
        assert_eq!(plan, CompressionPlan::QualityPercent(42));
    }

    #[test]
    fn jpeg_to_jpg_without_resize_or_compression_uses_passthrough_copy() {
        let options = ProcessingOptions {
            convert_format: Some("jpg".to_string()),
            resize_mode: None,
            resize_width: None,
            resize_height: None,
            resize_scale: None,
            compression_type: Some("none".to_string()),
            compression_preset: None,
            compression_quality: None,
            target_ratio: None,
        };

        assert!(is_passthrough_jpeg_extension_swap("jpeg", "jpg", &options));
        assert!(is_passthrough_jpeg_extension_swap("jpg", "jpeg", &options));
    }

    #[test]
    fn jpeg_to_jpg_with_resize_or_compression_does_not_passthrough() {
        let resize_options = ProcessingOptions {
            convert_format: Some("jpg".to_string()),
            resize_mode: Some("scale".to_string()),
            resize_width: None,
            resize_height: None,
            resize_scale: Some(50.0),
            compression_type: Some("none".to_string()),
            compression_preset: None,
            compression_quality: None,
            target_ratio: None,
        };
        let compression_options = ProcessingOptions {
            convert_format: Some("jpg".to_string()),
            resize_mode: None,
            resize_width: None,
            resize_height: None,
            resize_scale: None,
            compression_type: Some("preset".to_string()),
            compression_preset: Some("standard".to_string()),
            compression_quality: None,
            target_ratio: None,
        };

        assert!(!is_passthrough_jpeg_extension_swap("jpeg", "jpg", &resize_options));
        assert!(!is_passthrough_jpeg_extension_swap("jpeg", "jpg", &compression_options));
        assert!(!is_passthrough_jpeg_extension_swap("png", "jpg", &compression_options));
    }

    #[test]
    fn preset_standard_maps_to_jpg_and_png_defaults() {
        let jpg_options = ProcessingOptions {
            convert_format: Some("jpg".to_string()),
            resize_mode: None,
            resize_width: None,
            resize_height: None,
            resize_scale: None,
            compression_type: Some("preset".to_string()),
            compression_preset: Some("standard".to_string()),
            compression_quality: None,
            target_ratio: None,
        };
        let png_options = ProcessingOptions { ..jpg_options.clone() };

        assert_eq!(resolve_compression_plan("jpg", &jpg_options, 500_000).unwrap(), CompressionPlan::QualityPercent(82));
        assert_eq!(resolve_compression_plan("png", &png_options, 500_000).unwrap(), CompressionPlan::QualityPercent(80));
        assert_eq!(png_candidate_for_preset("standard").max_colors, 256);
    }

    #[test]
    fn preset_strong_uses_single_pass_quality_estimate_for_jpg() {
        let options = ProcessingOptions {
            convert_format: Some("jpg".to_string()),
            resize_mode: None,
            resize_width: None,
            resize_height: None,
            resize_scale: None,
            compression_type: Some("preset".to_string()),
            compression_preset: Some("strong".to_string()),
            compression_quality: None,
            target_ratio: None,
        };

        assert_eq!(resolve_compression_plan("jpg", &options, 1_500_000).unwrap(), CompressionPlan::QualityPercent(50));
        assert_eq!(resolve_compression_plan("jpg", &options, 2_500_000).unwrap(), CompressionPlan::QualityPercent(45));
    }

    #[test]
    fn keeps_original_png_when_quantized_result_is_larger() {
        assert!(should_keep_original_png("png", "png", false, 6_900_000, 7_300_000));
        assert!(!should_keep_original_png("png", "png", true, 6_900_000, 7_300_000));
        assert!(!should_keep_original_png("jpg", "png", false, 6_900_000, 7_300_000));
    }

    #[test]
    fn keeps_original_jpeg_when_reencoded_result_is_larger() {
        assert!(should_keep_original_jpeg("jpg", "jpg", false, 30_100, 41_900));
        assert!(should_keep_original_jpeg("jpeg", "jpg", false, 30_100, 41_900));
        assert!(!should_keep_original_jpeg("jpg", "jpg", true, 30_100, 41_900));
        assert!(!should_keep_original_jpeg("png", "jpg", false, 30_100, 41_900));
    }

    #[test]
    fn smart_png_compression_produces_valid_png() {
        let img = DynamicImage::ImageRgba8(
            image::RgbaImage::from_fn(16, 16, |x, y| {
                if (x + y) % 2 == 0 {
                    image::Rgba([255, 0, 0, 255])
                } else {
                    image::Rgba([0, 0, 255, 180])
                }
            })
        );

        let bytes = encode_png_smart_bytes(&img, PngCandidate {
            max_colors: 16,
            quality: 50,
            speed: 10,
        }).unwrap();
        let decoded = image::load_from_memory_with_format(&bytes, image::ImageFormat::Png).unwrap();
        assert_eq!(decoded.width(), 16);
        assert_eq!(decoded.height(), 16);
    }

    #[test]
    fn skips_png_reprocessing_when_image_already_fits_standard_palette() {
        let many_colors = DynamicImage::ImageRgba8(
            image::RgbaImage::from_fn(128, 1, |x, _| {
                image::Rgba([x as u8, x as u8, x as u8, 255])
            })
        );
        let img = DynamicImage::ImageRgba8(
            image::RgbaImage::from_fn(16, 16, |x, y| {
                if (x + y) % 2 == 0 {
                    image::Rgba([255, 0, 0, 255])
                } else {
                    image::Rgba([0, 255, 0, 255])
                }
            })
        );

        assert!(png_image_within_palette_limit(&img, 256));
        assert!(should_skip_png_reprocessing("png", false, &img, "standard"));
        assert!(!should_skip_png_reprocessing("png", false, &many_colors, "strong"));
        assert!(!should_skip_png_reprocessing("png", true, &img, "standard"));
        assert!(!should_skip_png_reprocessing("jpg", false, &img, "standard"));
    }

    #[test]
    fn detects_when_png_exceeds_palette_limit() {
        let img = DynamicImage::ImageRgba8(
            image::RgbaImage::from_fn(257, 1, |x, _| {
                image::Rgba([x as u8, (x >> 8) as u8, 0, 255])
            })
        );

        assert!(!png_image_within_palette_limit(&img, 256));
    }

    #[test]
    fn rejects_images_that_are_too_large() {
        let err = validate_image_for_processing("/definitely/missing-file.png").unwrap_err();
        assert!(err.contains("无法读取图片尺寸"));
    }

    #[test]
    fn limits_expensive_png_processing_for_large_images() {
        assert!(should_limit_expensive_png_processing(6000, 5000));
        assert!(!should_limit_expensive_png_processing(2000, 2000));
    }
}
