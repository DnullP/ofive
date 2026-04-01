/**
 * @module plugins/custom-activity/customActivityPlugin
 * @description 自定义 activity 插件。
 *   该插件提供三项能力：
 *   1. 注册全局命令，打开自定义 activity 创建 modal
 *   2. 监听 VaultConfig 中的自定义 activity 配置，并动态注册/注销 activity 与 panel
 *   3. 以 overlay 方式渲染创建 modal
 *
 * @dependencies
 *   - react
 *   - ../../host/commands/commandSystem
 *   - ../../host/registry
 *   - ../../host/config/configStore
 *   - ./customActivityConfig
 *   - ./customActivityEvents
 *   - ./iconCatalog
 *   - ./CustomActivityModal
 *
 * @exports
 *   - activatePlugin
 */

import React from "react";
import { registerCommand } from "../../host/commands/commandSystem";
import { subscribeCustomActivityRemovalRequestedEvent } from "../../host/events/appEventBus";
import {
    registerActivity,
    registerOverlay,
    type ActivityDescriptor,
} from "../../host/registry";
import { getConfigSnapshot, subscribeConfigChanges } from "../../host/config/configStore";
import { CustomActivityModal } from "./CustomActivityModal";
import { requestCustomActivityModalOpen } from "./customActivityEvents";
import {
    CUSTOM_ACTIVITY_CONFIG_KEY,
    getCustomActivitiesFromVaultConfig,
    removeCustomActivityFromVaultConfig,
    type CustomActivityDefinition,
} from "./customActivityConfig";
import { renderCustomActivityIcon } from "./iconCatalog";

const CUSTOM_ACTIVITY_CREATE_COMMAND_ID = "customActivity.create";

/**
 * @function toActivityRegistrationId
 * @description 生成注册用 activity id，避免与内置 activity 冲突。
 * @param item 自定义 activity。
 * @returns activity id。
 */
function toActivityRegistrationId(item: CustomActivityDefinition): string {
    return `custom-activity:${item.id}`;
}

/**
 * @function buildActivityDescriptor
 * @description 将配置项转换为 activity 注册描述。
 * @param item 配置项。
 * @returns 注册描述。
 */
function buildActivityDescriptor(item: CustomActivityDefinition): ActivityDescriptor {
    const activityId = toActivityRegistrationId(item);
    if (item.kind === "callback") {
        return {
            type: "callback",
            id: activityId,
            title: item.name,
            icon: renderCustomActivityIcon(item.iconKey),
            defaultSection: item.defaultSection,
            defaultBar: item.defaultBar,
            defaultOrder: item.defaultOrder,
            onActivate: (context) => {
                if (!item.commandId) {
                    console.warn("[custom-activity] callback activation skipped: missing commandId", {
                        activityId,
                    });
                    return;
                }
                context.executeCommand(item.commandId);
            },
        };
    }

    return {
        type: "panel-container",
        id: activityId,
        title: item.name,
        icon: renderCustomActivityIcon(item.iconKey),
        defaultSection: item.defaultSection,
        defaultBar: item.defaultBar,
        defaultOrder: item.defaultOrder,
    };
}

/**
 * @function activatePlugin
 * @description 激活自定义 activity 插件。
 * @returns 清理函数。
 */
export function activatePlugin(): () => void {
    const unregisterCommand = registerCommand({
        id: CUSTOM_ACTIVITY_CREATE_COMMAND_ID,
        title: "customActivity.openCommand",
        execute: () => {
            requestCustomActivityModalOpen();
        },
    });

    const unregisterOverlay = registerOverlay({
        id: "custom-activity-create-modal",
        order: 45,
        render: (context) => React.createElement(CustomActivityModal, context),
    });

    const dynamicCleanup = new Map<string, () => void>();

    const getCustomActivitiesConfigSignature = (): string => {
        const backendConfig = getConfigSnapshot().backendConfig;
        const rawValue = backendConfig?.entries?.[CUSTOM_ACTIVITY_CONFIG_KEY] ?? null;
        return JSON.stringify(rawValue);
    };

    const rerenderRuntimeActivities = (): void => {
        dynamicCleanup.forEach((dispose) => {
            dispose();
        });
        dynamicCleanup.clear();

        const items = getCustomActivitiesFromVaultConfig(getConfigSnapshot().backendConfig);
        items.forEach((item) => {
            const activityId = toActivityRegistrationId(item);
            const activityDispose = registerActivity(buildActivityDescriptor(item));
            dynamicCleanup.set(`activity:${activityId}`, activityDispose);
        });

        console.info("[custom-activity] runtime registrations refreshed", {
            itemCount: items.length,
        });
    };

    rerenderRuntimeActivities();
    let lastCustomActivitiesConfigSignature = getCustomActivitiesConfigSignature();

    const unsubscribeConfig = subscribeConfigChanges(() => {
        const nextSignature = getCustomActivitiesConfigSignature();
        if (nextSignature === lastCustomActivitiesConfigSignature) {
            return;
        }

        lastCustomActivitiesConfigSignature = nextSignature;
        rerenderRuntimeActivities();
    });

    const unsubscribeRemovalRequest = subscribeCustomActivityRemovalRequestedEvent((payload) => {
        void removeCustomActivityFromVaultConfig(payload.activityConfigId).catch((error) => {
            console.error("[custom-activity] remove requested activity failed", {
                activityConfigId: payload.activityConfigId,
                error: error instanceof Error ? error.message : String(error),
            });
        });
    });

    console.info("[custom-activity] plugin activated");

    return () => {
        unsubscribeRemovalRequest();
        unsubscribeConfig();
        dynamicCleanup.forEach((dispose) => {
            dispose();
        });
        dynamicCleanup.clear();
        unregisterOverlay();
        unregisterCommand();
        console.info("[custom-activity] plugin disposed");
    };
}