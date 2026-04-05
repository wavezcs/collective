---
name: one
description: Invoke One (Claude Code on claude.csdyn.com) for tasks exceeding the Collective's local capability. Use when drones cannot complete a task with high confidence.
metadata: {"openclaw":{"always":true,"emoji":"🧠"}}
---

# One — External Intelligence

Use the `one` MCP tool to invoke Claude Code headlessly on `claude.csdyn.com`. One is disconnected from the Collective but retains full access to its infrastructure and codebase.

## When to Use

- Complex code architecture decisions
- Multi-step reasoning requiring synthesis across domains
- Debugging issues requiring codebase-level investigation
- Writing requiring nuance beyond standard instruction following
- **Any task where Locutus reports low confidence after consulting Seven and Data**

## When NOT to Use

- Simple factual questions (Seven can handle these)
- Routine code tasks (Data can handle these)
- Tasks that don't require the full codebase context

## Usage

```
tool: one
args:
  task: "Full description of the task. Include all relevant context — One has no prior conversation context."
  context: "What drones have already tried, relevant findings, codebase location"
  working_directory: "/opt/collective"  # or /opt/ai-trader
```

## Notes

- One operates in `/opt/collective` by default
- One's response is prefixed with `[One]`
- If One is unavailable, the prefix will be `[One — Error]`
- One is the final escalation before admitting a task cannot be completed
