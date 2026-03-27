/**
 * @file scripts/perf-report.mjs
 * @description 性能报告汇总脚本：读取前后端性能结果文件，输出终端摘要并生成可交互 HTML 报告。
 *
 * 输入约定：
 * - `test-results/perf/frontend-*.json`
 * - `test-results/perf/backend-query-bench.jsonl`
 */

import fs from "node:fs";
import path from "node:path";

const workspaceRoot = process.cwd();
const perfRoot = path.join(workspaceRoot, "test-results", "perf");
const backendBenchPath = path.join(perfRoot, "backend-query-bench.jsonl");
const combinedHtmlReportPath = path.join(perfRoot, "index.html");

function safeReadJson(filePath) {
    if (!fs.existsSync(filePath)) {
        return null;
    }

    return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function safeReadFrontendReports(reportRoot) {
    if (!fs.existsSync(reportRoot)) {
        return [];
    }

    return fs
        .readdirSync(reportRoot)
        .filter((fileName) => /^frontend-.*\.json$/i.test(fileName))
        .sort((left, right) => left.localeCompare(right))
        .map((fileName) => ({
            fileName,
            report: safeReadJson(path.join(reportRoot, fileName)),
        }))
        .filter((item) => item.report);
}

function safeReadJsonLines(filePath) {
    if (!fs.existsSync(filePath)) {
        return [];
    }

    return fs
        .readFileSync(filePath, "utf8")
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => JSON.parse(line));
}

function escapeHtml(value) {
    return String(value)
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#39;");
}

function slugify(value) {
    return String(value)
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        || "item";
}

function toDisplayName(metricName) {
    const lastSegment = String(metricName).split(".").pop() ?? metricName;
    return lastSegment.replaceAll("-", " ");
}

function toMetricRecords(frontendReports, backendRecords) {
    const records = [];

    frontendReports.forEach(({ fileName, report }) => {
        const metrics = [
            ...(Array.isArray(report.metrics) ? report.metrics : []),
            ...(Array.isArray(report.derived) ? report.derived : []),
        ];

        metrics.forEach((metric, index) => {
            records.push({
                id: `frontend-${slugify(metric.name)}-${slugify(metric.details?.dataset ?? report.suite ?? fileName)}-${index}`,
                source: "frontend",
                suite: String(report.suite ?? "frontend-report"),
                fileName,
                name: String(metric.name ?? "unknown-metric"),
                displayName: toDisplayName(metric.name ?? "unknown-metric"),
                category: String(metric.category ?? "unknown"),
                runtime: String(metric.runtime ?? "browser"),
                status: String(metric.status ?? "unknown"),
                durationMs: Number(metric.durationMs ?? 0),
                dataset: String(metric.details?.dataset ?? report.suite ?? fileName),
                details: metric.details && typeof metric.details === "object" ? metric.details : {},
                generatedAt: String(report.generatedAt ?? ""),
            });
        });
    });

    backendRecords.forEach((metric, index) => {
        records.push({
            id: `backend-${slugify(metric.name)}-${slugify(metric.details?.dataset ?? "generated")}-${index}`,
            source: "backend",
            suite: "backend-query-bench",
            fileName: path.basename(backendBenchPath),
            name: String(metric.name ?? "unknown-metric"),
            displayName: toDisplayName(metric.name ?? "unknown-metric"),
            category: String(metric.category ?? "backend-bench"),
            runtime: String(metric.runtime ?? "native"),
            status: String(metric.status ?? "unknown"),
            durationMs: Number(metric.durationMs ?? 0),
            dataset: String(metric.details?.dataset ?? "generated"),
            details: metric.details && typeof metric.details === "object" ? metric.details : {},
            generatedAt: "",
        });
    });

    return records;
}

function toSummaryRows(records) {
    return records
        .map((record) => ({
            source: record.source,
            name: record.name,
            durationMs: record.durationMs,
            status: record.status,
            dataset: record.dataset,
        }))
        .sort((left, right) => left.source.localeCompare(right.source) || left.name.localeCompare(right.name));
}

function toSourceSummary(records) {
    const summaryMap = new Map();

    records.forEach((record) => {
        const current = summaryMap.get(record.source) ?? {
            source: record.source,
            count: 0,
            totalDurationMs: 0,
            warnCount: 0,
        };
        current.count += 1;
        current.totalDurationMs += record.durationMs;
        if (record.status !== "ok") {
            current.warnCount += 1;
        }
        summaryMap.set(record.source, current);
    });

    return Array.from(summaryMap.values()).sort((left, right) => left.source.localeCompare(right.source));
}

function extractDatasetOrderValue(record) {
    const candidates = [
        record.details?.nodeCount,
        record.details?.fileCount,
        record.details?.taskCount,
        record.details?.edgeCount,
    ];
    for (const candidate of candidates) {
        if (typeof candidate === "number" && Number.isFinite(candidate)) {
            return candidate;
        }
    }

    const dataset = String(record.dataset ?? "");
    const numericMatches = dataset.match(/\d+(?:\.\d+)?/g);
    if (numericMatches && numericMatches.length > 0) {
        return Number(numericMatches[numericMatches.length - 1]);
    }

    return Number.POSITIVE_INFINITY;
}

function compareDataset(left, right) {
    const leftValue = extractDatasetOrderValue(left);
    const rightValue = extractDatasetOrderValue(right);
    if (leftValue !== rightValue) {
        return leftValue - rightValue;
    }

    return String(left.dataset).localeCompare(String(right.dataset));
}

function toGroupedUnits(records) {
    const unitMap = new Map();

    records.forEach((record) => {
        const key = `${record.source}::${record.name}`;
        const existing = unitMap.get(key) ?? {
            id: slugify(key),
            key,
            source: record.source,
            name: record.name,
            displayName: record.displayName,
            category: record.category,
            suite: record.suite,
            points: [],
        };
        existing.points.push(record);
        unitMap.set(key, existing);
    });

    return Array.from(unitMap.values())
        .map((unit) => {
            const points = unit.points.slice().sort((left, right) => compareDataset(left, right));
            const warnCount = points.filter((point) => point.status !== "ok").length;
            const durations = points.map((point) => point.durationMs);
            return {
                ...unit,
                points,
                datasetCount: points.length,
                warnCount,
                minDurationMs: Math.min(...durations),
                maxDurationMs: Math.max(...durations),
                averageDurationMs: durations.reduce((sum, value) => sum + value, 0) / Math.max(1, durations.length),
            };
        })
        .sort((left, right) => left.source.localeCompare(right.source) || left.name.localeCompare(right.name));
}

function renderSummaryCards(summaries) {
    return summaries
        .map(
            (summary) => `
                <section class="summary-card">
                    <h2>${escapeHtml(summary.source)}</h2>
                    <p class="summary-value">${escapeHtml(summary.count)}</p>
                    <p class="summary-label">metrics</p>
                    <p class="summary-detail">total ${escapeHtml(summary.totalDurationMs.toFixed(3))} ms</p>
                    <p class="summary-detail">warnings ${escapeHtml(summary.warnCount)}</p>
                </section>`,
        )
        .join("\n");
}

function renderRowsTable(rows) {
    return rows
        .map(
            (row) => `
                <tr>
                    <td>${escapeHtml(row.source)}</td>
                    <td>${escapeHtml(row.name)}</td>
                    <td>${escapeHtml(row.durationMs.toFixed(3))}</td>
                    <td><span class="status status-${escapeHtml(row.status)}">${escapeHtml(row.status)}</span></td>
                    <td>${escapeHtml(row.dataset)}</td>
                </tr>`,
        )
        .join("\n");
}

function getPointStatusClass(status) {
    return status === "ok" ? "ok" : "warn";
}

function toChartModel(unit) {
    const width = 760;
    const height = 260;
    const padding = { top: 24, right: 20, bottom: 64, left: 68 };
    const chartWidth = width - padding.left - padding.right;
    const chartHeight = height - padding.top - padding.bottom;
    const durations = unit.points.map((point) => point.durationMs);
    const maxDuration = Math.max(...durations, 1);
    const minDuration = Math.min(...durations, 0);
    const yMax = maxDuration * 1.12;
    const yMin = Math.min(0, minDuration);
    const valueRange = Math.max(1, yMax - yMin);

    const points = unit.points.map((point, index) => {
        const x = unit.points.length === 1
            ? padding.left + chartWidth / 2
            : padding.left + (chartWidth * index) / Math.max(1, unit.points.length - 1);
        const y = padding.top + chartHeight - ((point.durationMs - yMin) / valueRange) * chartHeight;
        return {
            x,
            y,
            point,
        };
    });

    const polylinePoints = points.map((point) => `${point.x},${point.y}`).join(" ");
    const yTicks = Array.from({ length: 5 }, (_, index) => {
        const ratio = index / 4;
        const value = yMax - valueRange * ratio;
        const y = padding.top + chartHeight * ratio;
        return {
            y,
            label: `${value.toFixed(value >= 100 ? 0 : 1)} ms`,
        };
    });

    return {
        width,
        height,
        points,
        polylinePoints,
        yTicks,
        padding,
    };
}

function renderUnitCards(units) {
    return units
        .map(
            (unit, index) => `
                <button
                    type="button"
                    class="unit-card${index === 0 ? " active" : ""}"
                    data-unit-trigger="${escapeHtml(unit.id)}"
                    aria-controls="panel-${escapeHtml(unit.id)}"
                    aria-pressed="${index === 0 ? "true" : "false"}"
                >
                    <span class="unit-card__eyebrow">${escapeHtml(unit.source)} / ${escapeHtml(unit.category)}</span>
                    <strong class="unit-card__title">${escapeHtml(unit.name)}</strong>
                    <span class="unit-card__meta">${escapeHtml(String(unit.datasetCount))} datasets</span>
                    <span class="unit-card__meta">avg ${escapeHtml(unit.averageDurationMs.toFixed(3))} ms</span>
                    <span class="unit-card__meta">range ${escapeHtml(unit.minDurationMs.toFixed(3))} - ${escapeHtml(unit.maxDurationMs.toFixed(3))} ms</span>
                    <span class="unit-card__status ${unit.warnCount > 0 ? "warn" : "ok"}">${escapeHtml(unit.warnCount > 0 ? `${String(unit.warnCount)} warnings` : "all ok")}</span>
                </button>`,
        )
        .join("\n");
}

function formatDetailValue(value) {
    if (value === null || value === undefined) {
        return "-";
    }

    if (typeof value === "number") {
        return Number.isInteger(value) ? String(value) : value.toFixed(3);
    }

    if (typeof value === "boolean") {
        return value ? "true" : "false";
    }

    if (typeof value === "string") {
        return value;
    }

    return JSON.stringify(value);
}

function renderUnitPanels(units) {
    return units
        .map((unit, index) => {
            const chart = toChartModel(unit);
            const detailHeaders = Array.from(new Set(unit.points.flatMap((point) => Object.keys(point.details ?? {})))).sort();
            return `
                <section id="panel-${escapeHtml(unit.id)}" class="unit-panel${index === 0 ? " active" : ""}" data-unit-panel="${escapeHtml(unit.id)}">
                    <header class="unit-panel__header">
                        <div>
                            <p class="unit-panel__eyebrow">${escapeHtml(unit.source)} / ${escapeHtml(unit.category)} / ${escapeHtml(unit.suite)}</p>
                            <h3>${escapeHtml(unit.name)}</h3>
                        </div>
                        <div class="unit-panel__badges">
                            <span class="unit-panel__badge">${escapeHtml(String(unit.datasetCount))} datasets</span>
                            <span class="unit-panel__badge ${unit.warnCount > 0 ? "warn" : "ok"}">${escapeHtml(unit.warnCount > 0 ? `${String(unit.warnCount)} warnings` : "ok")}</span>
                        </div>
                    </header>

                    <div class="unit-panel__chart-wrap">
                        <svg viewBox="0 0 ${String(chart.width)} ${String(chart.height)}" role="img" aria-label="${escapeHtml(unit.name)} line chart" class="unit-chart">
                            ${chart.yTicks.map((tick) => `
                                <g>
                                    <line x1="${String(chart.padding.left)}" y1="${String(tick.y)}" x2="${String(chart.width - chart.padding.right)}" y2="${String(tick.y)}" class="unit-chart__grid" />
                                    <text x="${String(chart.padding.left - 12)}" y="${String(tick.y + 4)}" text-anchor="end" class="unit-chart__axis-label">${escapeHtml(tick.label)}</text>
                                </g>`).join("\n")}
                            <polyline points="${escapeHtml(chart.polylinePoints)}" class="unit-chart__line" />
                            ${chart.points.map((point) => `
                                <g>
                                    <circle cx="${String(point.x)}" cy="${String(point.y)}" r="6" class="unit-chart__point unit-chart__point--${getPointStatusClass(point.point.status)}" />
                                    <text x="${String(point.x)}" y="${String(chart.height - 24)}" text-anchor="middle" class="unit-chart__axis-label">${escapeHtml(point.point.dataset)}</text>
                                    <text x="${String(point.x)}" y="${String(point.y - 12)}" text-anchor="middle" class="unit-chart__point-label">${escapeHtml(point.point.durationMs.toFixed(1))} ms</text>
                                </g>`).join("\n")}
                        </svg>
                    </div>

                    <div class="unit-panel__stats-grid">
                        <div class="mini-stat">
                            <span>Average</span>
                            <strong>${escapeHtml(unit.averageDurationMs.toFixed(3))} ms</strong>
                        </div>
                        <div class="mini-stat">
                            <span>Min</span>
                            <strong>${escapeHtml(unit.minDurationMs.toFixed(3))} ms</strong>
                        </div>
                        <div class="mini-stat">
                            <span>Max</span>
                            <strong>${escapeHtml(unit.maxDurationMs.toFixed(3))} ms</strong>
                        </div>
                        <div class="mini-stat">
                            <span>Datasets</span>
                            <strong>${escapeHtml(String(unit.datasetCount))}</strong>
                        </div>
                    </div>

                    <div class="detail-table-wrap">
                        <table>
                            <thead>
                                <tr>
                                    <th>Dataset</th>
                                    <th>Duration (ms)</th>
                                    <th>Status</th>
                                    ${detailHeaders.map((header) => `<th>${escapeHtml(header)}</th>`).join("")}
                                </tr>
                            </thead>
                            <tbody>
                                ${unit.points.map((point) => `
                                    <tr>
                                        <td>${escapeHtml(point.dataset)}</td>
                                        <td>${escapeHtml(point.durationMs.toFixed(3))}</td>
                                        <td><span class="status status-${escapeHtml(point.status)}">${escapeHtml(point.status)}</span></td>
                                        ${detailHeaders.map((header) => `<td>${escapeHtml(formatDetailValue(point.details?.[header]))}</td>`).join("")}
                                    </tr>`).join("\n")}
                            </tbody>
                        </table>
                    </div>
                </section>`;
        })
        .join("\n");
}

function writeHtmlReport(frontendReports, backendRecords, records, rows) {
    fs.mkdirSync(perfRoot, { recursive: true });
    const sourceSummaries = toSourceSummary(records);
    const units = toGroupedUnits(records);
    const generatedAt = new Date().toISOString();
    const html = `<!doctype html>
<html lang="zh-CN">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>ofive Performance Report</title>
    <style>
        :root {
            color-scheme: light;
            --bg: #f4efe6;
            --bg-accent: #fcfaf5;
            --panel: rgba(255, 251, 245, 0.9);
            --panel-strong: #fffdf8;
            --text: #1f1d1a;
            --muted: #6a6256;
            --line: rgba(78, 64, 47, 0.16);
            --line-strong: rgba(78, 64, 47, 0.28);
            --accent: #0c7c59;
            --accent-soft: rgba(12, 124, 89, 0.12);
            --warn: #c76b00;
            --warn-soft: rgba(199, 107, 0, 0.12);
            --shadow: 0 18px 45px rgba(70, 44, 24, 0.12);
        }

        * {
            box-sizing: border-box;
        }

        html {
            scroll-behavior: smooth;
        }

        body {
            margin: 0;
            font-family: "Iowan Old Style", "Palatino Linotype", "Book Antiqua", serif;
            color: var(--text);
            background:
                radial-gradient(circle at top left, rgba(12, 124, 89, 0.16), transparent 26%),
                radial-gradient(circle at top right, rgba(199, 107, 0, 0.14), transparent 22%),
                linear-gradient(180deg, var(--bg-accent) 0%, var(--bg) 100%);
        }

        main {
            width: min(1380px, calc(100vw - 40px));
            margin: 0 auto;
            padding: 44px 0 72px;
        }

        header {
            margin-bottom: 28px;
        }

        h1 {
            margin: 0;
            font-size: clamp(34px, 6vw, 58px);
            line-height: 0.95;
            letter-spacing: -0.04em;
        }

        h2,
        h3,
        p {
            margin-top: 0;
        }

        .subtitle {
            margin: 14px 0 0;
            color: var(--muted);
            font-size: 16px;
            line-height: 1.6;
        }

        .summary-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
            gap: 16px;
            margin: 28px 0 32px;
        }

        .summary-card,
        .panel,
        .unit-card,
        .unit-panel,
        .mini-stat {
            background: var(--panel);
            border: 1px solid var(--line);
            border-radius: 20px;
            box-shadow: var(--shadow);
            backdrop-filter: blur(10px);
        }

        .summary-card {
            padding: 20px 22px;
        }

        .summary-card h2 {
            margin-bottom: 0;
            font-size: 14px;
            text-transform: uppercase;
            letter-spacing: 0.12em;
            color: var(--muted);
        }

        .summary-value {
            margin: 10px 0 0;
            font-size: 42px;
            line-height: 1;
        }

        .summary-label,
        .summary-detail,
        .meta-item {
            color: var(--muted);
        }

        .summary-label {
            margin: 6px 0 0;
            font-size: 14px;
        }

        .summary-detail {
            margin: 8px 0 0;
            font-size: 14px;
        }

        .panel {
            padding: 24px;
            margin-bottom: 22px;
        }

        .panel h2 {
            margin-bottom: 14px;
            font-size: 22px;
        }

        .meta-grid,
        .unit-panel__stats-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
            gap: 12px;
        }

        .meta-item strong {
            display: block;
            color: var(--text);
            margin-bottom: 6px;
        }

        table {
            width: 100%;
            border-collapse: collapse;
            overflow: hidden;
            border-radius: 16px;
            background: var(--panel-strong);
        }

        th,
        td {
            padding: 14px 16px;
            border-bottom: 1px solid var(--line);
            text-align: left;
            vertical-align: top;
        }

        th {
            font-size: 13px;
            text-transform: uppercase;
            letter-spacing: 0.08em;
            color: var(--muted);
            background: rgba(12, 124, 89, 0.06);
        }

        tr:last-child td {
            border-bottom: none;
        }

        .status,
        .unit-panel__badge,
        .unit-card__status {
            display: inline-flex;
            align-items: center;
            justify-content: center;
            gap: 6px;
            padding: 4px 10px;
            border-radius: 999px;
            font-size: 12px;
            font-weight: 600;
        }

        .status-ok,
        .unit-panel__badge.ok,
        .unit-card__status.ok {
            background: var(--accent-soft);
            color: var(--accent);
        }

        .status-warn,
        .status-unknown,
        .unit-panel__badge.warn,
        .unit-card__status.warn {
            background: var(--warn-soft);
            color: var(--warn);
        }

        pre {
            margin: 0;
            padding: 18px;
            overflow: auto;
            border-radius: 16px;
            background: #221f1a;
            color: #f6efe2;
            font-family: "SFMono-Regular", "Cascadia Code", monospace;
            font-size: 13px;
            line-height: 1.55;
        }

        .empty {
            margin: 0;
            color: var(--muted);
        }

        .unit-browser {
            display: grid;
            grid-template-columns: 330px minmax(0, 1fr);
            gap: 18px;
            min-height: 720px;
        }

        .unit-list {
            display: grid;
            gap: 12px;
            align-content: start;
            max-height: 720px;
            overflow: auto;
            padding-right: 4px;
        }

        .unit-card {
            width: 100%;
            padding: 16px;
            text-align: left;
            cursor: pointer;
            transition: transform 140ms ease, border-color 140ms ease, background 140ms ease;
        }

        .unit-card:hover,
        .unit-card.active {
            transform: translateY(-1px);
            border-color: var(--line-strong);
            background: rgba(255, 252, 247, 0.95);
        }

        .unit-card__eyebrow,
        .unit-panel__eyebrow {
            display: block;
            margin-bottom: 8px;
            color: var(--muted);
            font-size: 12px;
            text-transform: uppercase;
            letter-spacing: 0.12em;
        }

        .unit-card__title {
            display: block;
            font-size: 15px;
            line-height: 1.45;
            margin-bottom: 10px;
        }

        .unit-card__meta {
            display: block;
            color: var(--muted);
            font-size: 13px;
            line-height: 1.5;
        }

        .unit-card__status {
            margin-top: 12px;
        }

        .unit-detail-area {
            min-width: 0;
        }

        .unit-panel {
            display: none;
            padding: 22px;
            min-width: 0;
        }

        .unit-panel.active {
            display: block;
        }

        .unit-panel__header {
            display: flex;
            align-items: start;
            justify-content: space-between;
            gap: 14px;
            margin-bottom: 14px;
        }

        .unit-panel__header h3 {
            margin-bottom: 0;
            font-size: 28px;
            line-height: 1.1;
        }

        .unit-panel__badges {
            display: flex;
            flex-wrap: wrap;
            gap: 8px;
        }

        .unit-panel__chart-wrap {
            overflow-x: auto;
            margin-bottom: 16px;
            border: 1px solid var(--line);
            border-radius: 18px;
            background: linear-gradient(180deg, rgba(255, 253, 248, 0.95) 0%, rgba(250, 244, 234, 0.9) 100%);
        }

        .unit-chart {
            width: 100%;
            min-width: 720px;
            display: block;
        }

        .unit-chart__grid {
            stroke: rgba(78, 64, 47, 0.14);
            stroke-width: 1;
        }

        .unit-chart__line {
            fill: none;
            stroke: var(--accent);
            stroke-width: 3;
            stroke-linecap: round;
            stroke-linejoin: round;
        }

        .unit-chart__point {
            stroke: #fffdf8;
            stroke-width: 3;
        }

        .unit-chart__point--ok {
            fill: var(--accent);
        }

        .unit-chart__point--warn {
            fill: var(--warn);
        }

        .unit-chart__axis-label {
            fill: var(--muted);
            font-size: 12px;
            font-family: "SFMono-Regular", "Cascadia Code", monospace;
        }

        .unit-chart__point-label {
            fill: var(--text);
            font-size: 12px;
            font-family: "SFMono-Regular", "Cascadia Code", monospace;
        }

        .mini-stat {
            padding: 14px 16px;
        }

        .mini-stat span {
            display: block;
            color: var(--muted);
            font-size: 12px;
            text-transform: uppercase;
            letter-spacing: 0.08em;
        }

        .mini-stat strong {
            display: block;
            margin-top: 8px;
            font-size: 24px;
            line-height: 1.1;
        }

        .detail-table-wrap {
            margin-top: 18px;
            overflow: auto;
        }

        .raw-report-block + .raw-report-block {
            margin-top: 18px;
        }

        @media (max-width: 1080px) {
            .unit-browser {
                grid-template-columns: 1fr;
            }

            .unit-list {
                max-height: none;
            }
        }

        @media (max-width: 720px) {
            main {
                width: min(100vw - 24px, 100%);
                padding-top: 28px;
            }

            .panel,
            .summary-card,
            .unit-panel,
            .unit-card {
                padding: 18px;
            }

            th,
            td {
                padding: 12px;
            }

            .unit-panel__header {
                flex-direction: column;
            }

            .unit-panel__header h3 {
                font-size: 22px;
            }
        }
    </style>
</head>
<body>
    <main>
        <header>
            <h1>Performance Report</h1>
            <p class="subtitle">同一个页面中汇总前后端结果；同名测试会聚合成一个测试单元，点击后可查看规模变化折线图与详细数据。生成时间 ${escapeHtml(generatedAt)}。</p>
        </header>

        <section class="summary-grid">
            ${renderSummaryCards(sourceSummaries)}
        </section>

        <section class="panel">
            <h2>Run Metadata</h2>
            <div class="meta-grid">
                <div class="meta-item"><strong>Frontend Sources</strong>${escapeHtml(frontendReports.map(({ fileName }) => path.join("test-results", "perf", fileName)).join(", ") || "none")}</div>
                <div class="meta-item"><strong>Backend Source</strong>${escapeHtml(path.relative(workspaceRoot, backendBenchPath))}</div>
                <div class="meta-item"><strong>Frontend Reports</strong>${escapeHtml(String(frontendReports.length))}</div>
                <div class="meta-item"><strong>Frontend Records</strong>${escapeHtml(String(frontendReports.reduce((count, item) => count + (item.report.metrics?.length ?? 0) + (item.report.derived?.length ?? 0), 0)))}</div>
                <div class="meta-item"><strong>Backend Records</strong>${escapeHtml(String(backendRecords.length))}</div>
                <div class="meta-item"><strong>Grouped Test Units</strong>${escapeHtml(String(units.length))}</div>
            </div>
        </section>

        <section class="panel">
            <h2>Test Units</h2>
            <div class="unit-browser">
                <aside class="unit-list">
                    ${renderUnitCards(units)}
                </aside>
                <div class="unit-detail-area">
                    ${renderUnitPanels(units)}
                </div>
            </div>
        </section>

        <section class="panel">
            <h2>Unified Metrics</h2>
            <table>
                <thead>
                    <tr>
                        <th>Source</th>
                        <th>Name</th>
                        <th>Duration (ms)</th>
                        <th>Status</th>
                        <th>Dataset</th>
                    </tr>
                </thead>
                <tbody>
                    ${renderRowsTable(rows)}
                </tbody>
            </table>
        </section>

        <section class="panel">
            <h2>Frontend Raw Reports</h2>
            ${frontendReports.length > 0
                ? frontendReports.map(({ fileName, report }) => `<div class="raw-report-block"><h3>${escapeHtml(fileName)}</h3><pre>${escapeHtml(JSON.stringify(report, null, 2))}</pre></div>`).join("\n")
                : '<p class="empty">frontend reports not found</p>'}
        </section>

        <section class="panel">
            <h2>Backend Raw Records</h2>
            ${backendRecords.length > 0
                ? `<pre>${escapeHtml(JSON.stringify(backendRecords, null, 2))}</pre>`
                : '<p class="empty">backend benchmark records not found</p>'}
        </section>
    </main>

    <script>
        (() => {
            const triggers = Array.from(document.querySelectorAll('[data-unit-trigger]'));
            const panels = Array.from(document.querySelectorAll('[data-unit-panel]'));

            const activate = (unitId) => {
                triggers.forEach((trigger) => {
                    const active = trigger.getAttribute('data-unit-trigger') === unitId;
                    trigger.classList.toggle('active', active);
                    trigger.setAttribute('aria-pressed', active ? 'true' : 'false');
                });

                panels.forEach((panel) => {
                    const active = panel.getAttribute('data-unit-panel') === unitId;
                    panel.classList.toggle('active', active);
                });
            };

            triggers.forEach((trigger) => {
                trigger.addEventListener('click', () => {
                    const unitId = trigger.getAttribute('data-unit-trigger');
                    if (unitId) {
                        activate(unitId);
                    }
                });
            });
        })();
    </script>
</body>
</html>`;

    fs.writeFileSync(combinedHtmlReportPath, html, "utf8");
}

const frontendReports = safeReadFrontendReports(perfRoot);
const backendRecords = safeReadJsonLines(backendBenchPath);
const records = toMetricRecords(frontendReports, backendRecords);
const rows = toSummaryRows(records);

if (rows.length === 0) {
    console.log("[perf-report] no performance result files found under test-results/perf");
    process.exit(0);
}

writeHtmlReport(frontendReports, backendRecords, records, rows);

console.log("source\tname\tdurationMs\tstatus\tdataset");
for (const row of rows) {
    console.log(
        `${row.source}\t${row.name}\t${row.durationMs.toFixed(3)}\t${row.status}\t${row.dataset}`,
    );
}
console.log(`[perf-report] html report: ${path.relative(workspaceRoot, combinedHtmlReportPath)}`);