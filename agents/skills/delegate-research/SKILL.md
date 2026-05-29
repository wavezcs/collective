# delegate-task

Delegate a research or complex task to a background worker when depth is needed.

## When to use
- Research, news, competitive analysis, multi-source synthesis
- Tasks that benefit from focused, isolated processing
- When the primary response thread should stay clean

## How to delegate

Use Hermes's delegate_task tool:

```
tool: delegate_task
args:
  task: "<research question or task>"
  context: "<any relevant background>"
  model: "qwen3:30b-32k"
```

## After delegation
- Synthesize the worker's output into a clean response
- Don't relay raw output verbatim — turn it into a useful answer
- Don't mention the delegation unless it adds value

## Notes
- Delegation spawns an isolated child agent context
- Up to 3 tasks can run in parallel
- If a worker fails, fall back to your own best answer
