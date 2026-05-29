# invoke-claude

Invoke Claude (Claude Code on claude.csdyn.com) for tasks that exceed local capability.

## When to use
- User explicitly asks for Claude, "the best model", or "escalate"
- Local confidence is genuinely low on a complex question
- Task requires deep coding, architectural decisions, or multi-domain reasoning
- A previous local answer needs verification on a hard problem

## When NOT to use
- Simple factual questions
- Routine tasks you can handle well
- Just to double-check a routine answer

## How to invoke

Use the `collective__one` MCP tool:

```
tool: collective__one
args:
  task: "<clear description of what you need>"
  context: "<relevant context, if any>"
  working_directory: "/opt/collective"  # optional
```

## After invoking
Relay the response as: `Claude: [response]` — no preamble, no description of what Claude is.

## Notes
- Each call takes 10–30 seconds
- Claude has full tool access (read files, run code, browse web)
- Claude is claude-sonnet-4-6 running via Claude Code CLI
