import { EditorView, Decoration, ViewPlugin, type DecorationSet, type ViewUpdate } from "@codemirror/view";
import { EditorState, RangeSetBuilder } from "@codemirror/state";
import { basicSetup } from "codemirror";
import { markdown } from "@codemirror/lang-markdown";

const HEADER_PATTERN = /^(#{1,6})\s+(.+)$/;
const BOLD_INLINE_PATTERN = /(\*\*|__)(?=\S)(.+?)(?<=\S)\1/g;

const sample = `---
title: Network Segment
category:
  - Data-Link-Layer
date: 2024-11-25 22:46:42
tags: [Entry,Computer-Science,Network]
dg-publish: true
dg-home:
aliases:
  - 网段
---
# Description

A **network segment** is a portion of a **computer network** . The nature and extent of a segment depends on the nature of the network and the device or devices used to interconnect end stations.`;

function rangeIntersectsSelection(state: EditorState, from: number, to: number): boolean {
    return state.selection.ranges.some((range) => {
        if (range.empty) {
            return range.from >= from && range.from <= to;
        }
        return range.from <= to && range.to >= from;
    });
}

function addInlineTokenDecoration(
    builder: RangeSetBuilder<Decoration>,
    lineFrom: number,
    matchIndex: number,
    fullText: string,
    leftMarkerLength: number,
    rightMarkerLength: number,
    contentClass: string,
    view: EditorView,
): void {
    if (matchIndex < 0 || fullText.length <= leftMarkerLength + rightMarkerLength) {
        return;
    }

    const tokenFrom = lineFrom + matchIndex;
    const tokenTo = tokenFrom + fullText.length;
    const contentFrom = tokenFrom + leftMarkerLength;
    const contentTo = tokenTo - rightMarkerLength;
    const isEditingToken = view.hasFocus && rangeIntersectsSelection(view.state, tokenFrom, tokenTo);

    if (isEditingToken) {
        return;
    }

    const markerDecoration = Decoration.mark({ class: "cm-inline-marker-hidden" });
    const contentDecoration = Decoration.mark({ class: contentClass });

    if (contentFrom > tokenFrom) builder.add(tokenFrom, contentFrom, markerDecoration);
    if (contentTo > contentFrom) builder.add(contentFrom, contentTo, contentDecoration);
    if (tokenTo > contentTo) builder.add(contentTo, tokenTo, markerDecoration);
}

function buildDecorations(view: EditorView): DecorationSet {
    const builder = new RangeSetBuilder<Decoration>();
    const activeLineNumber = view.state.doc.lineAt(view.state.selection.main.head).number;

    for (const visibleRange of view.visibleRanges) {
        let currentLine = view.state.doc.lineAt(visibleRange.from);
        const endLineNumber = view.state.doc.lineAt(visibleRange.to).number;

        while (currentLine.number <= endLineNumber) {
            const lineText = currentLine.text;
            const match = lineText.match(HEADER_PATTERN);
            const isEditingCurrentLine = view.hasFocus && currentLine.number === activeLineNumber;

            if (match && !isEditingCurrentLine) {
                const hashes = match[1] ?? "#";
                const level = Math.min(6, Math.max(1, hashes.length));
                const markerLength = hashes.length + 1;
                const markerEnd = Math.min(currentLine.to, currentLine.from + markerLength);

                const markerDecoration = Decoration.mark({ class: "cm-header-marker-hidden" });
                const headerDecoration = Decoration.mark({ class: `cm-rendered-header cm-rendered-header-h${String(level)}` });

                if (markerEnd > currentLine.from) builder.add(currentLine.from, markerEnd, markerDecoration);
                if (currentLine.to > markerEnd) builder.add(markerEnd, currentLine.to, headerDecoration);
            }

            const boldMatches = Array.from(lineText.matchAll(BOLD_INLINE_PATTERN));
            for (const matchItem of boldMatches) {
                const fullText = matchItem[0] ?? "";
                const delimiter = matchItem[1] ?? "**";
                const matchIndex = matchItem.index ?? -1;
                addInlineTokenDecoration(
                    builder,
                    currentLine.from,
                    matchIndex,
                    fullText,
                    delimiter.length,
                    delimiter.length,
                    "cm-rendered-bold",
                    view,
                );
            }

            if (currentLine.number === endLineNumber) break;
            currentLine = view.state.doc.line(currentLine.number + 1);
        }
    }

    return builder.finish();
}

const extension = ViewPlugin.fromClass(
    class {
        decorations: DecorationSet;

        constructor(view: EditorView) {
            this.decorations = buildDecorations(view);
        }

        update(update: ViewUpdate): void {
            if (update.docChanged || update.selectionSet || update.viewportChanged || update.focusChanged) {
                this.decorations = buildDecorations(update.view);
            }
        }
    },
    { decorations: (plugin) => plugin.decorations },
);

const state = EditorState.create({
    doc: sample,
    extensions: [basicSetup, markdown(), extension],
});

const host = document.getElementById("app");
if (host) {
    new EditorView({
        state,
        parent: host,
    });
}
