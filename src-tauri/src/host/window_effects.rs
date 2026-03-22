//! # 原生窗口效果模块
//!
//! 为主窗口应用平台原生毛玻璃/材质效果：
//! - Windows：使用可控 RGBA 的 SWCA Acrylic 路径，避免 Windows 11 系统 backdrop 忽略颜色参数
//! - macOS：应用 NSVisualEffectView vibrancy
//! - 其他平台：保持无操作
//!
//! 该模块仅负责窗口层视觉效果，不处理前端透明样式。

use serde::{Deserialize, Serialize};
use tauri::WebviewWindow;

#[cfg(target_os = "windows")]
use raw_window_handle::{HasWindowHandle, RawWindowHandle};

#[cfg(target_os = "macos")]
use raw_window_handle::{HasWindowHandle, RawWindowHandle};

#[cfg(target_os = "windows")]
use std::ffi::c_void;

#[cfg(target_os = "macos")]
use objc2::{msg_send, runtime::AnyObject};

#[cfg(target_os = "windows")]
use windows_sys::Win32::{
    Foundation::{BOOL, FARPROC, HWND},
    Graphics::Dwm::{DwmSetWindowAttribute, DWMWINDOWATTRIBUTE},
    System::LibraryLoader::{GetProcAddress, LoadLibraryA},
};

/// Windows Acrylic 单组颜色参数。
///
/// - `red`：红色通道
/// - `green`：绿色通道
/// - `blue`：蓝色通道
/// - `alpha`：透明度通道
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct WindowsAcrylicColor {
    pub red: u8,
    pub green: u8,
    pub blue: u8,
    pub alpha: u8,
}

impl WindowsAcrylicColor {
    #[cfg(target_os = "windows")]
    fn to_rgba_tuple(&self) -> (u8, u8, u8, u8) {
        (self.red, self.green, self.blue, self.alpha)
    }
}

#[cfg(target_os = "windows")]
fn normalize_windows_acrylic_rgba(color: (u8, u8, u8, u8)) -> (u8, u8, u8, u8) {
    if color.3 == 0 {
        (color.0, color.1, color.2, 1)
    } else {
        color
    }
}

#[cfg(target_os = "windows")]
fn pack_windows_acrylic_gradient_color(color: (u8, u8, u8, u8)) -> u32 {
    let normalized = normalize_windows_acrylic_rgba(color);

    (normalized.0 as u32)
        | ((normalized.1 as u32) << 8)
        | ((normalized.2 as u32) << 16)
        | ((normalized.3 as u32) << 24)
}

/// Windows Acrylic 原生效果参数快照。
///
/// - `enabled`：是否启用原生 Acrylic
/// - `disable_system_backdrop`：应用自定义 Acrylic 前是否先关闭系统 backdrop
/// - `focused_color`：聚焦窗口时的 RGBA 参数
/// - `focused_accent_flags`：聚焦窗口时写入 ACCENT_POLICY 的 flags
/// - `focused_animation_id`：聚焦窗口时写入 ACCENT_POLICY 的 animationId
/// - `inactive_color`：失焦窗口时的 RGBA 参数
/// - `inactive_accent_flags`：失焦窗口时写入 ACCENT_POLICY 的 flags
/// - `inactive_animation_id`：失焦窗口时写入 ACCENT_POLICY 的 animationId
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct WindowsAcrylicEffectConfig {
    pub enabled: bool,
    pub disable_system_backdrop: bool,
    pub focused_color: WindowsAcrylicColor,
    pub focused_accent_flags: u32,
    pub focused_animation_id: u32,
    pub inactive_color: WindowsAcrylicColor,
    pub inactive_accent_flags: u32,
    pub inactive_animation_id: u32,
}

impl Default for WindowsAcrylicEffectConfig {
    fn default() -> Self {
        Self {
            enabled: true,
            disable_system_backdrop: true,
            focused_color: WindowsAcrylicColor {
                red: 56,
                green: 64,
                blue: 76,
                alpha: 72,
            },
            focused_accent_flags: 0,
            focused_animation_id: 0,
            inactive_color: WindowsAcrylicColor {
                red: 64,
                green: 72,
                blue: 84,
                alpha: 56,
            },
            inactive_accent_flags: 0,
            inactive_animation_id: 0,
        }
    }
}

#[cfg(target_os = "macos")]
const MACOS_MAIN_WINDOW_CORNER_RADIUS: f64 = 18.0;

/// 为主窗口应用平台原生材质效果。
///
/// - `window`：Tauri 主 Webview 窗口
/// - 返回：成功或错误信息
/// - 副作用：修改原生窗口背景材质与透明相关系统属性
/// - 并发：仅在启动时调用，不持有共享锁
pub(crate) fn apply_main_window_effects(
    window: &WebviewWindow,
    windows_acrylic_config: &WindowsAcrylicEffectConfig,
) -> Result<(), Box<dyn std::error::Error>> {
    let is_focused = window.is_focused().unwrap_or(true);
    apply_runtime_window_effect_config(window, windows_acrylic_config, is_focused)?;

    #[cfg(target_os = "windows")]
    {
        register_windows_focus_effect_handler(window);
    }

    Ok(())
}

/// 按当前平台将运行时窗口效果参数下发到主窗口。
///
/// - Windows：应用或清除自定义 Acrylic 效果
/// - macOS：启用或清除 vibrancy
/// - 其他平台：保持无操作
pub(crate) fn apply_runtime_window_effect_config(
    window: &WebviewWindow,
    windows_acrylic_config: &WindowsAcrylicEffectConfig,
    is_focused: bool,
) -> Result<(), Box<dyn std::error::Error>> {
    #[cfg(target_os = "windows")]
    {
        return apply_windows_effect_config(window, windows_acrylic_config, is_focused);
    }

    #[cfg(target_os = "macos")]
    {
        let _ = is_focused;
        return apply_macos_effect(window, windows_acrylic_config.enabled);
    }

    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    {
        let _ = window;
        let _ = windows_acrylic_config;
        let _ = is_focused;
        Ok(())
    }
}

/// 为 Windows 主窗口应用系统毛玻璃效果。
///
/// 策略：聚焦/失焦都使用 Acrylic，仅 tint 强度不同。
#[cfg(target_os = "windows")]
pub(crate) fn apply_windows_effect_config(
    window: &WebviewWindow,
    config: &WindowsAcrylicEffectConfig,
    is_focused: bool,
) -> Result<(), Box<dyn std::error::Error>> {
    if !config.enabled {
        clear_windows_swca_acrylic(window)?;
        log::info!("[window] cleared acrylic effect");
        return Ok(());
    }

    let tint = if is_focused {
        config.focused_color.to_rgba_tuple()
    } else {
        config.inactive_color.to_rgba_tuple()
    };

    let accent_flags = if is_focused {
        config.focused_accent_flags
    } else {
        config.inactive_accent_flags
    };

    let animation_id = if is_focused {
        config.focused_animation_id
    } else {
        config.inactive_animation_id
    };

    apply_windows_swca_acrylic(
        window,
        tint,
        accent_flags,
        animation_id,
        config.disable_system_backdrop,
    )?;
    if is_focused {
        log::info!("[window] applied focused acrylic effect");
    } else {
        log::info!("[window] applied inactive acrylic effect");
    }
    Ok(())
}

#[cfg(target_os = "windows")]
/// 注册 Windows 主窗口焦点切换监听。
///
/// - `window`：Tauri 主 Webview 窗口
/// - 副作用：在窗口聚焦/失焦时重新下发原生材质效果
/// - 并发：事件回调在 Tauri 窗口事件线程触发，不持有共享锁
fn register_windows_focus_effect_handler(window: &WebviewWindow) {
    use crate::state::AppState;
    use tauri::Manager;
    use tauri::WindowEvent;

    let window_handle = window.clone();
    let app_handle = window.app_handle().clone();
    window.on_window_event(move |event| {
        let WindowEvent::Focused(is_focused) = event else {
            return;
        };

        let acrylic_config = app_handle
            .state::<AppState>()
            .windows_acrylic_effect_config
            .lock()
            .map(|guard| guard.clone())
            .unwrap_or_else(|error| {
                log::warn!(
                    "[window] failed to read acrylic config for focus update: {}",
                    error
                );
                WindowsAcrylicEffectConfig::default()
            });

        if let Err(error) =
            apply_windows_effect_config(&window_handle, &acrylic_config, *is_focused)
        {
            log::warn!(
                "[window] failed to update focus effect: focused={} error={}",
                is_focused,
                error
            );
            return;
        }

        log::info!("[window] updated focus effect: focused={}", is_focused);
    });
}

#[cfg(target_os = "windows")]
#[repr(C)]
struct AccentPolicy {
    accent_state: u32,
    accent_flags: u32,
    gradient_color: u32,
    animation_id: u32,
}

#[cfg(target_os = "windows")]
type WindowCompositionAttrib = u32;

#[cfg(target_os = "windows")]
#[repr(C)]
struct WindowCompositionAttribData {
    attrib: WindowCompositionAttrib,
    pv_data: *mut c_void,
    cb_data: usize,
}

#[cfg(target_os = "windows")]
#[derive(Clone, Copy, PartialEq, Eq)]
#[repr(C)]
enum AccentState {
    Disabled = 0,
    EnableAcrylicBlurBehind = 4,
}

#[cfg(target_os = "windows")]
const WINDOW_COMPOSITION_ATTRIB_ACCENT_POLICY: WindowCompositionAttrib = 0x13;

#[cfg(target_os = "windows")]
const DWMWA_SYSTEMBACKDROP_TYPE: DWMWINDOWATTRIBUTE = 38;

#[cfg(target_os = "windows")]
#[repr(C)]
enum DwmSystemBackdropType {
    Disable = 1,
}

#[cfg(target_os = "windows")]
fn apply_windows_swca_acrylic(
    window: &WebviewWindow,
    color: (u8, u8, u8, u8),
    accent_flags: u32,
    animation_id: u32,
    disable_system_backdrop_before_apply: bool,
) -> Result<(), Box<dyn std::error::Error>> {
    let hwnd = get_webview_window_hwnd(window)?;
    if disable_system_backdrop_before_apply {
        disable_windows_system_backdrop(hwnd);
    }
    set_window_composition_attribute(
        hwnd,
        AccentState::EnableAcrylicBlurBehind,
        Some(color),
        accent_flags,
        animation_id,
    )
    .map_err(|error| format!("windows swca acrylic apply failed: {error}"))?;
    Ok(())
}

#[cfg(target_os = "windows")]
fn clear_windows_swca_acrylic(window: &WebviewWindow) -> Result<(), Box<dyn std::error::Error>> {
    let hwnd = get_webview_window_hwnd(window)?;
    disable_windows_system_backdrop(hwnd);
    set_window_composition_attribute(hwnd, AccentState::Disabled, None, 0, 0)
        .map_err(|error| format!("windows swca acrylic clear failed: {error}"))?;
    Ok(())
}

#[cfg(target_os = "windows")]
fn get_webview_window_hwnd(window: &WebviewWindow) -> Result<HWND, Box<dyn std::error::Error>> {
    let window_handle = window.window_handle()?;
    match window_handle.as_raw() {
        RawWindowHandle::Win32(handle) => Ok(handle.hwnd.get() as HWND),
        _ => Err("unsupported raw window handle for Windows acrylic".into()),
    }
}

#[cfg(target_os = "windows")]
fn disable_windows_system_backdrop(hwnd: HWND) {
    unsafe {
        let disable = DwmSystemBackdropType::Disable;
        let _ = DwmSetWindowAttribute(
            hwnd,
            DWMWA_SYSTEMBACKDROP_TYPE as _,
            &disable as *const _ as _,
            4,
        );
    }
}

#[cfg(target_os = "windows")]
fn get_function_impl(library: &str, function: &str) -> Option<FARPROC> {
    let module = unsafe { LoadLibraryA(library.as_ptr()) };
    if module.is_null() {
        return None;
    }

    Some(unsafe { GetProcAddress(module, function.as_ptr()) })
}

#[cfg(target_os = "windows")]
fn set_window_composition_attribute(
    hwnd: HWND,
    accent_state: AccentState,
    color: Option<(u8, u8, u8, u8)>,
    accent_flags: u32,
    animation_id: u32,
) -> Result<(), String> {
    type SetWindowCompositionAttributeFn =
        unsafe extern "system" fn(HWND, *mut WindowCompositionAttribData) -> BOOL;

    let Some(set_window_composition_attribute) =
        get_function_impl("user32.dll\0", "SetWindowCompositionAttribute\0").map(
            |function| unsafe {
                std::mem::transmute::<FARPROC, SetWindowCompositionAttributeFn>(function)
            },
        )
    else {
        return Err("SetWindowCompositionAttribute unavailable".to_string());
    };

    let mut policy = AccentPolicy {
        accent_state: accent_state as u32,
        accent_flags,
        gradient_color: color
            .map(pack_windows_acrylic_gradient_color)
            .unwrap_or_default(),
        animation_id,
    };

    let mut data = WindowCompositionAttribData {
        attrib: WINDOW_COMPOSITION_ATTRIB_ACCENT_POLICY,
        pv_data: &mut policy as *mut _ as _,
        cb_data: std::mem::size_of::<AccentPolicy>(),
    };

    unsafe {
        let result = set_window_composition_attribute(hwnd, &mut data as *mut _);
        if result == 0 {
            return Err("SetWindowCompositionAttribute returned false".to_string());
        }
    }

    Ok(())
}

#[cfg(target_os = "macos")]
/// 为 macOS 主窗口应用或清除 vibrancy 材质效果，并统一原生圆角裁剪。
fn apply_macos_effect(
    window: &WebviewWindow,
    enabled: bool,
) -> Result<(), Box<dyn std::error::Error>> {
    use tauri::utils::config::WindowEffectsConfig;
    use tauri::window::{Effect, EffectState, EffectsBuilder};
    use window_vibrancy::clear_vibrancy;

    apply_macos_window_corner_radius(window, MACOS_MAIN_WINDOW_CORNER_RADIUS)?;

    if enabled {
        window
            .set_effects(
                EffectsBuilder::new()
                    .effect(Effect::Sidebar)
                    .state(EffectState::Active)
                    .radius(MACOS_MAIN_WINDOW_CORNER_RADIUS)
                    .build(),
            )
            .map_err(|error| format!("macOS vibrancy failed: {error}"))?;

        log::info!("[window] applied macOS vibrancy effect");
        return Ok(());
    }

    window
        .set_effects(None::<WindowEffectsConfig>)
        .map_err(|error| format!("macOS clear vibrancy failed: {error}"))?;
    clear_vibrancy(window).map_err(|error| format!("macOS clear vibrancy failed: {error}"))?;
    log::info!("[window] cleared macOS vibrancy effect");
    Ok(())
}

#[cfg(target_os = "macos")]
/// 为 macOS 主窗口 WebView 容器应用原生圆角裁剪。
fn apply_macos_window_corner_radius(
    window: &WebviewWindow,
    radius: f64,
) -> Result<(), Box<dyn std::error::Error>> {
    let window_handle = window.window_handle()?;
    let RawWindowHandle::AppKit(handle) = window_handle.as_raw() else {
        return Err("unsupported raw window handle for macOS corner radius".into());
    };

    let view = handle.ns_view.as_ptr() as *mut AnyObject;
    if view.is_null() {
        return Err("macOS ns_view unavailable for corner radius".into());
    }

    unsafe {
        let () = msg_send![view, setWantsLayer: true];
        let layer: *mut AnyObject = msg_send![view, layer];
        if layer.is_null() {
            return Err("macOS layer unavailable for corner radius".into());
        }

        let () = msg_send![layer, setCornerRadius: radius];
        let () = msg_send![layer, setMasksToBounds: true];
    }

    log::info!("[window] applied macOS native corner radius: {}", radius);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::WindowsAcrylicEffectConfig;

    #[cfg(target_os = "windows")]
    use super::pack_windows_acrylic_gradient_color;

    #[test]
    fn default_windows_acrylic_effect_config_uses_expected_colors() {
        let config = WindowsAcrylicEffectConfig::default();

        assert!(config.enabled);
        assert!(config.disable_system_backdrop);
        assert_eq!(config.focused_color.red, 56);
        assert_eq!(config.focused_color.green, 64);
        assert_eq!(config.focused_color.blue, 76);
        assert_eq!(config.focused_color.alpha, 72);
        assert_eq!(config.focused_accent_flags, 0);
        assert_eq!(config.focused_animation_id, 0);
        assert_eq!(config.inactive_color.red, 64);
        assert_eq!(config.inactive_color.green, 72);
        assert_eq!(config.inactive_color.blue, 84);
        assert_eq!(config.inactive_color.alpha, 56);
        assert_eq!(config.inactive_accent_flags, 0);
        assert_eq!(config.inactive_animation_id, 0);
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn acrylic_gradient_color_keeps_rgba_order_and_non_zero_alpha() {
        assert_eq!(
            pack_windows_acrylic_gradient_color((56, 64, 76, 72)),
            0x484c4038,
        );
        assert_eq!(
            pack_windows_acrylic_gradient_color((1, 2, 3, 0)),
            0x01030201,
        );
    }
}
