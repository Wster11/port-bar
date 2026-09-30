//! Resolves a process to the icon of the `.app` bundle it runs from.
//! Bare CLI binaries (node, postgres, …) have no bundle and yield `None`,
//! so the frontend falls back to a letter avatar instead of the generic
//! "Unix executable" icon.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};

use base64::{engine::general_purpose::STANDARD as BASE64, Engine};

/// Rendered edge length; the avatar is 30pt, so this stays sharp on Retina.
const ICON_PX: isize = 64;

/// Keyed by bundle path: helpers of one app (e.g. Cursor Helper) share an entry.
static CACHE: OnceLock<Mutex<HashMap<PathBuf, Option<String>>>> = OnceLock::new();

/// Returns a `data:image/png;base64,…` URL, or `None` if the process is not
/// part of an app bundle. Blocking: call from a blocking thread.
pub fn icon_for_pid(pid: i32) -> Option<String> {
    let bundle = app_bundle_of(&executable_path(pid)?)?;

    let cache = CACHE.get_or_init(Default::default);
    if let Some(hit) = cache.lock().unwrap_or_else(|e| e.into_inner()).get(&bundle) {
        return hit.clone();
    }

    let icon = render_png(&bundle).map(|png| format!("data:image/png;base64,{}", BASE64.encode(png)));
    cache
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .insert(bundle, icon.clone());
    icon
}

/// Outermost `*.app` ancestor, so nested helper bundles map to the main app:
/// `/Applications/Cursor.app/Contents/Frameworks/Cursor Helper.app/…` → `Cursor.app`.
fn app_bundle_of(executable: &Path) -> Option<PathBuf> {
    let mut bundle = PathBuf::new();
    for component in executable.components() {
        bundle.push(component);
        if bundle.extension().is_some_and(|ext| ext == "app") {
            return Some(bundle);
        }
    }
    None
}

#[cfg(target_os = "macos")]
fn executable_path(pid: i32) -> Option<PathBuf> {
    let mut buf = vec![0u8; libc::PROC_PIDPATHINFO_MAXSIZE as usize];
    // SAFETY: `buf` is valid for `buf.len()` bytes and outlives the call.
    let len = unsafe { libc::proc_pidpath(pid, buf.as_mut_ptr().cast(), buf.len() as u32) };
    if len <= 0 {
        return None;
    }
    buf.truncate(len as usize);
    String::from_utf8(buf).ok().map(PathBuf::from)
}

#[cfg(target_os = "macos")]
fn render_png(bundle: &Path) -> Option<Vec<u8>> {
    use objc2::{rc::autoreleasepool, AllocAnyThread};
    use objc2_app_kit::{
        NSBitmapImageFileType, NSBitmapImageRep, NSCompositingOperation, NSDeviceRGBColorSpace,
        NSGraphicsContext, NSWorkspace,
    };
    use objc2_foundation::{NSDictionary, NSPoint, NSRect, NSSize, NSString};

    // Background threads have no ambient pool; drain AppKit temporaries here.
    autoreleasepool(|_| {
        let image = NSWorkspace::sharedWorkspace().iconForFile(&NSString::from_str(bundle.to_str()?));

        // SAFETY: null planes make AppKit allocate the buffer; the remaining
        // arguments describe a non-planar 8-bit RGBA bitmap. The color space
        // name is an immutable AppKit constant.
        let rep = unsafe {
            NSBitmapImageRep::initWithBitmapDataPlanes_pixelsWide_pixelsHigh_bitsPerSample_samplesPerPixel_hasAlpha_isPlanar_colorSpaceName_bytesPerRow_bitsPerPixel(
                NSBitmapImageRep::alloc(),
                std::ptr::null_mut(),
                ICON_PX,
                ICON_PX,
                8,
                4,
                true,
                false,
                NSDeviceRGBColorSpace,
                0,
                0,
            )
        }?;

        // Draw into our own bitmap context instead of TIFFRepresentation, which
        // would encode every size up to 1024px.
        let ctx = NSGraphicsContext::graphicsContextWithBitmapImageRep(&rep)?;
        NSGraphicsContext::saveGraphicsState_class();
        NSGraphicsContext::setCurrentContext(Some(&ctx));
        let side = ICON_PX as f64;
        image.drawInRect_fromRect_operation_fraction(
            NSRect::new(NSPoint::new(0.0, 0.0), NSSize::new(side, side)),
            NSRect::ZERO,
            NSCompositingOperation::Copy,
            1.0,
        );
        NSGraphicsContext::restoreGraphicsState_class();

        // SAFETY: an empty properties dictionary is valid for PNG encoding.
        let png = unsafe {
            rep.representationUsingType_properties(NSBitmapImageFileType::PNG, &NSDictionary::new())
        }?;
        Some(png.to_vec())
    })
}

#[cfg(not(target_os = "macos"))]
fn executable_path(_pid: i32) -> Option<PathBuf> {
    None
}

#[cfg(not(target_os = "macos"))]
fn render_png(_bundle: &Path) -> Option<Vec<u8>> {
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn finds_outermost_bundle() {
        let exe = Path::new(
            "/Applications/Cursor.app/Contents/Frameworks/Cursor Helper (Plugin).app/Contents/MacOS/Cursor Helper (Plugin)",
        );
        assert_eq!(app_bundle_of(exe), Some(PathBuf::from("/Applications/Cursor.app")));
    }

    #[test]
    fn cli_binaries_have_no_bundle() {
        assert_eq!(app_bundle_of(Path::new("/opt/homebrew/bin/node")), None);
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn renders_a_png_for_finder() {
        let png = render_png(Path::new("/System/Library/CoreServices/Finder.app")).expect("icon");
        assert_eq!(&png[..8], b"\x89PNG\r\n\x1a\n");
    }
}
