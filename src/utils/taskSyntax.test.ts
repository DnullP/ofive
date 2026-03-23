/**
 * @module utils/taskSyntax.test
 * @description 任务看板语法工具测试：覆盖解析、重建与文档内替换。
 * @dependencies
 *  - bun:test
 *  - ./taskSyntax
 */

import { describe, expect, it } from "bun:test";
import {
    buildTaskBoardLine,
    dateTimeLocalInputToTaskDue,
    parseTaskBoardLine,
    replaceTaskBoardMetadataInMarkdown,
    taskDueValueToDateTimeLocalInput,
} from "./taskSyntax";

describe("taskSyntax", () => {
    it("应解析带 due 和 priority 的任务行", () => {
        const parsed = parseTaskBoardLine(
            "- [ ] Ship release @2026-03-24 10:00 !high",
        );

        expect(parsed).toEqual({
            indent: "",
            listMarker: "-",
            checked: false,
            content: "Ship release",
            due: "2026-03-24 10:00",
            priority: "high",
            rawLine: "- [ ] Ship release @2026-03-24 10:00 !high",
        });
    });

    it("应兼容旧版反引号元数据语法", () => {
        const parsed = parseTaskBoardLine(
            "- [ ] Legacy task `{$2026-03-24 10:00}` `{$high}` edit",
        );

        expect(parsed?.due).toBe("2026-03-24 10:00");
        expect(parsed?.priority).toBe("high");
    });

    it("应兼容缺少 edit 标记的新语法任务行", () => {
        const parsed = parseTaskBoardLine("- [ ] Ship release @2026-03-24 !high");
        expect(parsed?.content).toBe("Ship release");
        expect(parsed?.due).toBe("2026-03-24");
        expect(parsed?.priority).toBe("high");
    });

    it("应基于新元数据重建任务行", () => {
        const parsed = parseTaskBoardLine("- [x] Archive sprint notes");
        if (!parsed) {
            throw new Error("应成功解析测试任务行");
        }

        expect(buildTaskBoardLine(parsed, {
            due: "2026-03-25 09:00",
            priority: "medium",
        })).toBe("- [x] Archive sprint notes @2026-03-25 09:00 !medium");
    });

    it("应在 Markdown 文档中替换目标任务的元数据", () => {
        const markdown = [
            "# Tasks",
            "- [ ] First task @2026-03-24 10:00 !high",
            "- [ ] Second task",
        ].join("\n");

        const result = replaceTaskBoardMetadataInMarkdown(markdown, {
            line: 3,
            rawLine: "- [ ] Second task",
        }, {
            due: "2026-03-26 08:30",
            priority: "low",
        });

        expect(result.updatedLine).toBe(
            "- [ ] Second task @2026-03-26 08:30 !low",
        );
        expect(result.content).toContain(result.updatedLine);
    });

    it("应在 due 与 datetime-local 之间双向转换", () => {
        expect(taskDueValueToDateTimeLocalInput("2026-03-24 10:15")).toBe("2026-03-24T10:15");
        expect(dateTimeLocalInputToTaskDue("2026-03-24T10:15")).toBe("2026-03-24 10:15");
    });
});