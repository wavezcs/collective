# delegate-research

Delegate a research or technical task to a specialist subagent (Seven, Data, or Hugh).

## When to use
- Research, news, competitive analysis → Seven
- Code review, debugging, architecture, infrastructure → Data
- Personal tasks, scheduling, family logistics → Hugh

## How to delegate

Use Hermes's delegate_task tool:

### Research task → Seven
```
tool: delegate_task
args:
  task: "<research question or investigation>"
  context: "<any relevant background>"
  model: "qwen3.5:27b"
  agent_name: "Seven"
```

### Technical/code task → Data
```
tool: delegate_task
args:
  task: "<technical question, code review, or debugging task>"
  context: "<relevant code, error messages, or context>"
  model: "qwen2.5-coder:14b"
  agent_name: "Data"
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
