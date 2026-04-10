import React, { useState, useEffect, useRef } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { getProject, updateProject } from '../api/projects'
import { createSession, streamChat, getMessages } from '../api/hermes'
import { Message, StreamingMessage } from '../components/Message'
import MessageInput from '../components/MessageInput'
import SessionTree from '../components/SessionTree'
import {
  ArrowLeft, Target, Repeat, CheckCircle, XCircle, Clock,
  Search, Database, Cpu, List, Globe, RefreshCw, Zap, Brain
} from 'lucide-react'

// ─── Activity parsing ─────────────────────────────────────────────────────────

function extractToolName(callStr) {
  const s = String(callStr)
  // Match 'function': {'name': 'toolname'} in Python repr
  const m = s.match(/'function'.*?'name'[^:]*:\s*'([\w_]+)'/)
  return m ? m[1] : null
}

function parseActivities(messages) {
  const acts = []
  for (const m of messages) {
    if (m.role === 'user') continue

    if (m.role === 'assistant') {
      // Tool calls
      const tc = m.tool_calls
      if (Array.isArray(tc) && tc.length > 0) {
        for (const c of tc) {
          const name = extractToolName(c)
          if (name) acts.push({ type: 'tool', name, ts: m.timestamp })
        }
      }
      // Reasoning (thinking)
      if (m.reasoning && m.reasoning !== 'None') {
        acts.push({ type: 'thinking', text: m.reasoning, ts: m.timestamp })
      }
      // Final text response
      if (m.content) {
        acts.push({ type: 'response', text: m.content, ts: m.timestamp })
      }
    }

    if (m.role === 'tool') {
      try {
        const parsed = JSON.parse(m.content)
        if (parsed?.data?.web) {
          acts.push({
            type: 'web_result',
            count: parsed.data.web.length,
            title: parsed.data.web[0]?.title,
            ts: m.timestamp
          })
        } else if (parsed?.todos) {
          const active = parsed.todos.find(t => t.status === 'in_progress') || parsed.todos[0]
          if (active) acts.push({ type: 'todo', text: active.content, ts: m.timestamp })
        }
      } catch { /* non-JSON tool result */ }
    }
  }
  return acts
}

// ─── Activity components ──────────────────────────────────────────────────────

const TOOL_ICONS = {
  web_search: Search,
  web_extract: Globe,
  todo: List,
  delegate_task: Cpu,
  process: Cpu,
  mcp_collective_vinculum: Database,
  mcp_collective_one: Zap,
}

const TOOL_LABELS = {
  web_search: 'Web search',
  web_extract: 'Reading page',
  todo: 'Task update',
  delegate_task: 'Delegating to agent',
  process: 'Agent subprocess',
  mcp_collective_vinculum: 'Memory query',
  mcp_collective_one: 'Calling One',
}

function ActivityItem({ activity }) {
  if (activity.type === 'tool') {
    const Icon = TOOL_ICONS[activity.name] || Cpu
    return (
      <div className="flex items-center gap-1.5 text-xs text-borg-muted">
        <Icon size={9} className="text-borg-green shrink-0" />
        <span>{TOOL_LABELS[activity.name] || activity.name}</span>
      </div>
    )
  }
  if (activity.type === 'thinking') {
    return (
      <div className="text-xs text-borg-dim/70 italic pl-3 border-l border-borg-border line-clamp-2 leading-relaxed">
        {activity.text}
      </div>
    )
  }
  if (activity.type === 'web_result') {
    return (
      <div className="text-xs pl-3">
        <span className="text-borg-green">{activity.count} results</span>
        {activity.title && (
          <span className="text-borg-dim/60"> — {activity.title.slice(0, 45)}</span>
        )}
      </div>
    )
  }
  if (activity.type === 'todo') {
    return (
      <div className="text-xs text-borg-muted pl-3 line-clamp-1">
        → {activity.text}
      </div>
    )
  }
  if (activity.type === 'response') {
    return (
      <div className="text-xs text-borg-text/80 pl-3 border-l border-borg-green/30 line-clamp-2 leading-relaxed">
        {activity.text}
      </div>
    )
  }
  return null
}

function ActivityFeed({ sessionId }) {
  const { data } = useQuery({
    queryKey: ['hermes-messages', sessionId],
    queryFn: () => getMessages(sessionId).then(d => d.items || []),
    refetchInterval: 3000,
    enabled: !!sessionId,
  })

  const activities = parseActivities(data || [])
  if (!activities.length) return null

  return (
    <div className="border border-borg-border rounded bg-borg-surface p-3">
      <div className="text-xs text-borg-dim mb-2 uppercase tracking-wider flex items-center gap-1.5">
        <Brain size={9} />
        Live Activity
        <span className="ml-auto w-1.5 h-1.5 rounded-full bg-borg-green animate-pulse" />
      </div>
      <div className="space-y-1.5 max-h-64 overflow-y-auto">
        {activities.slice(-20).reverse().map((a, i) => (
          <ActivityItem key={i} activity={a} />
        ))}
      </div>
    </div>
  )
}

// ─── Iteration row ────────────────────────────────────────────────────────────

function IterationRow({ iter }) {
  const icon = {
    keep:    <CheckCircle size={12} className="text-borg-green shrink-0" />,
    revert:  <XCircle size={12} className="text-red-400 shrink-0" />,
    pending: <Clock size={12} className="text-borg-dim shrink-0" />
  }[iter.decision] || <Clock size={12} className="text-borg-dim shrink-0" />

  return (
    <div className="flex items-start gap-2 py-2 border-b border-borg-border/50 last:border-0 text-xs">
      <span className="text-borg-dim w-6 shrink-0 text-right">#{iter.number}</span>
      {icon}
      <div className="flex-1 min-w-0">
        {iter.summary && <div className="text-borg-muted truncate">{iter.summary}</div>}
        {iter.judge_reasoning && (
          <div className="text-borg-dim/70 mt-0.5 line-clamp-2">{iter.judge_reasoning}</div>
        )}
      </div>
      {iter.score != null && (
        <span className={`shrink-0 font-mono ${Number(iter.score) >= 7 ? 'text-borg-green' : 'text-borg-muted'}`}>
          {Number(iter.score).toFixed(1)}
        </span>
      )}
    </div>
  )
}

// ─── Main view ────────────────────────────────────────────────────────────────

export default function ProjectDetail({ project, onBack }) {
  const qc                        = useQueryClient()
  const [sid, setSid]             = useState(null)
  const [messages, setMessages]   = useState([])
  const [streaming, setStreaming] = useState(null)
  const [busy, setBusy]           = useState(false)
  const bottomRef                 = useRef()
  const cancelRef                 = useRef()
  const startedRef                = useRef(false)

  const { data: proj } = useQuery({
    queryKey: ['project', project.id],
    queryFn: () => getProject(project.id),
    refetchInterval: busy ? 3000 : 10000
  })

  const iterations  = proj?.iterations || []
  const sessionId   = proj?.hermes_session_id || project.hermes_session_id
  const bestScore   = iterations.length
    ? Math.max(...iterations.map(i => Number(i.score) || 0))
    : null

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, streaming])

  useEffect(() => {
    if (!startedRef.current && project.objective) {
      startedRef.current = true
      kickoff()
    }
  }, [])

  function buildKickoffPrompt() {
    return [
      `# Research Project: ${project.name}`,
      ``,
      `**Objective:** ${project.objective}`,
      `**Max iterations:** ${project.max_iterations || 10}`,
      ``,
      `Begin the autoresearch loop:`,
      `1. Use Seven to research the topic thoroughly`,
      `2. Use Data to draft the initial document`,
      `3. Use One (invoke via collective__one) to judge the output on a 1-10 scale for clarity, completeness, and persuasiveness`,
      `4. Iterate: identify the weakest section, improve it, re-judge`,
      `5. Keep changes that improve the score, revert those that don't`,
      `6. Stop after ${project.max_iterations || 10} iterations or when score ≥ 9`,
      `7. Deliver the final document`,
      ``,
      `After each iteration, summarize: iteration number, score, decision (KEEP/REVERT), and what changed.`,
    ].join('\n')
  }

  async function kickoff() {
    await send(buildKickoffPrompt(), true)
  }

  async function ensureSession() {
    if (sid) return sid
    const s = await createSession('web')
    setSid(s.id)
    await updateProject(project.id, { hermes_session_id: s.id })
    qc.invalidateQueries(['project', project.id])
    return s.id
  }

  async function send(text, isSystem = false, explicitSession = null) {
    if (busy) return
    const session = explicitSession || await ensureSession()
    if (!isSystem) {
      setMessages(prev => [...prev, { role: 'user', content: text }])
    }
    setStreaming({ content: '', toolCalls: [] })
    setBusy(true)

    let finalContent = ''
    cancelRef.current = streamChat(session, text, {
      onDelta: delta => {
        finalContent += delta
        setStreaming(prev => ({ ...prev, content: finalContent }))
      },
      onTool: (name, preview) => {
        setStreaming(prev => ({
          ...prev,
          toolCalls: [...prev.toolCalls, { name, preview }]
        }))
      },
      onDone: () => {
        setMessages(prev => [...prev, { role: 'assistant', content: finalContent }])
        setStreaming(null)
        setBusy(false)
        qc.invalidateQueries(['project', project.id])
        qc.invalidateQueries(['projects'])
        qc.invalidateQueries(['children', session])
      },
      onError: err => {
        setMessages(prev => [...prev, { role: 'assistant', content: `_Error: ${err.message}_` }])
        setStreaming(null)
        setBusy(false)
      }
    })
  }

  async function resubmit() {
    if (busy) return
    try {
      // Clear previous iterations and reset project
      await fetch(`/projects/${project.id}/iterations`, { method: 'DELETE' })
      await updateProject(project.id, { status: 'active', best_score: null, hermes_session_id: null })
      // Fresh Hermes session
      const s = await createSession('web')
      setSid(s.id)
      await updateProject(project.id, { hermes_session_id: s.id })
      // Reset UI
      setMessages([])
      setStreaming(null)
      startedRef.current = true
      qc.invalidateQueries(['project', project.id])
      qc.invalidateQueries(['projects'])
      // Kickoff with explicit session to avoid stale sid state
      await send(buildKickoffPrompt(), true, s.id)
    } catch (err) {
      console.error('[resubmit] failed:', err)
    }
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-4 py-3 border-b border-borg-border bg-borg-surface shrink-0">
        <div className="flex items-center gap-2 mb-1">
          <button onClick={onBack} className="text-borg-dim hover:text-borg-text transition-colors">
            <ArrowLeft size={14} />
          </button>
          <h1 className="text-borg-green font-semibold text-sm flex-1">{project.name}</h1>
          <button
            onClick={resubmit}
            disabled={busy}
            title="Reset and restart research"
            className="flex items-center gap-1 text-xs text-borg-dim hover:text-borg-green border border-borg-border
                       hover:border-borg-green/40 rounded px-2 py-1 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <RefreshCw size={11} />
            Resubmit
          </button>
        </div>
        <div className="flex items-center gap-4 text-xs text-borg-dim ml-5">
          <span className="flex items-center gap-1">
            <Repeat size={10} />
            {iterations.length}/{proj?.max_iterations || project.max_iterations || '?'} iterations
          </span>
          {bestScore != null && bestScore > 0 && (
            <span className="flex items-center gap-1 text-borg-green">
              <Target size={10} />
              best score: {bestScore.toFixed(1)}
            </span>
          )}
          {busy && (
            <span className="text-borg-green animate-pulse">● running</span>
          )}
        </div>
      </div>

      {/* Content: messages + sidebar */}
      <div className="flex flex-1 overflow-hidden">
        {/* Thread */}
        <div className="flex flex-col flex-1 min-w-0">
          <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
            {messages.length === 0 && !streaming && (
              <div className="text-center text-borg-dim text-xs py-8">
                <div className="animate-pulse">Research loop running — see Live Activity →</div>
              </div>
            )}
            {messages.map((m, i) => (
              <Message key={i} role={m.role} content={m.content} />
            ))}
            {streaming && (
              <StreamingMessage
                content={streaming.content}
                toolCalls={streaming.toolCalls}
                isStreaming={busy}
              />
            )}
            <div ref={bottomRef} />
          </div>

          <MessageInput
            onSend={text => send(text)}
            disabled={busy}
            placeholder="Direct the research, ask for changes…"
          />
        </div>

        {/* Right panel */}
        <div className="w-64 shrink-0 border-l border-borg-border bg-borg-surface overflow-y-auto p-3 space-y-4">
          {/* Agent tree */}
          {sid && <SessionTree parentSessionId={sid} />}

          {/* Live activity feed */}
          {sessionId && <ActivityFeed sessionId={sessionId} />}

          {/* Iteration log */}
          {iterations.length > 0 && (
            <div className="border border-borg-border rounded bg-borg-surface p-3">
              <div className="text-xs text-borg-dim mb-2 uppercase tracking-wider">Iterations</div>
              {iterations.map(iter => (
                <IterationRow key={iter.id} iter={iter} />
              ))}
            </div>
          )}

          {/* Objective */}
          <div className="border border-borg-border rounded p-3 text-xs">
            <div className="text-borg-dim mb-1 uppercase tracking-wider">Objective</div>
            <p className="text-borg-muted leading-relaxed">{project.objective}</p>
          </div>
        </div>
      </div>
    </div>
  )
}
