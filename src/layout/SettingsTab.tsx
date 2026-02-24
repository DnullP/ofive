/**
 * @module layout/SettingsTab
 * @description 设置页 Tab：基于注册中心动态渲染“左侧选栏 + 右侧设置项”。
 * @dependencies
 *  - react
 *  - ../settings/settingsRegistry
 *  - ../settings/registerBuiltinSettings
 */

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { ensureBuiltinSettingsRegistered } from "../settings/registerBuiltinSettings";
import { useSettingsSections } from "../settings/settingsRegistry";
import "./SettingsTab.css";

ensureBuiltinSettingsRegistered();

/**
 * @function SettingsTab
 * @description 渲染设置页 Tab。
 * @returns React 节点。
 */
export function SettingsTab(): ReactNode {
    const sections = useSettingsSections();
    const [activeSectionId, setActiveSectionId] = useState<string>("");

    const activeSection = useMemo(
        () => sections.find((section) => section.id === activeSectionId) ?? sections[0],
        [sections, activeSectionId],
    );

    useEffect(() => {
        if (sections.length === 0) {
            if (activeSectionId !== "") {
                setActiveSectionId("");
            }
            return;
        }

        const currentExists = sections.some((section) => section.id === activeSectionId);
        if (!currentExists) {
            setActiveSectionId(sections[0].id);
        }
    }, [sections, activeSectionId]);

    return (
        <div className="settings-tab">
            <aside className="settings-tab-sidebar">
                {sections.map((section) => (
                    <button
                        key={section.id}
                        type="button"
                        className={`settings-tab-sidebar-item ${section.id === activeSection?.id ? "active" : ""}`}
                        onClick={() => {
                            setActiveSectionId(section.id);
                        }}
                    >
                        {section.title}
                    </button>
                ))}
            </aside>

            <section className="settings-tab-content">
                <header className="settings-tab-content-header">设置</header>

                {activeSection ? activeSection.render() : (
                    <div className="settings-item-group">
                        <div className="settings-item">
                            <div>
                                <div className="settings-item-title">暂无可用设置项</div>
                                <div className="settings-item-desc">尚未注册设置选栏，请检查注册流程。</div>
                            </div>
                        </div>
                    </div>
                )}
            </section>
        </div>
    );
}
