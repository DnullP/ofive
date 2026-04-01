//! # 后端日志通知集成测试
//!
//! 覆盖 WARN / ERROR 日志写入时的前端通知桥接行为。

use std::sync::{Arc, Mutex, Once};

use ofive_lib::test_support::{
    forward_frontend_log, init_logging, set_log_notification_capture,
    BackendLogNotificationEventPayload,
};

static INIT_LOGGING: Once = Once::new();

fn ensure_logging_initialized() {
    INIT_LOGGING.call_once(init_logging);
}

#[test]
fn forward_frontend_log_should_capture_warn_and_error_notifications() {
    ensure_logging_initialized();

    let capture = Arc::new(Mutex::new(Vec::<BackendLogNotificationEventPayload>::new()));
    set_log_notification_capture(Some(capture.clone()));

    forward_frontend_log(
        "warn".to_string(),
        "integration-warn-message".to_string(),
        Some("ctx-warn".to_string()),
    );
    forward_frontend_log(
        "error".to_string(),
        "integration-error-message".to_string(),
        Some("ctx-error".to_string()),
    );
    forward_frontend_log(
        "info".to_string(),
        "integration-info-message".to_string(),
        None,
    );

    set_log_notification_capture(None);

    let payloads = capture.lock().expect("capture lock should succeed").clone();
    let warn_payload = payloads
        .iter()
        .find(|payload| payload.message.contains("integration-warn-message"))
        .expect("warn payload should be captured");
    let error_payload = payloads
        .iter()
        .find(|payload| payload.message.contains("integration-error-message"))
        .expect("error payload should be captured");

    assert_eq!(warn_payload.level, "warn");
    assert_eq!(warn_payload.source, "frontend-log");
    assert_eq!(error_payload.level, "error");
    assert_eq!(error_payload.source, "frontend-log");
    assert!(payloads.iter().all(|payload| !payload.message.contains("integration-info-message")));
}