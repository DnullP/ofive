/**
 * @module plugins/knowledge-graph
 * @description 知识图谱插件公共导出：暴露图谱设置定义与图谱 Tab 等插件级公共接口。
 * @dependencies
 *   - ./tab/KnowledgeGraphTab
 *   - ./tab/knowledgeGraphSettings
 */

export { KnowledgeGraphTab } from "./tab/KnowledgeGraphTab";
export {
    DEFAULT_KNOWLEDGE_GRAPH_SETTINGS,
    KNOWLEDGE_GRAPH_SETTING_DEFINITIONS,
    buildKnowledgeGraphConfig,
    mergeKnowledgeGraphSettings,
} from "./tab/knowledgeGraphSettings";
export type {
    KnowledgeGraphSettingDefinition,
    KnowledgeGraphSettingKey,
    KnowledgeGraphSettings,
} from "./tab/knowledgeGraphSettings";