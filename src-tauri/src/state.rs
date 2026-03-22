//! # 状态模块
//!
//! 提供后端共享运行时状态与常用状态访问函数。

#[path = "runtime/app_state.rs"]
mod app_state;
#[path = "runtime/runtime_context.rs"]
mod runtime_context;

pub use app_state::{AiSidecarRuntime, AppState, PendingVaultWriteTrace};
pub use runtime_context::{get_vault_root, set_vault_root};
