/**
 * @module host/settings/registrars/frontmatterSettingsRegistrar
 * @description Frontmatter 模板设置注册：注册"Frontmatter"分类及模板编辑器。
 * @dependencies
 *  - ../../config/configStore
 *  - ../settingsRegistry
 */

import { useRef, type ChangeEvent } from "react";
import { useTranslation } from "react-i18next";
import { updateFeatureSetting, useConfigState } from "../../config/configStore";
import { registerSettingsItems, registerSettingsSection } from "../settingsRegistry";

/**
 * @function FrontmatterTemplateEditor
 * @description Frontmatter 模板文本编辑器组件。
 */
function FrontmatterTemplateEditor(): JSX.Element {
    const { t } = useTranslation();
    const template = useConfigState().featureSettings.frontmatterTemplate;
    const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    const handleChange = (event: ChangeEvent<HTMLTextAreaElement>): void => {
        const nextValue = event.target.value;
        if (timerRef.current !== null) {
            clearTimeout(timerRef.current);
        }
        timerRef.current = setTimeout(() => {
            timerRef.current = null;
            void updateFeatureSetting("frontmatterTemplate", nextValue);
        }, 400);
    };

    return (
        <div className="settings-compact-row-column">
            <div className="settings-compact-info">
                <span className="settings-compact-title">{t("settings.frontmatterTemplate")}</span>
                <span className="settings-compact-desc">{t("settings.frontmatterTemplateDesc")}</span>
            </div>
            <textarea
                className="settings-frontmatter-template-textarea"
                defaultValue={template}
                placeholder={t("settings.frontmatterTemplatePlaceholder")}
                rows={6}
                spellCheck={false}
                onChange={handleChange}
            />
        </div>
    );
}

export function registerFrontmatterSettingsSection(): () => void {
    const unregisterSection = registerSettingsSection({
        id: "frontmatter-template",
        title: "settings.frontmatterSection",
        order: 25,
        description: "settings.frontmatterSectionDesc",
        searchTerms: ["frontmatter", "template", "yaml", "模板", "元数据"],
    });

    const unregisterItems = registerSettingsItems([
        {
            id: "frontmatter-template-editor",
            sectionId: "frontmatter-template",
            order: 10,
            kind: "custom",
            title: "settings.frontmatterTemplate",
            searchTerms: ["frontmatter", "template", "filename", "date", "directory", "模板", "日期", "文件名", "目录"],
            render: () => <FrontmatterTemplateEditor />,
        },
    ]);

    return () => {
        unregisterItems();
        unregisterSection();
    };
}
