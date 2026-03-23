//! # Architecture Guard
//!
//! 通过源码级导入检查守卫后端模块边界，避免功能模块直接依赖其他模块的
//! 私有 app / infra 实现。

#[cfg(test)]
mod tests {
    use crate::module_boundary_template::builtin_module_boundary_templates;
    use crate::platform_public_surface::platform_public_surface_rules;

    use std::fs;
    use std::path::{Path, PathBuf};

    #[test]
    fn private_module_imports_should_stay_within_allowed_boundaries() {
        let rules = private_namespace_rules();
        let violations = collect_namespace_rule_violations(&rules);

        assert!(
            violations.is_empty(),
            "发现跨模块私有实现依赖，需改为 capability/facade/shared contract 边界:\n{}",
            violations.join("\n")
        );
    }

    #[test]
    fn platform_public_surfaces_should_only_be_used_from_allowed_paths() {
        let rules = platform_public_surface_rules();
        let violations = collect_namespace_rule_violations(&rules);

        assert!(
            violations.is_empty(),
            "发现平台公共依赖面被未授权位置直接依赖，需收敛到声明的公共边界:\n{}",
            violations.join("\n")
        );
    }

    fn collect_namespace_rule_violations<T>(rules: &[T]) -> Vec<String>
    where
        T: NamespaceRule,
    {
        let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
        let src_root = manifest_dir.join("src");
        let mut files = Vec::new();
        collect_rust_files(&src_root, &mut files);
        let mut violations = Vec::new();

        for file_path in files {
            let relative_path = file_path
                .strip_prefix(&manifest_dir)
                .expect("源码路径应位于 cargo manifest 下")
                .to_string_lossy()
                .replace('\\', "/");
            let source = fs::read_to_string(&file_path).expect("应读取源码文件");

            for rule in rules {
                if !source_contains_namespace_import(&source, rule.namespace()) {
                    continue;
                }

                if rule
                    .allowed_paths()
                    .iter()
                    .any(|allowed| relative_path.starts_with(allowed))
                {
                    continue;
                }

                violations.push(format!(
                    "{} imports namespace {} but is not in allowed paths {:?} ({})",
                    relative_path,
                    rule.namespace(),
                    rule.allowed_paths(),
                    rule.rationale()
                ));
            }
        }

        violations
    }

    fn source_contains_namespace_import(source: &str, namespace: &str) -> bool {
        source.lines().any(|line| {
            let trimmed = line.trim_start();
            (trimmed.starts_with("use ") || trimmed.starts_with("pub use "))
                && trimmed.contains(namespace)
        })
    }

    fn collect_rust_files(root: &Path, files: &mut Vec<PathBuf>) {
        for entry in fs::read_dir(root).expect("应列出源码目录") {
            let entry = entry.expect("目录项应存在");
            let path = entry.path();
            if path.is_dir() {
                collect_rust_files(&path, files);
                continue;
            }

            if path.extension().and_then(|ext| ext.to_str()) == Some("rs") {
                files.push(path);
            }
        }
    }

    trait NamespaceRule {
        fn namespace(&self) -> &'static str;
        fn allowed_paths(&self) -> &'static [&'static str];
        fn rationale(&self) -> &'static str;
    }

    impl NamespaceRule for crate::platform_public_surface::PublicSurfaceRule {
        fn namespace(&self) -> &'static str {
            self.namespace
        }

        fn allowed_paths(&self) -> &'static [&'static str] {
            self.allowed_paths
        }

        fn rationale(&self) -> &'static str {
            self.rationale
        }
    }

    impl NamespaceRule for crate::module_boundary_template::ModulePrivateNamespaceTemplate {
        fn namespace(&self) -> &'static str {
            self.namespace
        }

        fn allowed_paths(&self) -> &'static [&'static str] {
            self.allowed_paths
        }

        fn rationale(&self) -> &'static str {
            self.rationale
        }
    }

    impl NamespaceRule for &crate::module_boundary_template::ModulePrivateNamespaceTemplate {
        fn namespace(&self) -> &'static str {
            self.namespace
        }

        fn allowed_paths(&self) -> &'static [&'static str] {
            self.allowed_paths
        }

        fn rationale(&self) -> &'static str {
            self.rationale
        }
    }

    fn private_namespace_rules(
    ) -> Vec<&'static crate::module_boundary_template::ModulePrivateNamespaceTemplate> {
        builtin_module_boundary_templates()
            .iter()
            .flat_map(|template| template.private_namespaces.iter())
            .collect()
    }
}
