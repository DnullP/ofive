import React from "react";
import { FolderCode } from "lucide-react";
import i18n from "../../i18n";
import { registerPanel } from "../../host/registry/panelRegistry";
import { registerTabComponent } from "../../host/registry/tabComponentRegistry";
import { ProjectReaderPanel } from "./ProjectReaderPanel";
import { ProjectReaderCodeTab } from "./ProjectReaderCodeTab";
import {
    PROJECT_READER_CODE_TAB_COMPONENT_ID,
    PROJECT_READER_PANEL_ID,
} from "./projectReaderLinks";

export function activatePlugin(): () => void {
    const unregisterPanel = registerPanel({
        id: PROJECT_READER_PANEL_ID,
        title: () => i18n.t("projectReader.panelTitle"),
        icon: React.createElement(FolderCode, { size: 18, strokeWidth: 1.8 }),
        activityId: "files",
        defaultPosition: "left",
        defaultOrder: 2,
        render: (context) => React.createElement(ProjectReaderPanel, { context }),
    });

    const unregisterTab = registerTabComponent({
        id: PROJECT_READER_CODE_TAB_COMPONENT_ID,
        component: ProjectReaderCodeTab as any,
        lifecycleScope: "global",
    });

    console.info("[projectReaderPlugin] registered project reader plugin");

    return () => {
        unregisterTab();
        unregisterPanel();
        console.info("[projectReaderPlugin] unregistered project reader plugin");
    };
}
