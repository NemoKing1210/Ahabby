//! Native window chrome: the colour of the OS-drawn title bar.
//!
//! `Window::set_theme` only flips the immersive dark mode; it does not decide the caption
//! fill. On Windows 11 that fill comes from the system accent plus a Mica gradient, so the
//! header never matches the app. `DwmSetWindowAttribute` is the only way to pin it.

use crate::error::{AppError, Result};

#[cfg(windows)]
mod imp {
    use std::ffi::c_void;

    use super::caption_colorref;
    use crate::error::Result;

    /// `DWMWA_USE_IMMERSIVE_DARK_MODE` (Windows 10 1809+, build 17763) and the Windows 11
    /// caption colours (build 22000+).
    const DWMWA_USE_IMMERSIVE_DARK_MODE: u32 = 20;
    const DWMWA_CAPTION_COLOR: u32 = 35;
    const DWMWA_TEXT_COLOR: u32 = 36;

    #[link(name = "dwmapi")]
    extern "system" {
        fn DwmSetWindowAttribute(
            hwnd: isize,
            attribute: u32,
            value: *const c_void,
            size: u32,
        ) -> i32;
    }

    fn apply(hwnd: isize, attribute: u32, color: u32) {
        let _ = unsafe {
            DwmSetWindowAttribute(hwnd, attribute, &color as *const u32 as *const c_void, 4)
        };
    }

    pub fn set_window_chrome(hwnd: isize, dark: bool, caption: &str, text: &str) -> Result<()> {
        let caption = caption_colorref(caption)?;
        let text = caption_colorref(text)?;
        // Older Windows rejects attributes it does not know; the chrome then keeps its
        // system look, which is the best that platform offers.
        apply(hwnd, DWMWA_USE_IMMERSIVE_DARK_MODE, u32::from(dark));
        apply(hwnd, DWMWA_CAPTION_COLOR, caption);
        apply(hwnd, DWMWA_TEXT_COLOR, text);
        Ok(())
    }
}

#[cfg(not(windows))]
mod imp {
    use crate::error::Result;

    pub fn set_window_chrome(_hwnd: isize, _dark: bool, _caption: &str, _text: &str) -> Result<()> {
        // macOS and Linux take a system appearance instead, see `commands::settings`.
        Ok(())
    }
}

pub use imp::set_window_chrome;

/// `#rrggbb` (or `rrggbb`) into a Win32 `COLORREF` (`0x00bbggrr`).
///
/// Kept out of the Windows-only module so the parsing is covered on every CI platform.
pub fn caption_colorref(value: &str) -> Result<u32> {
    let hex = value.trim().trim_start_matches('#');
    let rgb = u32::from_str_radix(hex, 16)
        .ok()
        .filter(|_| hex.len() == 6)
        .ok_or_else(|| AppError::InvalidInput(format!("not a #rrggbb colour: {value}")))?;
    let (r, g, b) = ((rgb >> 16) & 0xff, (rgb >> 8) & 0xff, rgb & 0xff);
    Ok((b << 16) | (g << 8) | r)
}

#[cfg(test)]
mod tests {
    use super::caption_colorref;

    #[test]
    fn colorref_is_byte_swapped() {
        // The two tokens the window chrome is fed, straight out of `globals.css`.
        assert_eq!(caption_colorref("#faf9f5").unwrap(), 0x00f5f9fa);
        assert_eq!(caption_colorref("#1f1e1d").unwrap(), 0x001d1e1f);
    }

    #[test]
    fn colorref_accepts_the_forms_a_browser_can_hand_over() {
        assert_eq!(caption_colorref("faf9f5").unwrap(), 0x00f5f9fa);
        assert_eq!(caption_colorref("#FAF9F5").unwrap(), 0x00f5f9fa);
        assert_eq!(caption_colorref("  #faf9f5  ").unwrap(), 0x00f5f9fa);
        assert_eq!(caption_colorref("#000000").unwrap(), 0);
        assert_eq!(caption_colorref("#ffffff").unwrap(), 0x00ffffff);
    }

    #[test]
    fn colorref_refuses_anything_else() {
        for value in [
            "",
            "#",
            "fff",
            "#faf9f",
            "#faf9f55",
            "rgb(1,2,3)",
            "#gggggg",
            "😀",
        ] {
            assert!(
                caption_colorref(value).is_err(),
                "{value} should be refused"
            );
        }
    }
}
