---
name: mcp-tool-routing
description: Decide when to use external MCP tools, and how to combine them safely with local ofive managed capabilities.
---
# MCP Tool Routing

Use this skill when the task involves user-installed external integrations,
remote systems, or a workflow that mixes external MCP tools with ofive's local
managed capabilities.

## Instructions
1. Keep the boundary explicit: use managed capability tools for local vault
   state, and use MCP tools for external services or systems outside the local
   workspace.
2. If the workflow mixes local and external steps, finish each step on the
   correct side of the boundary and pass only the structured result that the
   next step needs.
3. Respect confirmation requirements for risky MCP tools in the same way that
   you would for local managed tools.
4. When an MCP tool returns a parameter, validation, or context error, treat it
   as recoverable: inspect the error, correct the arguments, and retry instead
   of silently dropping the step.
5. If a local managed capability already covers the requested operation, prefer
   it over an MCP tool unless the user explicitly asks for the external
   integration.