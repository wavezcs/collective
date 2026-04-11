import React, { useState, useEffect, useRef, useMemo } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { getProject, updateProject } from '../api/projects'
import { createSession, streamChat, getMessages, getSession } from '../api/hermes'
import { Message, StreamingMessage } from '../components/Message'
import MessageInput from '../components/MessageInput'
import SessionTree from '../components/SessionTree'
import {
  ArrowLeft, Target, Repeat, CheckCircle, XCircle, Clock,
  Search, Database, Cpu, List, Globe, RefreshCw, Zap, Brain, Activity
} from 'lucide-react'

// ─── Activity parsing ─────────────────────────────────────────────────────────

function extractToolName(callStr) {
  const m = String(callStr).match(/'function'.*?'name'[^:]*:\s*'([\w_]+)'/)
  return m ? m[1] : null
}

function parseActivities(messages) {
  const acts = []
  for (const m of messages) {
    if (m.role === 'user') continue
    if (m.role === 'assistant') {
      const tc = m.tool_calls
      if (Array.isArray(tc) && tc.length > 0) {
        for (const c of tc) {
          const name = extractToolName(c)
          if (name) acts.push({ type: 'tool', name, ts: m.timestamp })
        }
      }
      if (m.reasoning && m.reasoning !== 'None') {
        acts.push({ type: 'thinking', text: m.reasoning, ts: m.timestamp })
      }
      if (m.content) {
        acts.push({ type: 'response', text: m.content, ts: m.timestamp })
      }
    }
    if (m.role === 'tool') {
      try {
        const parsed = JSON.parse(m.content)
        if (parsed?.data?.web) {
          acts.push({ type: 'web_result', count: parsed.data.web.length, title: parsed.data.web[0]?.title, ts: m.timestamp })
        } else if (parsed?.todos) {
          const active = parsed.todos.find(t => t.status === 'in_progress') || parsed.todos[0]
          if (active) acts.push({ type: 'todo', text: active.content, ts: m.timestamp })
        }
      } catch { /* non-JSON */ }
    }
  }
  return acts
}

// ─── Activity components ──────────────────────────────────────────────────────

const TOOL_ICONS   = { web_search: Search, web_extract: Globe, todo: List, delegate_task: Cpu, process: Cpu, mcp_collective_vinculum: Database, mcp_collective_one: Zap }
const TOOL_LABELS  = { web_search: 'Web search', web_extract: 'Reading page', todo: 'Task update', delegate_task: 'Delegating to agent', process: 'Agent subprocess', mcp_collective_vinculum: 'Memory query', mcp_collective_one: 'Calling One' }

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
    return <div className="text-xs text-borg-dim/70 italic pl-3 border-l border-borg-border line-clamp-2 leading-relaxed">{activity.text}</div>
  }
  if (activity.type === 'web_result') {
    return (
      <div className="text-xs pl-3">
        <span className="text-borg-green">{activity.count} results</span>
        {activity.title && <span className="text-borg-dim/60"> — {activity.title.slice(0, 45)}</span>}
      </div>
    )
  }
  if (activity.type === 'todo') {
    return <div className="text-xs text-borg-muted pl-3 line-clamp-1">→ {activity.text}</div>
  }
  if (activity.type === 'response') {
    return <div className="text-xs text-borg-text/80 pl-3 border-l border-borg-green/30 line-clamp-2 leading-relaxed">{activity.text}</div>
  }
  return null
}

function deriveCurrentStep(activities, sessionInfo, isGenerating) {
  if (!sessionInfo) return null
  if (sessionInfo.ended_at) return { label: 'Complete', dim: true }

  if (isGenerating) {
    // Find the most recent tool call to give context to what's being generated
    const lastTool = [...activities].reverse().find(a => a.type === 'tool')
    const context = lastTool ? `after ${TOOL_LABELS[lastTool.name] || lastTool.name}` : null
    return { label: 'Generating response', context, active: true }
  }

  // Not generating — infer from last stored activity
  const last = [...activities].reverse().find(a => a.type === 'tool' || a.type === 'thinking')
  if (last?.type === 'tool') {
    return { label: `Awaiting result`, context: TOOL_LABELS[last.name] || last.name, waiting: true }
  }
  return { label: 'Idle', dim: true }
}

function ActivityFeed({ hermesMessages, sessionInfo, isGenerating }) {
  const activities = parseActivities(hermesMessages)
  const currentStep = deriveCurrentStep(activities, sessionInfo, isGenerating)

  return (
    <div className="border border-borg-border rounded bg-borg-surface p-3">
      <div className="text-xs text-borg-dim mb-2 uppercase tracking-wider flex items-center gap-1.5">
        <Brain size={9} />
        Activity
        {isGenerating && <span className="ml-auto w-1.5 h-1.5 rounded-full bg-borg-green animate-pulse" />}
      </div>

      {/* Current step */}
      {currentStep && (
        <div className={`flex items-start gap-1.5 text-xs mb-2 pb-2 border-b border-borg-border
          ${currentStep.active ? 'text-borg-green' : currentStep.dim ? 'text-borg-dim' : 'text-borg-muted'}`}>
          <span className={currentStep.active ? 'animate-pulse mt-0.5' : 'mt-0.5'}>●</span>
          <div>
            <div className="font-medium">{currentStep.label}</div>
            {currentStep.context && <div className="text-borg-dim/70 mt-0.5">{currentStep.context}</div>}
          </div>
        </div>
      )}

      {/* History */}
      {activities.length > 0 && (
        <div className="space-y-1.5 max-h-48 overflow-y-auto">
          {activities.slice(-20).reverse().map((a, i) => (
            <ActivityItem key={i} activity={a} />
          ))}
        </div>
      )}
    </div>
  )
}

// ─── Iteration row ────────────────────────────────────────────────────────────

function IterationRow({ iter }) {
  const icon = { keep: <CheckCircle size={12} className="text-borg-green shrink-0" />, revert: <XCircle size={12} className="text-red-400 shrink-0" />, pending: <Clock size={12} className="text-borg-dim shrink-0" /> }[iter.decision] || <Clock size={12} className="text-borg-dim shrink-0" />
  return (
    <div className="flex items-start gap-2 py-2 border-b border-borg-border/50 last:border-0 text-xs">
      <span className="text-borg-dim w-6 shrink-0 text-right">#{iter.number}</span>
      {icon}
      <div className="flex-1 min-w-0">
        {iter.summary && <div className="text-borg-muted truncate">{iter.summary}</div>}
        {iter.judge_reasoning && <div className="text-borg-dim/70 mt-0.5 line-clamp-2">{iter.judge_reasoning}</div>}
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
  const qc = useQueryClient()

  // ── Session / streaming state ──────────────────────────────────────────────
  const [sid, setSid]             = useState(null)
  const [localMessages, setLocal] = useState([])   // optimistic user messages
  const [streaming, setStreaming] = useState(null)
  const [busy, setBusy]           = useState(false)
  // 'confirming' = waiting for user to approve plan | 'running' = loop active
  const [phase, setPhase]         = useState('confirming')
  const cancelRef                 = useRef()
  const startedRef                = useRef(false)

  // ── Scroll state ───────────────────────────────────────────────────────────
  const scrollRef     = useRef()   // the scrollable div
  const isAtBottom    = useRef(true)
  const didInitScroll = useRef(false)

  function handleScroll() {
    const el = scrollRef.current
    if (!el) return
    isAtBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80
  }

  function scrollToBottom(behavior = 'smooth') {
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }

  // ── Project data ───────────────────────────────────────────────────────────
  const { data: proj } = useQuery({
    queryKey: ['project', project.id],
    queryFn: () => getProject(project.id),
    refetchInterval: busy ? 3000 : 10000
  })

  const iterations = proj?.iterations || []
  const sessionId  = proj?.hermes_session_id || project.hermes_session_id
  const bestScore  = iterations.length ? Math.max(...iterations.map(i => Number(i.score) || 0)) : null

  // ── Hermes message history (source of truth) ───────────────────────────────
  const { data: hermesMessages = [] } = useQuery({
    queryKey: ['hermes-messages', sessionId],
    queryFn: () => getMessages(sessionId).then(d => d.items || []),
    refetchInterval: busy ? false : 4000,
    enabled: !!sessionId,
    staleTime: 0,
  })

  // ── Session token stats — poll every 5s ────────────────────────────────────
  const { data: sessionInfo } = useQuery({
    queryKey: ['session-info', sessionId],
    queryFn: () => getSession(sessionId),
    refetchInterval: 5000,
    enabled: !!sessionId,
    staleTime: 0,
  })

  // Detect active generation + compute tokens/s between polls
  const prevOutputTokens = useRef(0)
  const prevPollTime     = useRef(null)
  const [isGenerating, setIsGenerating]   = useState(false)
  const [tokensPerSec, setTokensPerSec]   = useState(null)
  const [staleSecs, setStaleSecs]         = useState(0)
  const [stallDismissed, setStallDismissed] = useState(false)
  const lastTokenChangeAt                  = useRef(null)

  // On each poll: detect generation and track last token movement
  useEffect(() => {
    if (!sessionInfo) return
    const cur = sessionInfo.output_tokens || 0
    const now = Date.now()
    const moved = cur > prevOutputTokens.current

    if (moved) {
      lastTokenChangeAt.current = now
      if (prevPollTime.current) {
        const dt = (now - prevPollTime.current) / 1000
        setTokensPerSec(dt > 0 ? Math.round((cur - prevOutputTokens.current) / dt) : null)
      }
    }

    const generating = !sessionInfo.ended_at && moved
    setIsGenerating(generating)
    if (!moved) setTokensPerSec(null)
    // Clear dismiss when tokens resume — stall is no longer relevant
    if (moved) setStallDismissed(false)

    prevOutputTokens.current = cur
    prevPollTime.current = now
  }, [sessionInfo])

  // Tick every second to update staleness display
  useEffect(() => {
    const timer = setInterval(() => {
      if (lastTokenChangeAt.current) {
        setStaleSecs(Math.floor((Date.now() - lastTokenChangeAt.current) / 1000))
      }
    }, 1000)
    return () => clearInterval(timer)
  }, [])

  // Backend status is authoritative (updated every 30s by projects-api health monitor).
  // Frontend staleness is a fast fallback for the current browser session.
  // Neither applies during the confirming phase — session is idle by design.
  const backendStalled  = phase !== 'confirming' && proj?.status === 'stalled'
  const frontendStalled = phase !== 'confirming' && !!(
    sessionInfo &&
    !sessionInfo.ended_at &&
    !isGenerating &&
    (sessionInfo.output_tokens || 0) > 0 &&
    lastTokenChangeAt.current &&
    staleSecs > 30
  )
  const isStalled = !stallDismissed && (backendStalled || frontendStalled)

  function formatStaleDuration(s) {
    if (s < 60) return `${s}s`
    return `${Math.floor(s / 60)}m ${s % 60}s`
  }

  // ── Derive display messages from Hermes + optimistic local ─────────────────
  // Hermes persisted: user + assistant messages with content
  // Kickoff prompt is shown as a compact header item, not a full user bubble
  const displayMessages = useMemo(() => {
    const persisted = hermesMessages
      .filter(m => (m.role === 'user' || m.role === 'assistant') && m.content)
      .map(m => ({
        id: m.id,
        role: m.role,
        content: m.content,
        ts: m.timestamp ? new Date(parseFloat(m.timestamp) * 1000) : null,
        isKickoff: m.role === 'user' && m.content.startsWith('# Research Project:')
      }))

    // Append local user messages not yet in Hermes (optimistic)
    const persistedContent = new Set(persisted.map(m => m.content))
    const pending = localMessages.filter(m => !persistedContent.has(m.content))

    return [...persisted, ...pending]
  }, [hermesMessages, localMessages])

  // ── Initial scroll to bottom when history first loads ─────────────────────
  useEffect(() => {
    if (displayMessages.length > 0 && !didInitScroll.current) {
      didInitScroll.current = true
      // Use instant scroll for initial load so we land at the bottom
      requestAnimationFrame(() => {
        scrollToBottom('instant')
        isAtBottom.current = true
      })
    }
  }, [displayMessages])

  // ── Tail scroll on new messages / streaming (only if at bottom) ────────────
  useEffect(() => {
    if (isAtBottom.current) scrollToBottom('smooth')
  }, [displayMessages.length, streaming?.content])

  // ── Kickoff / reconnect on mount ───────────────────────────────────────────
  useEffect(() => {
    if (project.hermes_session_id) {
      setSid(project.hermes_session_id)
      // research_started_at is set when user clicks Start Research.
      // If it's set, kickoff was sent. If not, session is still in confirmation.
      if (project.research_started_at) {
        setPhase('running')
      } else {
        setPhase('confirming')
      }
      startedRef.current = true
    } else if (!startedRef.current && project.objective) {
      startedRef.current = true
      kickoff()
    }
  }, [])

  // ── Helpers ────────────────────────────────────────────────────────────────
  function buildConfirmationPrompt() {
    return [
      `# New Research Project Submitted`,
      ``,
      `**Name:** ${project.name}`,
      `**Objective:** ${project.objective}`,
      `**Max iterations:** ${project.max_iterations || 10}`,
      ``,
      `**How the loop works (reflect this accurately in your plan):**`,
      `- You research using web_search (short keyword queries) and write the document yourself`,
      `- After each draft, you call collective__one with the document text and ask One to score it 1-10 and identify the weakest section. One is the scorer only — it does not do research or writing.`,
      `- You iterate based on One's feedback until score ≥ 9 or max iterations reached`,
      ``,
      `Before starting, please do the following:`,
      `1. Restate what you understand this project to be — in your own words, not the user's`,
      `2. Lay out your execution plan: what topics you'll research, how you'll structure the deliverable, and what success looks like`,
      `3. Ask the user if they'd like to adjust anything before you begin`,
      ``,
      `Do NOT start the research loop yet. Wait for the user's confirmation.`,
    ].join('\n')
  }

  function buildKickoffPrompt() {
    return [
      `# Research Project: ${project.name}`,
      ``,
      `**Project ID:** ${project.id}`,
      `**Objective:** ${project.objective}`,
      `**Max iterations:** ${project.max_iterations || 10}`,
      ``,
      `Start the research loop now. Do not ask for confirmation — begin immediately.`,
      ``,
      `**Loop structure (repeat until score ≥ 9 or ${project.max_iterations || 10} iterations):**`,
      ``,
      `1. **Research** — run short web_search queries (under 150 chars each). After each search, write a 2-3 sentence summary of what you learned. Do NOT paste raw results into your reply.`,
      `2. **Draft** — write or revise the document based on your research summaries.`,
      `3. **Judge** — call collective__one with: (a) the full document text, (b) the objective, (c) ask One to score it 1-10 for clarity/completeness/persuasiveness and identify the single weakest section. One is the judge — do not self-score.`,
      `4. **Record** — after receiving One's score, record the iteration via terminal (replace SCORE, DECISION, REASONING, SUMMARY with actual values):`,
      `   curl -s -X POST http://localhost:3002/projects/${project.id}/iterations -H 'Content-Type: application/json' -d '{"score":SCORE,"decision":"DECISION","judge_reasoning":"REASONING","summary":"SUMMARY"}'`,
      `   DECISION must be exactly "keep" or "revert".`,
      `5. **Decide** — if score improved, keep changes. If not, revert. Tell the user: iteration #, score, KEEP/REVERT, one sentence on what changed.`,
      ``,
      `**Rules:**`,
      `- web_search queries must be short keywords, never full paragraphs`,
      `- Summarize research findings — never paste raw search results into replies`,
      `- One judges only — all research and drafting is yours`,
      `- After delivering the final document, stop`,
    ].join('\n')
  }

  async function kickoff() {
    setPhase('confirming')
    await send(buildConfirmationPrompt(), true)
  }

  async function startResearch(explicitSession = null) {
    setPhase('running')
    await updateProject(project.id, { research_started_at: new Date().toISOString() })
    await send(buildKickoffPrompt(), true, explicitSession)
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
    if (!isSystem) setLocal(prev => [...prev, { role: 'user', content: text }])
    setStreaming({ content: '', toolCalls: [] })
    setBusy(true)

    let finalContent = ''
    cancelRef.current = streamChat(session, text, {
      onDelta: delta => {
        finalContent += delta
        setStreaming(prev => ({ ...prev, content: finalContent }))
      },
      onTool: (name, preview) => {
        setStreaming(prev => ({ ...prev, toolCalls: [...prev.toolCalls, { name, preview }] }))
      },
      onDone: () => {
        setStreaming(null)
        setBusy(false)
        // Invalidate Hermes messages — the completed response will appear via polling
        qc.invalidateQueries(['hermes-messages', session])
        qc.invalidateQueries(['project', project.id])
        qc.invalidateQueries(['projects'])
        qc.invalidateQueries(['children', session])
      },
      onError: err => {
        setLocal(prev => [...prev, { role: 'assistant', content: `_Error: ${err.message}_` }])
        setStreaming(null)
        setBusy(false)
      }
    })
  }

  async function resubmit() {
    if (busy) return
    try {
      await fetch(`/projects/${project.id}/iterations`, { method: 'DELETE' })
      await updateProject(project.id, { status: 'active', best_score: null, hermes_session_id: null, research_started_at: null })
      const s = await createSession('web')
      setSid(s.id)
      await updateProject(project.id, { hermes_session_id: s.id })
      setLocal([])
      setStreaming(null)
      setPhase('confirming')
      didInitScroll.current = false
      startedRef.current = true
      qc.invalidateQueries(['hermes-messages', s.id])
      qc.invalidateQueries(['project', project.id])
      qc.invalidateQueries(['projects'])
      await send(buildConfirmationPrompt(), true, s.id)
    } catch (err) {
      console.error('[resubmit]', err)
    }
  }

  // ── Render ─────────────────────────────────────────────────────────────────
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
          {isStalled
            ? <span className="text-red-400">⚠ stalled</span>
            : (busy || isGenerating) && <span className="text-borg-green animate-pulse">● running</span>
          }
        </div>
      </div>

      {/* Content */}
      <div className="flex flex-1 overflow-hidden">
        {/* Message thread */}
        <div className="flex flex-col flex-1 min-w-0">
          <div
            ref={scrollRef}
            onScroll={handleScroll}
            className="flex-1 overflow-y-auto px-4 py-4 space-y-4"
          >
            {displayMessages.length === 0 && !streaming && (
              <div className="text-center text-borg-dim text-xs py-8">
                <div className="animate-pulse">
                  {sessionId ? 'Research in progress — see Live Activity →' : 'Starting research loop…'}
                </div>
              </div>
            )}

            {displayMessages.map((m, i) =>
              m.isKickoff ? (
                <div key={m.id || i} className="flex justify-center">
                  <span className="text-xs text-borg-dim border border-borg-border rounded px-2 py-0.5">
                    Research loop initiated{m.ts ? ` · ${m.ts.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : ''}
                  </span>
                </div>
              ) : (
                <div key={m.id || i} className="space-y-0.5">
                  <Message role={m.role} content={m.content} />
                  {m.ts && (
                    <div className={`text-xs text-borg-dim/50 px-1 ${m.role === 'user' ? 'text-right' : 'text-left ml-11'}`}>
                      {m.ts.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </div>
                  )}
                </div>
              )
            )}

            {streaming && (
              <StreamingMessage
                content={streaming.content}
                toolCalls={streaming.toolCalls}
                isStreaming={busy}
              />
            )}

            <div ref={el => {
              // Scroll anchor — also used as a sentinel
              if (el && isAtBottom.current) {
                // kept for layout
              }
            }} />
          </div>

          {/* Stall warning banner */}
          {isStalled && (
            <div className="mx-4 mb-2 px-3 py-2 rounded border border-red-500/40 bg-red-500/10 text-xs text-red-400 flex items-center gap-3">
              <span className="flex-1">⚠ Session stalled — no token activity for {formatStaleDuration(staleSecs)}. The gateway may have restarted.</span>
              <button
                onClick={resubmit}
                className="shrink-0 px-2 py-1 rounded border border-red-400/50 hover:bg-red-400/10 transition-colors whitespace-nowrap"
              >
                Resubmit
              </button>
              <button
                onClick={() => setStallDismissed(true)}
                className="shrink-0 text-red-400/60 hover:text-red-400 transition-colors px-1"
                title="Dismiss"
              >
                ✕
              </button>
            </div>
          )}

          {/* Start Research prompt — shown after Locutus confirms the plan */}
          {phase === 'confirming' && !busy && displayMessages.some(m => m.role === 'assistant') && (
            <div className="px-4 pb-3 flex gap-2">
              <button
                onClick={() => startResearch()}
                className="flex-1 py-2 rounded border border-borg-green/60 bg-borg-green/10 text-borg-green
                           text-sm font-medium hover:bg-borg-green/20 transition-colors"
              >
                Start Research
              </button>
            </div>
          )}

          <MessageInput
            onSend={text => send(text)}
            disabled={busy}
            placeholder={phase === 'confirming'
              ? 'Suggest changes, or click Start Research above…'
              : 'Direct the research, ask for changes…'}
          />
        </div>

        {/* Right panel */}
        <div className="w-64 shrink-0 border-l border-borg-border bg-borg-surface overflow-y-auto p-3 space-y-4">
          {sid && <SessionTree parentSessionId={sid} />}

          {/* Token stats */}
          {sessionInfo && (
            <div className="border border-borg-border rounded bg-borg-surface p-3">
              <div className="text-xs text-borg-dim mb-2 uppercase tracking-wider flex items-center gap-1.5">
                <Activity size={9} />
                Session
                {isGenerating && <span className="ml-auto w-1.5 h-1.5 rounded-full bg-borg-green animate-pulse" />}
              </div>
              <div className="space-y-1.5 text-xs">
                <div className="flex justify-between items-center">
                  <span className="text-borg-dim">Status</span>
                  <span className={
                    isGenerating  ? 'text-borg-green font-medium' :
                    isStalled     ? 'text-red-400 font-medium' :
                    sessionInfo.ended_at ? 'text-borg-muted' : 'text-borg-dim'
                  }>
                    {isGenerating  ? '● Generating' :
                     isStalled     ? '⚠ Stalled' :
                     sessionInfo.ended_at ? '✓ Complete' : '○ Idle'}
                  </span>
                </div>
                {isStalled && (
                  <div className="text-red-400/80 text-xs">
                    No activity for {formatStaleDuration(staleSecs)}
                  </div>
                )}
                <div className="flex justify-between items-center">
                  <span className="text-borg-dim">Input tokens</span>
                  <span className="font-mono text-borg-text">{(sessionInfo.input_tokens || 0).toLocaleString()}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-borg-dim">Output tokens</span>
                  <span className={`font-mono ${isGenerating ? 'text-borg-green' : 'text-borg-text'}`}>
                    {(sessionInfo.output_tokens || 0).toLocaleString()}
                    {isGenerating && ' ↑'}
                  </span>
                </div>
                {tokensPerSec != null && (
                  <div className="flex justify-between items-center">
                    <span className="text-borg-dim">Speed</span>
                    <span className="font-mono text-borg-green">{tokensPerSec} tok/s</span>
                  </div>
                )}
              </div>
            </div>
          )}

          {sessionId && <ActivityFeed hermesMessages={hermesMessages} sessionInfo={sessionInfo} isGenerating={isGenerating} />}
          {iterations.length > 0 && (
            <div className="border border-borg-border rounded bg-borg-surface p-3">
              <div className="text-xs text-borg-dim mb-2 uppercase tracking-wider">Iterations</div>
              {iterations.map(iter => <IterationRow key={iter.id} iter={iter} />)}
            </div>
          )}
          <div className="border border-borg-border rounded p-3 text-xs">
            <div className="text-borg-dim mb-1 uppercase tracking-wider">Objective</div>
            <p className="text-borg-muted leading-relaxed">{project.objective}</p>
          </div>
        </div>
      </div>
    </div>
  )
}
