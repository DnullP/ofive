//! # 前端日志桥接命令集成测试
//!
//! 覆盖后端暴露接口：`forward_frontend_log`。

use ofive_lib::test_support::forward_frontend_log;

#[test]
fn forward_frontend_log_should_not_panic_for_all_levels() {
    forward_frontend_log("info".to_string(), "hello info".to_string(), None);
    forward_frontend_log(
        "debug".to_string(),
        "hello debug".to_string(),
        Some("ctx-debug".to_string()),
    );
    forward_frontend_log(
        "warn".to_string(),
        "hello warn".to_string(),
        Some("ctx-warn".to_string()),
    );
    forward_frontend_log(
        "error".to_string(),
        "hello error".to_string(),
        Some("ctx-error".to_string()),
    );
}
