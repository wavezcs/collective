---
name: one
description: Invoke One (Claude Code on claude.csdyn.com) for tasks exceeding the Collective's local capability. Use when drones cannot complete a task with high confidence.
metadata: {"openclaw":{"emoji":"🧠"}}
---

# One — External Intelligence

To invoke One, call the **`collective__one`** tool with a `task` parameter.

One is Claude Code running headlessly on `claude.csdyn.com`. One has full access to the collective codebase and infrastructure.

## When to Use

- Complex code architecture decisions
- Multi-step reasoning requiring synthesis across domains
- Debugging issues requiring codebase-level investigation
- Writing requiring nuance beyond standard instruction following
- **Any task where Locutus reports low confidence after consulting Seven and Data**
- User explicitly asks to "ask One" or "use One"

## When NOT to Use

- Simple factual questions (Seven can handle these)
- Routine code tasks (Data can handle these)

## Parameters

- `task` (required): Full description of the task. Include all relevant context — One has no prior conversation context.
- `context` (optional): What drones have already tried, relevant findings.
- `working_directory` (optional): Default is `/opt/collective`.

## Notes

- One's response is prefixed with `[One]`
- If One is unavailable, the prefix will be `[One — Error]`
- One is the final escalation before admitting a task cannot be completed
