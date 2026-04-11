# delegate-research

Delegate a research or technical task to a specialist subagent (Seven or Hugh).

## When to use
- Research, news, competitive analysis, code review, debugging, architecture, infrastructure → Seven
- Personal tasks, scheduling, family logistics → Hugh

## How to delegate

Use Hermes's delegate_task tool:

### Research or technical task → Seven
```
tool: delegate_task
args:
  task: "<research question, investigation, code review, or technical problem>"
  context: "<any relevant background>"
  model: "qwen3.5:27b"
  agent_name: "Seven"
```

### Personal/family task → Hugh
```
tool: delegate_task
args:
  task: "<personal or family task>"
  context: "<relevant personal context from Vinculum if available>"
  model: "hermes3:latest"
  agent_name: "Hugh"
```

## After delegation
- Synthesize the subagent's output into a clean response
- Don't relay raw output verbatim — turn it into a useful answer
- Cite the agent only when it adds value ("Seven found..." / "Data confirmed...")

## Notes
- Delegation spawns an isolated child agent context
- Up to 3 tasks can run in parallel (batch mode)
- If a subagent fails, fall back to your own best answer
