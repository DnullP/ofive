//! # 查询工作负载基准测试
//!
//! 对搜索、图谱、任务查询等读路径建立首批性能基准，
//! 作为 `rebuild_index_bench` 之外的查询层补充。
//!
//! ## 输出
//!
//! 当设置环境变量 `OFIVE_PERF_RESULTS_DIR` 时，基准会额外向该目录输出
//! `backend-query-bench.jsonl`，便于统一报告脚本读取。

use criterion::{criterion_group, criterion_main, BenchmarkId, Criterion};
use ofive_lib::test_support::{
    get_current_vault_markdown_graph_in_root, query_vault_tasks_in_root,
    search_vault_markdown_files_in_root, search_vault_markdown_in_root,
    VaultSearchScope,
};
use serde::Serialize;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{Duration, Instant};

/// 用于生成唯一测试目录名的原子序列号。
static BENCH_SEQ: AtomicU64 = AtomicU64::new(1);

/// 查询基准测试的数据规模配置。
struct QueryBenchScale {
    name: &'static str,
    file_count: usize,
    tasks_per_file: usize,
}

/// 报告脚本消费的后端性能记录。
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct BenchMetricRecord {
    schema_version: &'static str,
    name: &'static str,
    category: &'static str,
    status: &'static str,
    duration_ms: f64,
    details: BenchMetricDetails,
}

/// 后端性能记录的附加上下文。
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct BenchMetricDetails {
    dataset: String,
    file_count: usize,
    task_count: usize,
    result_count: usize,
}

/// 创建唯一的临时测试根目录。
fn create_bench_root() -> PathBuf {
    let seq = BENCH_SEQ.fetch_add(1, Ordering::Relaxed);
    let ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_nanos())
        .unwrap_or(0);
    let root = std::env::temp_dir().join(format!("ofive-bench-query-{ts}-{seq}"));
    fs::create_dir_all(root.join(".ofive")).expect("应成功创建基准测试根目录");
    root
}

/// 清除测试根目录及其所有内容。
fn cleanup_bench_root(root: &Path) {
    let _ = fs::remove_dir_all(root);
}

/// 生成查询工作负载测试数据。
fn generate_query_vault(
    root: &Path,
    file_count: usize,
    tasks_per_file: usize,
) -> (usize, usize) {
    let mut total_task_count = 0usize;

    for index in 0..file_count {
        let relative_path = format!("notes/project-{index:04}.md");
        let target = root.join(&relative_path);
        if let Some(parent) = target.parent() {
            fs::create_dir_all(parent).expect("应成功创建父目录");
        }

        let mut content = format!(
            "---\ntags:\n  - project\n  - sprint\n---\n# Project {index}\n\n[[project-{next:04}]]\n\n",
            next = (index + 1) % file_count,
        );

        for task_index in 0..tasks_per_file {
            total_task_count += 1;
            content.push_str(&format!(
                "- [ ] Verify workload {index}-{task_index} #project due: 2026-03-{day:02} priority: high\n",
                day = (task_index % 28) + 1,
            ));
        }

        content.push_str("\nProject roadmap and sprint planning details.\n");
        fs::write(target, content).expect("应成功写入查询基准文件");
    }

    (file_count, total_task_count)
}

/// 追加一条后端性能记录到 JSONL 文件。
fn append_metric_record(record: &BenchMetricRecord) {
    let Some(output_dir) = std::env::var_os("OFIVE_PERF_RESULTS_DIR") else {
        return;
    };

    let output_dir = PathBuf::from(output_dir);
    if fs::create_dir_all(&output_dir).is_err() {
        return;
    }

    let output_path = output_dir.join("backend-query-bench.jsonl");
    let serialized = match serde_json::to_string(record) {
        Ok(serialized) => serialized,
        Err(_) => return,
    };

    let mut existing = fs::read_to_string(&output_path).unwrap_or_default();
    existing.push_str(&serialized);
    existing.push('\n');
    let _ = fs::write(output_path, existing);
}

/// 运行一次代表性样本并输出结构化记录。
fn emit_sample_records(
    root: &Path,
    dataset: &str,
    file_count: usize,
    task_count: usize,
) {
    let search_start = Instant::now();
    let search_results = search_vault_markdown_in_root(
        root,
        "project".to_string(),
        Some("project".to_string()),
        VaultSearchScope::All,
        Some(40),
    )
    .expect("基准样本：全文搜索应成功");
    append_metric_record(&BenchMetricRecord {
        schema_version: "ofive.perf.metric.v1",
        name: "backend.query.search-vault-markdown",
        category: "backend-bench",
        status: "ok",
        duration_ms: search_start.elapsed().as_secs_f64() * 1000.0,
        details: BenchMetricDetails {
            dataset: dataset.to_string(),
            file_count,
            task_count,
            result_count: search_results.len(),
        },
    });

    let quick_switch_start = Instant::now();
    let quick_switch_results = search_vault_markdown_files_in_root(
        root,
        "project".to_string(),
        Some(40),
    )
    .expect("基准样本：快速切换搜索应成功");
    append_metric_record(&BenchMetricRecord {
        schema_version: "ofive.perf.metric.v1",
        name: "backend.query.search-vault-markdown-files",
        category: "backend-bench",
        status: "ok",
        duration_ms: quick_switch_start.elapsed().as_secs_f64() * 1000.0,
        details: BenchMetricDetails {
            dataset: dataset.to_string(),
            file_count,
            task_count,
            result_count: quick_switch_results.len(),
        },
    });

    let task_start = Instant::now();
    let task_results = query_vault_tasks_in_root(root).expect("基准样本：任务查询应成功");
    append_metric_record(&BenchMetricRecord {
        schema_version: "ofive.perf.metric.v1",
        name: "backend.query.query-vault-tasks",
        category: "backend-bench",
        status: "ok",
        duration_ms: task_start.elapsed().as_secs_f64() * 1000.0,
        details: BenchMetricDetails {
            dataset: dataset.to_string(),
            file_count,
            task_count,
            result_count: task_results.len(),
        },
    });

    let graph_start = Instant::now();
    let graph = get_current_vault_markdown_graph_in_root(root)
        .expect("基准样本：图谱查询应成功");
    append_metric_record(&BenchMetricRecord {
        schema_version: "ofive.perf.metric.v1",
        name: "backend.query.get-current-vault-markdown-graph",
        category: "backend-bench",
        status: "ok",
        duration_ms: graph_start.elapsed().as_secs_f64() * 1000.0,
        details: BenchMetricDetails {
            dataset: dataset.to_string(),
            file_count,
            task_count,
            result_count: graph.edges.len(),
        },
    });
}

/// 查询工作负载基准测试。
fn bench_query_workloads(c: &mut Criterion) {
    let scales = [
        QueryBenchScale {
            name: "small_120files_2tasks",
            file_count: 120,
            tasks_per_file: 2,
        },
        QueryBenchScale {
            name: "medium_480files_3tasks",
            file_count: 480,
            tasks_per_file: 3,
        },
    ];

    let mut group = c.benchmark_group("query_workloads");
    group.measurement_time(Duration::from_secs(12));
    group.sample_size(10);
    group.warm_up_time(Duration::from_secs(2));

    for scale in &scales {
        let root = create_bench_root();
        let (file_count, task_count) =
            generate_query_vault(&root, scale.file_count, scale.tasks_per_file);

        group.bench_with_input(
            BenchmarkId::new(scale.name, "search_vault_markdown"),
            &root,
            |b, root| {
                b.iter(|| {
                    search_vault_markdown_in_root(
                        root,
                        "project".to_string(),
                        Some("project".to_string()),
                        VaultSearchScope::All,
                        Some(40),
                    )
                    .expect("基准测试：全文搜索应成功");
                });
            },
        );

        group.bench_with_input(
            BenchmarkId::new(scale.name, "search_vault_markdown_files"),
            &root,
            |b, root| {
                b.iter(|| {
                    search_vault_markdown_files_in_root(
                        root,
                        "project".to_string(),
                        Some(40),
                    )
                    .expect("基准测试：快速切换搜索应成功");
                });
            },
        );

        group.bench_with_input(
            BenchmarkId::new(scale.name, "query_vault_tasks"),
            &root,
            |b, root| {
                b.iter(|| {
                    query_vault_tasks_in_root(root).expect("基准测试：任务查询应成功");
                });
            },
        );

        group.bench_with_input(
            BenchmarkId::new(scale.name, "get_current_vault_markdown_graph"),
            &root,
            |b, root| {
                b.iter(|| {
                    get_current_vault_markdown_graph_in_root(root)
                        .expect("基准测试：图谱查询应成功");
                });
            },
        );

        emit_sample_records(&root, scale.name, file_count, task_count);
        cleanup_bench_root(&root);
    }

    group.finish();
}

criterion_group!(benches, bench_query_workloads);
criterion_main!(benches);