//! # `rebuild_index_data` 基准测试
//!
//! 对 `ensure_query_index_current`（内部调用 `rebuild_index_data`）进行基准测试，
//! 验证在不同规模仓库下全量索引重建的性能。
//!
//! ## 测试数据规模
//!
//! | 组别 | 目录数 | 文件数 | 每文件链接数 |
//! |------|--------|--------|-------------|
//! | small  | 10  | 100  | 4  |
//! | medium | 30  | 500  | 6  |
//! | large  | 50  | 1000 | 8  |
//!
//! ## 依赖模块
//! - `ofive_lib::ensure_query_index_current`：全量索引重建入口
//!
//! ## 测试目录
//! 使用 `std::env::temp_dir()` 下的唯一子目录，测试后自动清除。
//!
//! ## Profiling（性能剖析）
//!
//! `rebuild_index_data` 和 `ensure_query_index_current_inner` 内部已集成
//! 阶段计时日志，运行时自动输出各阶段耗时分解到 stdout：
//! - `scan_manifest`：文件系统扫描构建清单
//! - `prepare_stmt`：SQLite 预编译语句
//! - `insert_file`：写入文件索引
//! - `file_read`：读取文件内容（I/O）
//! - `parse_links`：解析 wikilink + 文件系统解析目标路径
//! - `insert_link`：写入边索引
//!
//! 运行方式：
//! ```sh
//! cargo bench --bench rebuild_index_bench -- --nocapture
//! ```

use criterion::{criterion_group, criterion_main, BenchmarkId, Criterion};
use ofive_lib::ensure_query_index_current;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::Duration;

/// 用于生成唯一测试目录名的原子序列号。
static BENCH_SEQ: AtomicU64 = AtomicU64::new(1);

/// 基准测试的数据规模配置。
///
/// # 字段
/// - `name`：测试组名称
/// - `dir_count`：目录层数
/// - `file_count`：总文件数
/// - `links_per_file`：每个文件中的 wikilink 数量
struct BenchScale {
    name: &'static str,
    dir_count: usize,
    file_count: usize,
    links_per_file: usize,
}

/// 创建唯一的临时测试根目录。
///
/// 目录名包含时间戳和序列号，确保并发运行时不冲突。
///
/// # 返回
/// 测试根目录的绝对路径
fn create_bench_root() -> PathBuf {
    let seq = BENCH_SEQ.fetch_add(1, Ordering::Relaxed);
    let ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let root = std::env::temp_dir().join(format!("ofive-bench-rebuild-{ts}-{seq}"));
    fs::create_dir_all(root.join(".ofive")).expect("应成功创建基准测试根目录");
    root
}

/// 清除测试根目录及其所有内容。
///
/// # 参数
/// - `root`：待清除的测试根目录路径
fn cleanup_bench_root(root: &Path) {
    let _ = fs::remove_dir_all(root);
}

/// 删除索引数据库文件，强制下次 `ensure_query_index_current` 全量重建。
///
/// # 参数
/// - `root`：仓库根目录
fn remove_index_db(root: &Path) {
    let db_path = root.join(".ofive/query-index.sqlite");
    let _ = fs::remove_file(&db_path);
    // WAL 和 SHM 附属文件也需清除
    let _ = fs::remove_file(db_path.with_extension("sqlite-wal"));
    let _ = fs::remove_file(db_path.with_extension("sqlite-shm"));
}

/// 在测试根目录下生成指定规模的 Markdown 文件仓库。
///
/// 文件均匀分布在各层目录中。每个文件包含指定数量的 wikilink，
/// 链接目标为同仓库内的其他文件（按轮询分配）。
///
/// # 参数
/// - `root`：仓库根目录
/// - `dir_count`：目录数量
/// - `file_count`：文件总数
/// - `links_per_file`：每个文件中的 wikilink 数量
///
/// # 返回
/// 所有生成文件的相对路径列表
fn generate_vault(
    root: &Path,
    dir_count: usize,
    file_count: usize,
    links_per_file: usize,
) -> Vec<String> {
    // 创建目录结构：dir_00/sub_00, dir_01/sub_01, ...
    let mut dirs = Vec::with_capacity(dir_count);
    for i in 0..dir_count {
        let dir = format!("dir_{:02}/sub_{:02}", i / 3, i % 10);
        let abs_dir = root.join(&dir);
        fs::create_dir_all(&abs_dir).expect("应成功创建测试子目录");
        dirs.push(dir);
    }

    // 在各目录中均匀分配文件
    let mut file_paths = Vec::with_capacity(file_count);
    let mut file_stems = Vec::with_capacity(file_count);
    for i in 0..file_count {
        let dir_idx = i % dir_count;
        let stem = format!("note_{:04}", i);
        let relative = format!("{}/{}.md", dirs[dir_idx], stem);
        file_paths.push(relative);
        file_stems.push(stem);
    }

    // 为每个文件生成内容，包含标题和 wikilink
    for (i, path) in file_paths.iter().enumerate() {
        let mut content = format!("# {}\n\n", file_stems[i]);

        // 生成 wikilink，链接到其他文件（避免自引用）
        for link_idx in 0..links_per_file {
            let target_idx = (i + link_idx + 1) % file_count;
            content.push_str(&format!("[[{}]]\n", file_stems[target_idx]));
        }

        // 添加一些正文内容增加文件大小的真实感
        content.push_str("\n这是一个测试笔记，包含一些正文内容用于模拟真实场景。\n");

        let abs_path = root.join(path);
        fs::write(&abs_path, &content).expect("应成功写入基准测试文件");
    }

    file_paths
}

/// `ensure_query_index_current` 全量重建基准测试。
///
/// 在 3 组不同规模的仓库数据下，测量冷启动全量索引重建的耗时。
/// 每次迭代前删除索引数据库文件，确保每次都触发完整重建。
///
/// # 测试规模
/// - small：10 目录 / 100 文件 / 4 链接
/// - medium：30 目录 / 500 文件 / 6 链接
/// - large：50 目录 / 1000 文件 / 8 链接
fn bench_rebuild_index(c: &mut Criterion) {
    let scales = [
        BenchScale {
            name: "small_10dirs_100files_4links",
            dir_count: 10,
            file_count: 100,
            links_per_file: 4,
        },
        BenchScale {
            name: "medium_30dirs_500files_6links",
            dir_count: 30,
            file_count: 500,
            links_per_file: 6,
        },
        BenchScale {
            name: "large_50dirs_1000files_8links",
            dir_count: 50,
            file_count: 1000,
            links_per_file: 8,
        },
    ];

    let mut group = c.benchmark_group("rebuild_index_data");
    // 大规模数据需要更长的测量时间，sample_size 设为 10 以缩短整体耗时
    group.measurement_time(Duration::from_secs(15));
    group.sample_size(10);
    group.warm_up_time(Duration::from_secs(3));

    for scale in &scales {
        // 为每组测试创建独立的仓库目录
        let root = create_bench_root();
        let file_paths = generate_vault(
            &root,
            scale.dir_count,
            scale.file_count,
            scale.links_per_file,
        );

        let param = format!(
            "{}dirs/{}files/{}links",
            scale.dir_count, scale.file_count, scale.links_per_file
        );

        group.bench_with_input(BenchmarkId::new(scale.name, &param), &root, |b, root| {
            b.iter(|| {
                // 每次迭代前清除索引，强制全量重建
                remove_index_db(root);
                ensure_query_index_current(root).expect("基准测试：索引重建应成功");
            });
        });

        // 运行完一次完整 benchmark 后验证索引正确性
        remove_index_db(&root);
        ensure_query_index_current(&root).expect("验证：索引重建应成功");
        let files = ofive_lib::list_markdown_files(&root).expect("验证：读取文件索引应成功");
        assert_eq!(
            files.len(),
            file_paths.len(),
            "索引文件数应与生成文件数一致：期望 {}，实际 {}",
            file_paths.len(),
            files.len()
        );

        let graph = ofive_lib::load_markdown_graph(&root).expect("验证：读取图谱应成功");
        assert!(
            !graph.edges.is_empty(),
            "图谱边不应为空（{}组）",
            scale.name
        );

        // 清除测试目录
        cleanup_bench_root(&root);
    }

    group.finish();
}

criterion_group!(benches, bench_rebuild_index);
criterion_main!(benches);
