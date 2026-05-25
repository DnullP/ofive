/**
 * @module plugins/tasks/task-board/taskBoardColumns.test
 * @description 任务看板列模型测试：覆盖自定义列过滤、默认分桶和列宽归一化。
 * @dependencies
 *  - bun:test
 *  - ./taskBoardColumns
 */

import { describe, expect, it } from "bun:test";
import type { VaultTaskItem } from "../../../api/vaultApi";
import {
    buildTaskBoardColumns,
    normalizeTaskBoardColumnWidth,
    type TaskBoardCustomColumn,
} from "./taskBoardColumns";

const TASKS: VaultTaskItem[] = [
    {
        relativePath: "Projects/Game Theory/tasks.md",
        title: "tasks",
        line: 3,
        rawLine: "- [ ] Read chapter #study start:2026-05-20 09:00 end:2026-05-24 18:00 !high",
        checked: false,
        content: "Read chapter #study",
        start: "2026-05-20 09:00",
        end: "2026-05-24 18:00",
        priority: "high",
    },
    {
        relativePath: "Areas/Work/plan.md",
        title: "plan",
        line: 8,
        rawLine: "- [ ] Ship board #work end:2026-06-01 12:00 !medium",
        checked: false,
        content: "Ship board #work",
        end: "2026-06-01 12:00",
        priority: "medium",
    },
    {
        relativePath: "Archive/done.md",
        title: "done",
        line: 1,
        rawLine: "- [x] Old task #work @2026-05-01 !low",
        checked: true,
        content: "Old task #work",
        due: "2026-05-01",
        priority: "low",
    },
];

describe("taskBoardColumns", () => {
    it("应按默认优先级列分桶并应用状态过滤", () => {
        const columns = buildTaskBoardColumns(TASKS, "open", []);

        expect(columns.find((column) => column.id === "high")?.tasks).toHaveLength(1);
        expect(columns.find((column) => column.id === "medium")?.tasks).toHaveLength(1);
        expect(columns.find((column) => column.id === "low")?.tasks).toHaveLength(0);
    });

    it("应支持自定义列按目录和 tag 组合过滤", () => {
        const customColumn: TaskBoardCustomColumn = {
            id: "custom-study",
            name: "Study",
            matchMode: "all",
            conditions: [
                {
                    id: "directory",
                    field: "directory",
                    operator: "contains",
                    value: "Projects",
                },
                {
                    id: "tag",
                    field: "tag",
                    operator: "equals",
                    value: "study",
                },
            ],
        };

        const columns = buildTaskBoardColumns(TASKS, "all", [customColumn]);
        const custom = columns[columns.length - 1];

        expect(custom?.tasks.map((task) => task.content)).toEqual(["Read chapter #study"]);
    });

    it("应支持自定义列按截止日期字段过滤", () => {
        const customColumn: TaskBoardCustomColumn = {
            id: "custom-deadline",
            name: "May deadlines",
            matchMode: "all",
            conditions: [{
                id: "deadline",
                field: "deadline",
                operator: "before",
                value: "2026-05-31",
            }],
        };

        const columns = buildTaskBoardColumns(TASKS, "open", [customColumn]);
        const custom = columns[columns.length - 1];

        expect(custom?.tasks.map((task) => task.content)).toEqual(["Read chapter #study"]);
    });

    it("应允许自定义配置覆盖默认优先级列", () => {
        const customColumn: TaskBoardCustomColumn = {
            id: "high",
            name: "Work lane",
            matchMode: "all",
            conditions: [{
                id: "tag",
                field: "tag",
                operator: "equals",
                value: "work",
            }],
        };

        const columns = buildTaskBoardColumns(TASKS, "open", [customColumn]);
        const high = columns.find((column) => column.id === "high");

        expect(high?.title).toBe("Work lane");
        expect(high?.tasks.map((task) => task.content)).toEqual(["Ship board #work"]);
        expect(columns.filter((column) => column.id === "high")).toHaveLength(1);
    });

    it("应归一化列宽到允许范围", () => {
        expect(normalizeTaskBoardColumnWidth(120)).toBe(190);
        expect(normalizeTaskBoardColumnWidth(900)).toBe(560);
        expect(normalizeTaskBoardColumnWidth("333.4")).toBe(333);
        expect(normalizeTaskBoardColumnWidth("oops")).toBe(260);
    });
});
