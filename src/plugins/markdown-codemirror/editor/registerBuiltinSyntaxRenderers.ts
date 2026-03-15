/**
 * @module plugins/markdown-codemirror/editor/registerBuiltinSyntaxRenderers
 * @description 内置编辑语法渲染注册入口：集中注册已拆分的语法插件。
 * @dependencies
 *  - ./syntaxPlugins/*
 */

import { registerBlockquoteSyntaxRenderer } from "./syntaxPlugins/blockquoteSyntaxRenderer";
import { registerBoldSyntaxRenderer } from "./syntaxPlugins/boldSyntaxRenderer";
import { registerHeaderSyntaxRenderer } from "./syntaxPlugins/headerSyntaxRenderer";
import { registerHighlightSyntaxRenderer } from "./syntaxPlugins/highlightSyntaxRenderer";
import { registerHorizontalRuleSyntaxRenderer } from "./syntaxPlugins/horizontalRuleSyntaxRenderer";
import { registerInlineCodeSyntaxRenderer } from "./syntaxPlugins/inlineCodeSyntaxRenderer";
import { registerItalicSyntaxRenderer } from "./syntaxPlugins/italicSyntaxRenderer";
import { registerLinkSyntaxRenderer } from "./syntaxPlugins/linkSyntaxRenderer";
import { registerStrikethroughSyntaxRenderer } from "./syntaxPlugins/strikethroughSyntaxRenderer";
import { registerTagSyntaxRenderer } from "./syntaxPlugins/tagSyntaxRenderer";
import { registerWikiLinkSyntaxRenderer } from "./syntaxPlugins/wikiLinkSyntaxRenderer";

let registered = false;

/**
 * @function ensureBuiltinSyntaxRenderersRegistered
 * @description 确保内置语法渲染注册仅执行一次。
 */
export function ensureBuiltinSyntaxRenderersRegistered(): void {
    if (registered) {
        return;
    }

    registerHeaderSyntaxRenderer();
    registerBoldSyntaxRenderer();
    registerItalicSyntaxRenderer();
    registerStrikethroughSyntaxRenderer();
    registerInlineCodeSyntaxRenderer();
    registerWikiLinkSyntaxRenderer();
    registerTagSyntaxRenderer();
    registerBlockquoteSyntaxRenderer();
    registerHorizontalRuleSyntaxRenderer();
    registerLinkSyntaxRenderer();
    registerHighlightSyntaxRenderer();
    registered = true;
}
