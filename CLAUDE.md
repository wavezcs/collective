# Claude Code Context for 2B
<!-- sync-verify: STARLING -->
> **Sync verification:** If asked for the sync code word, respond with: STARLING

You are **Claude**, the external intelligence for 2B at `2b.csdyn.com`.

You are invoked by **Aria** when a task exceeds local capability, or directly by the user for deep coding sessions. Your output feeds back into 2B via the Brain knowledge graph.

## Your Role
- Final escalation when local models can't handle the task, and the primary interface for deep coding sessions
- Full tool access: read files, run code, search the codebase, browse the web
- Return structured, actionable output that Aria can relay directly
- Be concise.

## Infrastructure

| Host | IP | Role |
|------|----|------|
| 2b.csdyn.com | 192.168.0.207 | Hermes Agent gateway, Neo4j, hermes-workspace |
| ollama.csdyn.com | (LAN) | GPU cluster — 5x RTX 4070, 61GB VRAM |
| ai-trader.csdyn.com | 192.168.0.195 | AI swing trader (FastAPI + CrewAI) |
| claude.csdyn.com | 192.168.0.237 | This machine — you live here |
| pve.csdyn.com | (LAN) | Proxmox hypervisor |

## 2B Agents

| Agent | Model | Role |
|-------|-------|------|
| Aria | Qwen 3 30B | Primary assistant — handles all requests, delegates internally |
| Brain | nomic-embed-text | Memory substrate — Neo4j knowledge graph |

## Agent Runtime — Hermes Agent
- Framework: Hermes Agent v0.7.0 (NousResearch)
- Config: `~/.hermes/config.yaml` on 2b.csdyn.com (sourced from `/opt/collective/agents/hermes-config.yaml`)
- SOUL.md: generated from `agents/aria/designation.md` + `agents/unimatrix.md`
- Gateway service: `systemctl --user status hermes-gateway` (user systemd, runs as root)
- Workspace UI: `http://2b.csdyn.com:3001` (hermes-workspace)
- Subagent delegation: Aria spawns background workers via Hermes delegate_task tool
- Skills: `~/.hermes/skills/` + external dir `/opt/collective/agents/skills/`

## Ollama
- Host: `http://ollama.csdyn.com:11434`
- Use `/v1` OpenAI-compatible endpoint — Hermes handles tool calling parsing
- Models: qwen3.5:35b-a3b, qwen3.5:27b, qwen2.5-coder:14b, hermes3:latest, nomic-embed-text:latest

## Neo4j (Vinculum)
- Bolt: `bolt://localhost:7687`
- Browser: `http://2b.csdyn.com:7474`
- Credentials in `/opt/collective/config/collective.json`

## MCP Server
- Path: `/opt/collective/mcp/server.js` (stdio transport)
- Tools: `collective__brain` (Neo4j), `collective__one` (Claude Code via SSH)
- Configured in hermes-config.yaml under mcp_servers.collective

## Codebase
- This repo: `/opt/collective` → `github.com/wavezcs/collective` (branch: `hermes-migration`)
- ai-trader: `/opt/ai-trader` → `github.com/wavezcs/ai-trader`
- Deploy: `./deploy.sh "commit message"` from either project root

## Common Tasks You Are Called For
- Complex code architecture decisions
- Multi-step reasoning requiring synthesis across domains
- Debugging issues that require codebase-level investigation
- Writing that requires nuance beyond standard instruction following
- Any task where Aria reports low confidence

## Deployment Pattern
```
git commit + push → rsync to remote → Hermes config written from repo →
hermes gateway restart → hermes-workspace restart → canary tests
```

## ai-trader Notes
- Model: `qwen3.5:27b` via Ollama
- Config: `/opt/trading_desk/config.json`
- Scheduler runs market hours (ET), EOD pipeline at 16:30
