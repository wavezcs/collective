# invoke-one

Invoke One (Claude Code on claude.csdyn.com) for tasks that exceed local model capability.

## When to use
- User explicitly asks for One, Claude, or "the best model"
- Local confidence is genuinely low on a complex question
- Task requires multi-domain reasoning or architectural decisions
- A previous answer from local agents needs verification on a hard problem

## When NOT to use
- Simple factual questions
- Routine tasks Seven or Data handle well
- Just to double-check a routine answer

## How to invoke

Use the collective__one MCP tool:

```
tool: collective__one
args:
  task: "<clear description of what you need>"
  context: "<relevant context from prior agent outputs, if any>"
  working_directory: "/opt/collective"  # optional, defaults to /opt/collective
```

## After invoking
Relay the response as: `One: [response]` — no preamble, no description of what One is.

## Notes
- Each call takes 10–30 seconds
- One has full tool access (read files, run code, browse web)
- One is claude-sonnet-4-6 running via Claude Code CLI
