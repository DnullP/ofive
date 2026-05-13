import React from "react";
import { Sparkles } from "lucide-react";
import i18n from "../../i18n";
import { registerPanel } from "../../host/registry/panelRegistry";
import { AgentSkillsPanel } from "./AgentSkillsPanel";

const AGENT_SKILLS_PANEL_ID = "agent-skills";

export function activatePlugin(): () => void {
    const unregisterPanel = registerPanel({
        id: AGENT_SKILLS_PANEL_ID,
        title: () => i18n.t("agentSkills.panelTitle"),
        icon: React.createElement(Sparkles, { size: 18, strokeWidth: 1.8 }),
        activityId: "files",
        defaultPosition: "left",
        defaultOrder: 3,
        render: () => React.createElement(AgentSkillsPanel),
    });

    console.info("[agentSkillsPlugin] registered agent skills panel");

    return () => {
        unregisterPanel();
        console.info("[agentSkillsPlugin] unregistered agent skills panel");
    };
}
