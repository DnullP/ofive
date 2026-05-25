import { useEffect, useMemo, useState, type ReactNode } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import {
    Braces,
    CaseSensitive,
    ChevronsUpDown,
    FileSearch,
    Plus,
    RefreshCw,
    Sigma,
    type LucideIcon,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import type { PanelRenderContext } from "../../host/layout/workbenchContracts";
import { FileTree, type FileTreeItem } from "../file-tree/panel/FileTree";
import {
    addProjectReaderProject,
    getProjectReaderTree,
    listProjectReaderProjects,
    searchProjectReader,
    type ProjectReaderProject,
    type ProjectReaderSearchMatch,
    type ProjectReaderSearchMode,
    type ProjectReaderTreeEntry,
} from "../../api/projectReaderApi";
import {
    buildProjectReaderTabDefinition,
    normalizeProjectRelativePath,
    openProjectReaderLocationInWorkbench,
    reportProjectReaderTabBacklinkTarget,
} from "./projectReaderLinks";
import "./projectReaderPlugin.css";

interface ProjectReaderPanelProps {
    context: PanelRenderContext;
}

interface SearchState {
    query: string;
    mode: ProjectReaderSearchMode;
    loading: boolean;
    error: string | null;
    matches: ProjectReaderSearchMatch[];
}

const PROJECT_READER_SEARCH_LIMIT = 80;

const PROJECT_READER_SEARCH_MODES: Array<{
    mode: ProjectReaderSearchMode;
    icon: LucideIcon;
}> = [
    { mode: "text", icon: CaseSensitive },
    { mode: "symbol", icon: Sigma },
    { mode: "astGrep", icon: Braces },
];

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
    const [searchState, setSearchState] = useState<SearchState>({
        query: "",
        mode: "text",
        loading: false,
        error: null,
        matches: [],
    });
    const [searchModeMenuOpen, setSearchModeMenuOpen] = useState(false);

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
        setSearchState((previous) => ({
            ...previous,
            loading: false,
            error: null,
            matches: [],
        }));
        void refreshTree(activeProjectId);
    }, [activeProjectId]);

    useEffect(() => {
        if (!activeProject || !searchState.query.trim()) {
            setSearchState((previous) => ({
                ...previous,
                loading: false,
                error: null,
                matches: [],
            }));
            return;
        }

        let disposed = false;
        const query = searchState.query.trim();
        const mode = searchState.mode;
        setSearchState((previous) => ({
            ...previous,
            loading: true,
            error: null,
        }));

        const timer = window.setTimeout(() => {
            void searchProjectReader(activeProject.id, query, mode, PROJECT_READER_SEARCH_LIMIT)
                .then((response) => {
                    if (disposed) {
                        return;
                    }
                    setSearchState((previous) => ({
                        ...previous,
                        loading: false,
                        error: null,
                        matches: response.matches,
                    }));
                })
                .catch((searchError) => {
                    if (disposed) {
                        return;
                    }
                    setSearchState((previous) => ({
                        ...previous,
                        loading: false,
                        error: searchError instanceof Error ? searchError.message : String(searchError),
                        matches: [],
                    }));
                });
        }, 220);

        return () => {
            disposed = true;
            window.clearTimeout(timer);
        };
    }, [activeProject?.id, searchState.query, searchState.mode]);

    useEffect(() => {
        if (!searchModeMenuOpen) {
            return;
        }

        const handlePointerDown = (event: PointerEvent): void => {
            const target = event.target as Element | null;
            if (target?.closest(".project-reader-search-mode-picker")) {
                return;
            }
            setSearchModeMenuOpen(false);
        };
        const handleKeyDown = (event: KeyboardEvent): void => {
            if (event.key === "Escape") {
                setSearchModeMenuOpen(false);
            }
        };

        document.addEventListener("pointerdown", handlePointerDown, true);
        document.addEventListener("keydown", handleKeyDown, true);
        return () => {
            document.removeEventListener("pointerdown", handlePointerDown, true);
            document.removeEventListener("keydown", handleKeyDown, true);
        };
    }, [searchModeMenuOpen]);

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
        reportProjectReaderTabBacklinkTarget(tab);
    };

    const handleOpenSearchMatch = (match: ProjectReaderSearchMatch): void => {
        if (!activeProject) {
            return;
        }

        setActivePath(match.relativePath);
        if (props.context.workbenchApi) {
            openProjectReaderLocationInWorkbench(props.context.workbenchApi, {
                projectId: activeProject.id,
                projectName: activeProject.name,
                rootPath: activeProject.rootPath,
                relativePath: match.relativePath,
                lineNumber: match.lineNumber,
                columnNumber: match.columnNumber,
                endLineNumber: match.endLineNumber,
                endColumnNumber: match.endColumnNumber,
            });
            return;
        }

        const tab = buildProjectReaderTabDefinition({
            projectId: activeProject.id,
            projectName: activeProject.name,
            rootPath: activeProject.rootPath,
            relativePath: match.relativePath,
            lineNumber: match.lineNumber,
            columnNumber: match.columnNumber,
            endLineNumber: match.endLineNumber,
            endColumnNumber: match.endColumnNumber,
        });
        props.context.openTab(tab);
        reportProjectReaderTabBacklinkTarget(tab);
    };

    const isSearching = searchState.query.trim().length > 0;
    const activeSearchMode = PROJECT_READER_SEARCH_MODES.find((item) => item.mode === searchState.mode)
        ?? PROJECT_READER_SEARCH_MODES[0]!;
    const ActiveSearchModeIcon = activeSearchMode.icon;

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

            {activeProject ? (
                <div className="project-reader-search">
                    <div className="project-reader-search-input-wrap">
                        <FileSearch size={13} strokeWidth={1.9} />
                        <input
                            className="project-reader-search-input"
                            value={searchState.query}
                            placeholder={t("projectReader.searchPlaceholder")}
                            aria-label={t("projectReader.searchPlaceholder")}
                            onChange={(event) => {
                                setSearchState((previous) => ({
                                    ...previous,
                                    query: event.target.value,
                                }));
                            }}
                        />
                        <div className="project-reader-search-mode-picker">
                            <button
                                type="button"
                                className={`project-reader-search-mode-button is-${searchState.mode}`}
                                title={t(`projectReader.searchMode.${searchState.mode}`)}
                                aria-label={t("projectReader.searchModeLabel")}
                                aria-haspopup="menu"
                                aria-expanded={searchModeMenuOpen}
                                onClick={() => {
                                    setSearchModeMenuOpen((open) => !open);
                                }}
                            >
                                <ActiveSearchModeIcon size={14} strokeWidth={2} />
                                <ChevronsUpDown size={11} strokeWidth={2} />
                            </button>
                            {searchModeMenuOpen ? (
                                <div className="project-reader-search-mode-menu" role="menu">
                                    {PROJECT_READER_SEARCH_MODES.map(({ mode, icon: ModeIcon }) => (
                                        <button
                                            key={mode}
                                            type="button"
                                            role="menuitemradio"
                                            aria-checked={searchState.mode === mode}
                                            className={[
                                                "project-reader-search-mode-menu-item",
                                                searchState.mode === mode ? "is-active" : "",
                                                `is-${mode}`,
                                            ].filter(Boolean).join(" ")}
                                            onClick={() => {
                                                setSearchState((previous) => ({
                                                    ...previous,
                                                    mode,
                                                }));
                                                setSearchModeMenuOpen(false);
                                            }}
                                        >
                                            <ModeIcon size={14} strokeWidth={2} />
                                            <span>{t(`projectReader.searchMode.${mode}`)}</span>
                                        </button>
                                    ))}
                                </div>
                            ) : null}
                        </div>
                    </div>
                </div>
            ) : null}

            {error ? (
                <div className="project-reader-panel-state is-error">{error}</div>
            ) : null}

            {searchState.error ? (
                <div className="project-reader-panel-state is-error">{searchState.error}</div>
            ) : null}

            {loadingProjects || loadingTree || searchState.loading ? (
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

            {activeProject && isSearching && !searchState.loading ? (
                <div className="project-reader-search-results">
                    {searchState.matches.length === 0 ? (
                        <div className="project-reader-panel-state">{t("projectReader.noSearchResults")}</div>
                    ) : searchState.matches.map((match, index) => (
                        <button
                            key={`${match.relativePath}:${String(match.lineNumber)}:${String(match.columnNumber)}:${String(index)}`}
                            type="button"
                            className="project-reader-search-result"
                            onClick={() => {
                                handleOpenSearchMatch(match);
                            }}
                        >
                            <span className="project-reader-search-result__path">
                                {match.relativePath}:{match.lineNumber}
                            </span>
                            <span className="project-reader-search-result__kind">
                                {match.kind}
                            </span>
                            <span className="project-reader-search-result__preview">
                                {match.preview}
                            </span>
                        </button>
                    ))}
                </div>
            ) : null}

            {activeProject && !loadingTree && !isSearching ? (
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
