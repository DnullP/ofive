/**
 * @module host/settings/SettingsRegisteredSection.test
 * @description SettingsRegisteredSection 测试：验证中心化 settings item 渲染器会消费 section snapshot 并输出标准项与自定义项。
 */

import { afterEach, describe, expect, mock, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

const SETTINGS_REGISTERED_SECTION_CUSTOM_PANEL = "custom-settings-panel";

mock.module("react-i18next", () => ({
    useTranslation: () => ({
        t: (key: string) => key,
    }),
}));

afterEach(() => {
    mock.restore();
});

describe("SettingsRegisteredSection", () => {
    test("应渲染标准 settings item 与 custom item", async () => {
        const { SettingsRegisteredSection } = await import("./SettingsRegisteredSection");

        const markup = renderToStaticMarkup(
            <SettingsRegisteredSection
                section={{
                    id: "demo",
                    title: "settings.demoSection",
                    order: 10,
                    items: [
                        {
                            id: "toggle-enabled",
                            sectionId: "demo",
                            order: 10,
                            kind: "toggle",
                            title: "settings.demoToggle",
                            description: "settings.demoToggleDesc",
                            useValue: () => true,
                            updateValue: () => undefined,
                        },
                        {
                            id: "custom-panel",
                            sectionId: "demo",
                            order: 20,
                            kind: "custom",
                            title: "settings.demoCustom",
                            render: () => <div>{SETTINGS_REGISTERED_SECTION_CUSTOM_PANEL}</div>,
                        },
                    ],
                }}
            />, 
        );

        expect(markup).toContain("settings.demoToggle");
        expect(markup).toContain("settings.demoToggleDesc");
        expect(markup).toContain(SETTINGS_REGISTERED_SECTION_CUSTOM_PANEL);
    });
});