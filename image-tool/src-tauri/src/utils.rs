use exif::{In, Reader, Tag};
use image::{DynamicImage, image_dimensions};
use std::fs::File;
use std::io::BufReader;

pub fn load_image(path: &str) -> Result<DynamicImage, String> {
  let image = image::open(path).map_err(|e| format!("无法加载图片: {}", e))?;
  let orientation = read_exif_orientation(path).unwrap_or(1);
  Ok(apply_exif_orientation(image, orientation))
}

pub fn read_image_dimensions(path: &str) -> Result<(u32, u32), String> {
  image_dimensions(path).map_err(|e| format!("无法读取图片尺寸: {}", e))
}

fn read_exif_orientation(path: &str) -> Option<u32> {
  let file = File::open(path).ok()?;
  let mut reader = BufReader::new(file);
  let exif = Reader::new().read_from_container(&mut reader).ok()?;
  exif
    .get_field(Tag::Orientation, In::PRIMARY)
    .and_then(|field| field.value.get_uint(0))
}

fn apply_exif_orientation(image: DynamicImage, orientation: u32) -> DynamicImage {
  match orientation {
    2 => image.fliph(),
    3 => image.rotate180(),
    4 => image.flipv(),
    5 => image.rotate90().fliph(),
    6 => image.rotate90(),
    7 => image.rotate270().fliph(),
    8 => image.rotate270(),
    _ => image,
  }
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn orientation_6_rotates_image_clockwise() {
    let img = DynamicImage::ImageRgb8(image::RgbImage::new(3, 2));
    let rotated = apply_exif_orientation(img, 6);
    assert_eq!(rotated.width(), 2);
    assert_eq!(rotated.height(), 3);
  }

  #[test]
  fn orientation_2_flips_image_horizontally() {
    let img = DynamicImage::ImageRgb8(image::RgbImage::new(4, 2));
    let flipped = apply_exif_orientation(img, 2);
    assert_eq!(flipped.width(), 4);
    assert_eq!(flipped.height(), 2);
  }
}
