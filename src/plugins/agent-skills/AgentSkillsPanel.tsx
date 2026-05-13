import { type ReactNode, useEffect, useMemo, useState } from "react";
import { FilePlus2, FolderPlus, RefreshCw, Save } from "lucide-react";
import {
    createAgentSkill,
    listAgentSkills,
    readAgentSkillFile,
    writeAgentSkillFile,
    type AgentSkillSummary,
} from "../../api/vaultApi";
import i18n from "../../i18n";
import "./agentSkillsPlugin.css";

const DEFAULT_REFERENCE_PATH = "references/context.md";

function buildDraftSkillName(value: string): string {
    return value
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9-]+/g, "-")
        .replace(/-+/g, "-")
        .replace(/^-|-$/g, "");
}

function firstEditableFile(skill: AgentSkillSummary | null): string {
    if (!skill) {
        return "SKILL.md";
    }
    return skill.files.find((item) => item.relativePath === "SKILL.md")?.relativePath
        ?? skill.files[0]?.relativePath
        ?? "SKILL.md";
}

export function AgentSkillsPanel(): ReactNode {
    const [skills, setSkills] = useState<AgentSkillSummary[]>([]);
    const [selectedSkillName, setSelectedSkillName] = useState<string>("");
    const [selectedFilePath, setSelectedFilePath] = useState<string>("SKILL.md");
    const [content, setContent] = useState<string>("");
    const [newSkillName, setNewSkillName] = useState<string>("");
    const [newSkillDescription, setNewSkillDescription] = useState<string>("");
    const [newReferencePath, setNewReferencePath] = useState<string>(DEFAULT_REFERENCE_PATH);
    const [isLoading, setIsLoading] = useState<boolean>(false);
    const [isSaving, setIsSaving] = useState<boolean>(false);
    const [message, setMessage] = useState<string>("");

    const selectedSkill = useMemo(
        () => skills.find((item) => item.name === selectedSkillName) ?? null,
        [selectedSkillName, skills],
    );

    const refresh = async (): Promise<void> => {
        setIsLoading(true);
        setMessage("");
        try {
            const nextSkills = await listAgentSkills();
            setSkills(nextSkills);
            const nextSelected = nextSkills.find((item) => item.name === selectedSkillName) ?? nextSkills[0] ?? null;
            setSelectedSkillName(nextSelected?.name ?? "");
            if (nextSelected) {
                setSelectedFilePath((current) => {
                    if (nextSelected.files.some((item) => item.relativePath === current)) {
                        return current;
                    }
                    return firstEditableFile(nextSelected);
                });
            }
        } catch (error) {
            setMessage(error instanceof Error ? error.message : i18n.t("agentSkills.loadFailed"));
        } finally {
            setIsLoading(false);
        }
    };

    useEffect(() => {
        void refresh();
    }, []);

    useEffect(() => {
        if (!selectedSkillName || !selectedFilePath) {
            setContent("");
            return;
        }
        let cancelled = false;
        setIsLoading(true);
        readAgentSkillFile(selectedSkillName, selectedFilePath)
            .then((result) => {
                if (!cancelled) {
                    setContent(result.content);
                    setMessage("");
                }
            })
            .catch((error) => {
                if (!cancelled) {
                    setContent("");
                    setMessage(error instanceof Error ? error.message : i18n.t("agentSkills.loadFailed"));
                }
            })
            .finally(() => {
                if (!cancelled) {
                    setIsLoading(false);
                }
            });
        return () => {
            cancelled = true;
        };
    }, [selectedSkillName, selectedFilePath]);

    const handleCreateSkill = async (): Promise<void> => {
        const skillName = buildDraftSkillName(newSkillName);
        const description = newSkillDescription.trim();
        if (!skillName || !description) {
            setMessage(i18n.t("agentSkills.createValidation"));
            return;
        }
        setIsSaving(true);
        try {
            const created = await createAgentSkill(skillName, description);
            setNewSkillName("");
            setNewSkillDescription("");
            await refresh();
            setSelectedSkillName(created.name);
            setSelectedFilePath("SKILL.md");
            setMessage(i18n.t("agentSkills.created"));
        } catch (error) {
            setMessage(error instanceof Error ? error.message : i18n.t("agentSkills.createFailed"));
        } finally {
            setIsSaving(false);
        }
    };

    const handleSave = async (): Promise<void> => {
        if (!selectedSkillName || !selectedFilePath) {
            return;
        }
        setIsSaving(true);
        try {
            await writeAgentSkillFile(selectedSkillName, selectedFilePath, content);
            await refresh();
            setMessage(i18n.t("agentSkills.saved"));
        } catch (error) {
            setMessage(error instanceof Error ? error.message : i18n.t("agentSkills.saveFailed"));
        } finally {
            setIsSaving(false);
        }
    };

    const handleCreateReference = async (): Promise<void> => {
        if (!selectedSkillName) {
            return;
        }
        const relativePath = newReferencePath.trim() || DEFAULT_REFERENCE_PATH;
        setIsSaving(true);
        try {
            await writeAgentSkillFile(selectedSkillName, relativePath, "# Context\n\n");
            await refresh();
            setSelectedFilePath(relativePath);
            setNewReferencePath(DEFAULT_REFERENCE_PATH);
            setMessage(i18n.t("agentSkills.referenceCreated"));
        } catch (error) {
            setMessage(error instanceof Error ? error.message : i18n.t("agentSkills.saveFailed"));
        } finally {
            setIsSaving(false);
        }
    };

    return (
        <div className="agent-skills-panel">
            <div className="agent-skills-toolbar">
                <button type="button" className="agent-skills-icon-button" title={i18n.t("agentSkills.refresh")} onClick={refresh}>
                    <RefreshCw size={15} />
                </button>
                <button type="button" className="agent-skills-icon-button" title={i18n.t("common.save")} onClick={handleSave} disabled={!selectedSkillName || isSaving}>
                    <Save size={15} />
                </button>
            </div>

            <div className="agent-skills-create">
                <input
                    value={newSkillName}
                    onChange={(event) => setNewSkillName(event.target.value)}
                    placeholder={i18n.t("agentSkills.namePlaceholder")}
                />
                <textarea
                    value={newSkillDescription}
                    onChange={(event) => setNewSkillDescription(event.target.value)}
                    placeholder={i18n.t("agentSkills.descriptionPlaceholder")}
                    rows={3}
                />
                <button type="button" onClick={handleCreateSkill} disabled={isSaving}>
                    <FolderPlus size={14} />
                    <span>{i18n.t("agentSkills.createSkill")}</span>
                </button>
            </div>

            <div className="agent-skills-browser">
                <div className="agent-skills-list" aria-label={i18n.t("agentSkills.skillList")}>
                    {skills.length === 0 ? (
                        <div className="agent-skills-empty">{isLoading ? i18n.t("common.loading") : i18n.t("agentSkills.empty")}</div>
                    ) : skills.map((skill) => (
                        <button
                            type="button"
                            key={skill.name}
                            className={skill.name === selectedSkillName ? "is-selected" : ""}
                            onClick={() => {
                                setSelectedSkillName(skill.name);
                                setSelectedFilePath(firstEditableFile(skill));
                            }}
                        >
                            <span>{skill.name}</span>
                            {!skill.valid ? <strong>!</strong> : null}
                        </button>
                    ))}
                </div>

                <div className="agent-skills-files">
                    {selectedSkill?.files.map((file) => (
                        <button
                            type="button"
                            key={file.relativePath}
                            className={file.relativePath === selectedFilePath ? "is-selected" : ""}
                            onClick={() => setSelectedFilePath(file.relativePath)}
                        >
                            {file.relativePath}
                        </button>
                    ))}
                </div>
            </div>

            {selectedSkill ? (
                <div className="agent-skills-reference">
                    <input
                        value={newReferencePath}
                        onChange={(event) => setNewReferencePath(event.target.value)}
                        placeholder={DEFAULT_REFERENCE_PATH}
                    />
                    <button type="button" title={i18n.t("agentSkills.createReference")} onClick={handleCreateReference} disabled={isSaving}>
                        <FilePlus2 size={14} />
                    </button>
                </div>
            ) : null}

            <textarea
                className="agent-skills-editor"
                value={content}
                onChange={(event) => setContent(event.target.value)}
                spellCheck={false}
                disabled={!selectedSkillName}
            />

            {selectedSkill?.error ? <div className="agent-skills-warning">{selectedSkill.error}</div> : null}
            {message ? <div className="agent-skills-status">{message}</div> : null}
        </div>
    );
}
