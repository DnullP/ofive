import { type CSSProperties, type FormEvent, type ReactNode, useEffect, useMemo, useState } from "react";
import { FileText, Folder, Lock, Plus, X } from "lucide-react";
import {
    createAgentSkill,
    listAgentSkills,
    readAgentSkillFile,
    type AgentSkillSummary,
} from "../../api/vaultApi";
import type { PanelRenderContext } from "../../host/layout/workbenchContracts";
import i18n from "../../i18n";
import "./agentSkillsPlugin.css";

function buildDraftSkillName(value: string): string {
    return value
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9-]+/g, "-")
        .replace(/-+/g, "-")
        .replace(/^-|-$/g, "");
}

function joinSkillFilePath(skill: AgentSkillSummary, filePath: string): string {
    const directory = skill.directoryRelativePath || `.ofive/skills/${skill.name}`;
    return `${directory.replace(/\/+$/u, "")}/${filePath.replace(/^\/+/u, "")}`;
}

function isReadOnlySkill(skill: AgentSkillSummary): boolean {
    return skill.builtIn === true || skill.readOnly === true;
}

interface AgentSkillTreeNode {
    name: string;
    path: string;
    kind: "directory" | "file";
    children: AgentSkillTreeNode[];
}

function sortTreeNodes(nodes: AgentSkillTreeNode[]): AgentSkillTreeNode[] {
    return nodes
        .map((node) => ({
            ...node,
            children: sortTreeNodes(node.children),
        }))
        .sort((left, right) => {
            if (left.kind !== right.kind) {
                return left.kind === "directory" ? -1 : 1;
            }
            return left.name.localeCompare(right.name);
        });
}

function buildSkillFileTree(files: AgentSkillSummary["files"]): AgentSkillTreeNode[] {
    const root: AgentSkillTreeNode[] = [];

    for (const file of files) {
        const parts = file.relativePath
            .replace(/\\/gu, "/")
            .split("/")
            .filter(Boolean);
        let currentLevel = root;
        let accumulatedPath = "";

        parts.forEach((part, index) => {
            accumulatedPath = accumulatedPath ? `${accumulatedPath}/${part}` : part;
            const kind: AgentSkillTreeNode["kind"] = index === parts.length - 1 ? "file" : "directory";
            let node = currentLevel.find((item) => item.name === part && item.kind === kind);

            if (!node) {
                node = {
                    name: part,
                    path: accumulatedPath,
                    kind,
                    children: [],
                };
                currentLevel.push(node);
            }

            currentLevel = node.children;
        });
    }

    return sortTreeNodes(root);
}

function treeRowStyle(depth: number): CSSProperties {
    return { "--agent-skill-tree-indent": `${8 + depth * 14}px` } as CSSProperties;
}

interface AgentSkillsPanelProps {
    context: PanelRenderContext;
}

export function AgentSkillsPanel({ context }: AgentSkillsPanelProps): ReactNode {
    const [skills, setSkills] = useState<AgentSkillSummary[]>([]);
    const [selectedSkillName, setSelectedSkillName] = useState<string>("");
    const [activeFilePath, setActiveFilePath] = useState<string>("");
    const [isCreateOpen, setIsCreateOpen] = useState<boolean>(false);
    const [newSkillName, setNewSkillName] = useState<string>("");
    const [newSkillDescription, setNewSkillDescription] = useState<string>("");
    const [isLoading, setIsLoading] = useState<boolean>(false);
    const [isSaving, setIsSaving] = useState<boolean>(false);
    const [openingFilePath, setOpeningFilePath] = useState<string>("");
    const [message, setMessage] = useState<string>("");

    const selectedSkill = useMemo(
        () => skills.find((item) => item.name === selectedSkillName) ?? null,
        [selectedSkillName, skills],
    );

    const selectedFileTree = useMemo(
        () => buildSkillFileTree(selectedSkill?.files ?? []),
        [selectedSkill],
    );

    const refresh = async (preferredSkillName?: string): Promise<void> => {
        setIsLoading(true);
        setMessage("");
        try {
            const nextSkills = await listAgentSkills();
            setSkills(nextSkills);
            const nextSelected = nextSkills.find((item) => item.name === (preferredSkillName ?? selectedSkillName))
                ?? nextSkills[0]
                ?? null;
            setSelectedSkillName(nextSelected?.name ?? "");
            setActiveFilePath((current) => {
                if (nextSelected?.files.some((item) => item.relativePath === current)) {
                    return current;
                }
                return "";
            });
        } catch (error) {
            setMessage(error instanceof Error ? error.message : i18n.t("agentSkills.loadFailed"));
        } finally {
            setIsLoading(false);
        }
    };

    useEffect(() => {
        void refresh();
    }, []);

    const closeCreateModal = (): void => {
        setIsCreateOpen(false);
        setNewSkillName("");
        setNewSkillDescription("");
    };

    const handleCreateSkill = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
        event.preventDefault();
        const skillName = buildDraftSkillName(newSkillName);
        const description = newSkillDescription.trim();
        if (!skillName || !description) {
            setMessage(i18n.t("agentSkills.createValidation"));
            return;
        }
        setIsSaving(true);
        try {
            const created = await createAgentSkill(skillName, description);
            await refresh(created.name);
            setSelectedSkillName(created.name);
            setActiveFilePath("");
            closeCreateModal();
            setMessage(i18n.t("agentSkills.created"));
        } catch (error) {
            setMessage(error instanceof Error ? error.message : i18n.t("agentSkills.createFailed"));
        } finally {
            setIsSaving(false);
        }
    };

    const handleOpenFile = async (filePath: string): Promise<void> => {
        if (!selectedSkill) {
            return;
        }

        setOpeningFilePath(filePath);
        try {
            const response = await readAgentSkillFile(selectedSkill.name, filePath);
            const readOnly = isReadOnlySkill(selectedSkill);
            await context.openFile({
                relativePath: joinSkillFilePath(selectedSkill, filePath),
                contentOverride: response.content,
                tabParams: readOnly
                    ? {
                        readOnly: true,
                        forceDisplayMode: "read",
                        initialDisplayMode: "read",
                    }
                    : undefined,
            });
            setActiveFilePath(filePath);
            setMessage("");
        } catch (error) {
            setMessage(error instanceof Error ? error.message : i18n.t("agentSkills.openFailed"));
        } finally {
            setOpeningFilePath("");
        }
    };

    const renderTreeNodes = (nodes: AgentSkillTreeNode[], depth = 0): ReactNode => nodes.map((node) => {
        if (node.kind === "directory") {
            return (
                <div key={node.path} className="agent-skills-tree-group">
                    <div className="agent-skills-tree-row is-directory" style={treeRowStyle(depth)}>
                        <Folder size={14} />
                        <span>{node.name}</span>
                    </div>
                    {renderTreeNodes(node.children, depth + 1)}
                </div>
            );
        }

        return (
            <button
                type="button"
                key={node.path}
                className={node.path === activeFilePath ? "agent-skills-tree-row is-file is-active" : "agent-skills-tree-row is-file"}
                style={treeRowStyle(depth)}
                data-agent-skill-file-path={node.path}
                onClick={() => void handleOpenFile(node.path)}
                disabled={openingFilePath === node.path}
            >
                <FileText size={14} />
                <span>{node.name}</span>
            </button>
        );
    });

    return (
        <div className="agent-skills-panel">
            <section className="agent-skills-section agent-skills-top-section">
                <div className="agent-skills-section-header">
                    <span>{i18n.t("agentSkills.skillList")}</span>
                    <button
                        type="button"
                        className="agent-skills-icon-button agent-skills-add-button"
                        title={i18n.t("agentSkills.addSkill")}
                        aria-label={i18n.t("agentSkills.addSkill")}
                        onClick={() => setIsCreateOpen(true)}
                    >
                        <Plus size={15} />
                    </button>
                </div>
                <div className="agent-skills-skill-list" aria-label={i18n.t("agentSkills.skillList")}>
                    {skills.length === 0 ? (
                        <div className="agent-skills-empty">{isLoading ? i18n.t("common.loading") : i18n.t("agentSkills.empty")}</div>
                    ) : skills.map((skill) => {
                        const readOnly = isReadOnlySkill(skill);
                        return (
                            <button
                                type="button"
                                key={skill.name}
                                className={skill.name === selectedSkillName ? "agent-skills-skill-row is-selected" : "agent-skills-skill-row"}
                                data-agent-skill-name={skill.name}
                                data-agent-skill-read-only={readOnly ? "true" : undefined}
                                onClick={() => {
                                    setSelectedSkillName(skill.name);
                                    setActiveFilePath("");
                                }}
                            >
                                <span className="agent-skills-skill-copy">
                                    <span className="agent-skills-skill-name">{skill.name}</span>
                                    {skill.description ? <span className="agent-skills-skill-description">{skill.description}</span> : null}
                                </span>
                                {readOnly ? (
                                    <span className="agent-skills-skill-badge" title={i18n.t("agentSkills.builtInReadOnly")}>
                                        <Lock size={11} />
                                        <span>{i18n.t("agentSkills.builtIn")}</span>
                                    </span>
                                ) : null}
                                {!skill.valid ? <strong title={i18n.t("agentSkills.invalidSkill")}>!</strong> : null}
                            </button>
                        );
                    })}
                </div>
            </section>

            <section className="agent-skills-section agent-skills-bottom-section">
                <div className="agent-skills-section-header">
                    <span>{i18n.t("agentSkills.fileTree")}</span>
                </div>
                <div className="agent-skills-file-tree" aria-label={i18n.t("agentSkills.fileTree")}>
                    {!selectedSkill ? (
                        <div className="agent-skills-empty">{i18n.t("agentSkills.empty")}</div>
                    ) : selectedFileTree.length === 0 ? (
                        <div className="agent-skills-empty">{i18n.t("agentSkills.noFiles")}</div>
                    ) : (
                        renderTreeNodes(selectedFileTree)
                    )}
                </div>
            </section>

            {selectedSkill?.error ? <div className="agent-skills-warning">{selectedSkill.error}</div> : null}
            {message ? <div className="agent-skills-status">{message}</div> : null}

            {isCreateOpen ? (
                <div
                    className="agent-skills-modal-backdrop"
                    role="presentation"
                    onMouseDown={(event) => {
                        if (event.target === event.currentTarget) {
                            closeCreateModal();
                        }
                    }}
                >
                    <form className="agent-skills-create-modal" onSubmit={(event) => void handleCreateSkill(event)}>
                        <div className="agent-skills-modal-header">
                            <span>{i18n.t("agentSkills.createDialogTitle")}</span>
                            <button
                                type="button"
                                className="agent-skills-icon-button"
                                title={i18n.t("common.close")}
                                aria-label={i18n.t("common.close")}
                                onClick={closeCreateModal}
                            >
                                <X size={15} />
                            </button>
                        </div>
                        <label className="agent-skills-field">
                            <span>{i18n.t("agentSkills.nameLabel")}</span>
                            <input
                                data-testid="agent-skills-name-input"
                                value={newSkillName}
                                onChange={(event) => setNewSkillName(event.target.value)}
                                placeholder={i18n.t("agentSkills.namePlaceholder")}
                                autoFocus
                            />
                        </label>
                        <label className="agent-skills-field">
                            <span>{i18n.t("agentSkills.descriptionLabel")}</span>
                            <textarea
                                data-testid="agent-skills-description-input"
                                value={newSkillDescription}
                                onChange={(event) => setNewSkillDescription(event.target.value)}
                                placeholder={i18n.t("agentSkills.descriptionPlaceholder")}
                                rows={4}
                            />
                        </label>
                        <div className="agent-skills-modal-actions">
                            <button type="button" className="agent-skills-secondary-button" onClick={closeCreateModal}>
                                {i18n.t("common.cancel")}
                            </button>
                            <button type="submit" className="agent-skills-primary-button" disabled={isSaving}>
                                {i18n.t("agentSkills.createSkill")}
                            </button>
                        </div>
                    </form>
                </div>
            ) : null}
        </div>
    );
}
