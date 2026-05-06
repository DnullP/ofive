import { useEffect, useMemo, useState, type ReactNode } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { Plus, RefreshCw } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { PanelRenderContext } from "../../host/layout/workbenchContracts";
import { FileTree, type FileTreeItem } from "../file-tree/panel/FileTree";
import {
    addProjectReaderProject,
    getProjectReaderTree,
    listProjectReaderProjects,
    type ProjectReaderProject,
    type ProjectReaderTreeEntry,
} from "../../api/projectReaderApi";
import {
    buildProjectReaderTabDefinition,
    normalizeProjectRelativePath,
    openProjectReaderLocationInWorkbench,
} from "./projectReaderLinks";
import "./projectReaderPlugin.css";

interface ProjectReaderPanelProps {
    context: PanelRenderContext;
}

function isTauriRuntime(): boolean {
    if (typeof window === "undefined") {
        return false;
    }

    const runtimeWindow = window as Window & {
        __TAURI_INTERNALS__?: unknown;
        __TAURI__?: unknown;
    };

    return Boolean(runtimeWindow.__TAURI_INTERNALS__ || runtimeWindow.__TAURI__);
}

function normalizeSelectedDirectory(selected: unknown): string | null {
    if (typeof selected === "string") {
        return selected;
    }
    if (Array.isArray(selected)) {
        const first = selected[0];
        return typeof first === "string" ? first : null;
    }
    if (selected && typeof selected === "object") {
        const selectedObject = selected as { path?: unknown };
        return typeof selectedObject.path === "string" ? selectedObject.path : null;
    }
    return null;
}

function toTreeItems(entries: ProjectReaderTreeEntry[]): FileTreeItem[] {
    return entries.map((entry) => ({
        id: entry.relativePath,
        path: normalizeProjectRelativePath(entry.relativePath),
        isDir: entry.isDir,
    }));
}

export function ProjectReaderPanel(props: ProjectReaderPanelProps): ReactNode {
    const { t } = useTranslation();
    const [projects, setProjects] = useState<ProjectReaderProject[]>([]);
    const [activeProjectId, setActiveProjectId] = useState<string>("");
    const [entries, setEntries] = useState<ProjectReaderTreeEntry[]>([]);
    const [activePath, setActivePath] = useState<string | null>(null);
    const [loadingProjects, setLoadingProjects] = useState(true);
    const [loadingTree, setLoadingTree] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const activeProject = useMemo(
        () => projects.find((project) => project.id === activeProjectId) ?? null,
        [projects, activeProjectId],
    );
    const treeItems = useMemo(() => toTreeItems(entries), [entries]);

    const refreshProjects = async (): Promise<ProjectReaderProject[]> => {
        const response = await listProjectReaderProjects();
        setProjects(response.projects);
        setActiveProjectId((currentId) => {
            if (currentId && response.projects.some((project) => project.id === currentId)) {
                return currentId;
            }
            return response.projects[0]?.id ?? "";
        });
        return response.projects;
    };

    const refreshTree = async (projectId: string): Promise<void> => {
        if (!projectId) {
            setEntries([]);
            return;
        }

        setLoadingTree(true);
        setError(null);
        try {
            const response = await getProjectReaderTree(projectId);
            setEntries(response.entries);
        } catch (treeError) {
            setEntries([]);
            setError(treeError instanceof Error ? treeError.message : String(treeError));
        } finally {
            setLoadingTree(false);
            props.context.markContentReady?.();
        }
    };

    useEffect(() => {
        let disposed = false;
        setLoadingProjects(true);
        void refreshProjects()
            .catch((projectError) => {
                if (disposed) {
                    return;
                }
                setError(projectError instanceof Error ? projectError.message : String(projectError));
            })
            .finally(() => {
                if (disposed) {
                    return;
                }
                setLoadingProjects(false);
                props.context.markContentReady?.();
            });

        return () => {
            disposed = true;
        };
    }, []);

    useEffect(() => {
        setActivePath(null);
        void refreshTree(activeProjectId);
    }, [activeProjectId]);

    const handleAddProject = async (): Promise<void> => {
        setError(null);
        try {
            const selectedDirectory = isTauriRuntime()
                ? normalizeSelectedDirectory(await open({
                    directory: true,
                    multiple: false,
                    title: t("projectReader.selectProjectDirectory"),
                }))
                : window.prompt(t("projectReader.enterProjectDirectory"), "/mock/external-project");

            if (!selectedDirectory) {
                return;
            }

            const project = await addProjectReaderProject(selectedDirectory);
            const nextProjects = await refreshProjects();
            if (nextProjects.some((item) => item.id === project.id)) {
                setActiveProjectId(project.id);
            }
        } catch (addError) {
            setError(addError instanceof Error ? addError.message : String(addError));
        }
    };

    const handleRefreshIndex = async (): Promise<void> => {
        if (!activeProject) {
            return;
        }

        setLoadingTree(true);
        setError(null);
        try {
            await addProjectReaderProject(activeProject.rootPath);
            await refreshTree(activeProject.id);
        } catch (refreshError) {
            setError(refreshError instanceof Error ? refreshError.message : String(refreshError));
        } finally {
            setLoadingTree(false);
        }
    };

    const handleOpenFile = (item: FileTreeItem): void => {
        if (!activeProject || item.isDir) {
            return;
        }

        setActivePath(item.path);
        const tab = buildProjectReaderTabDefinition({
            projectId: activeProject.id,
            projectName: activeProject.name,
            rootPath: activeProject.rootPath,
            relativePath: item.path,
        });

        if (props.context.workbenchApi) {
            openProjectReaderLocationInWorkbench(props.context.workbenchApi, {
                projectId: activeProject.id,
                projectName: activeProject.name,
                rootPath: activeProject.rootPath,
                relativePath: item.path,
            });
            return;
        }

        props.context.openTab(tab);
    };

    return (
        <div className="project-reader-panel">
            <div className="project-reader-panel-toolbar">
                <select
                    className="project-reader-project-select"
                    value={activeProjectId}
                    disabled={loadingProjects || projects.length === 0}
                    onChange={(event) => {
                        setActiveProjectId(event.target.value);
                    }}
                    aria-label={t("projectReader.projectSelectLabel")}
                >
                    {projects.length === 0 ? (
                        <option value="">{t("projectReader.noProjects")}</option>
                    ) : null}
                    {projects.map((project) => (
                        <option key={project.id} value={project.id}>
                            {project.name}
                        </option>
                    ))}
                </select>
                <button
                    type="button"
                    className="project-reader-icon-button"
                    title={t("projectReader.addProject")}
                    onClick={() => {
                        void handleAddProject();
                    }}
                >
                    <Plus size={15} strokeWidth={1.9} />
                </button>
                <button
                    type="button"
                    className="project-reader-icon-button"
                    title={t("projectReader.refreshIndex")}
                    disabled={!activeProject || loadingTree}
                    onClick={() => {
                        void handleRefreshIndex();
                    }}
                >
                    <RefreshCw size={14} strokeWidth={1.9} />
                </button>
            </div>

            {activeProject ? (
                <div className="project-reader-project-root" title={activeProject.rootPath}>
                    {activeProject.rootPath}
                </div>
            ) : null}

            {error ? (
                <div className="project-reader-panel-state is-error">{error}</div>
            ) : null}

            {loadingProjects || loadingTree ? (
                <div className="project-reader-panel-state">{t("common.loading")}</div>
            ) : null}

            {!loadingProjects && !activeProject ? (
                <div className="project-reader-empty">
                    <button
                        type="button"
                        className="project-reader-add-button"
                        onClick={() => {
                            void handleAddProject();
                        }}
                    >
                        {t("projectReader.addProject")}
                    </button>
                </div>
            ) : null}

            {activeProject && !loadingTree ? (
                <FileTree
                    items={treeItems}
                    activePath={activePath}
                    onOpenFile={handleOpenFile}
                    readOnly
                />
            ) : null}
        </div>
    );
}
