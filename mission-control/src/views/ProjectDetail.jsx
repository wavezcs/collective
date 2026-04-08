import React, { useState, useEffect, useRef } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { getProject, updateProject } from '../api/projects'
import { createSession, streamChat } from '../api/hermes'
import { Message, StreamingMessage } from '../components/Message'
import MessageInput from '../components/MessageInput'
import SessionTree from '../components/SessionTree'
import { ArrowLeft, Target, Repeat, CheckCircle, XCircle, Clock } from 'lucide-react'

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

  const iterations = proj?.iterations || []

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, streaming])

  // Auto-start the research loop on first load
  useEffect(() => {
    if (!startedRef.current && project.objective) {
      startedRef.current = true
      kickoff()
    }
  }, [])

  async function kickoff() {
    const initialPrompt = [
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

    await send(initialPrompt, true)
  }

  async function ensureSession() {
    if (sid) return sid
    const s = await createSession('web')
    setSid(s.id)
    // Link session to project
    await updateProject(project.id, { hermes_session_id: s.id })
    qc.invalidateQueries(['project', project.id])
    return s.id
  }

  async function send(text, isSystem = false) {
    if (busy) return
    const session = await ensureSession()
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
        qc.invalidateQueries(['children', session])
      },
      onError: err => {
        setMessages(prev => [...prev, { role: 'assistant', content: `_Error: ${err.message}_` }])
        setStreaming(null)
        setBusy(false)
      }
    })
  }

  const bestScore = iterations.length
    ? Math.max(...iterations.map(i => Number(i.score) || 0))
    : null

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-4 py-3 border-b border-borg-border bg-borg-surface shrink-0">
        <div className="flex items-center gap-2 mb-1">
          <button onClick={onBack} className="text-borg-dim hover:text-borg-text transition-colors">
            <ArrowLeft size={14} />
          </button>
          <h1 className="text-borg-green font-semibold text-sm">{project.name}</h1>
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
                <div className="animate-pulse">Starting research loop…</div>
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

        {/* Right panel: iterations + agent tree */}
        <div className="w-64 shrink-0 border-l border-borg-border bg-borg-surface overflow-y-auto p-3 space-y-4">
          {/* Agent tree */}
          {sid && <SessionTree parentSessionId={sid} />}

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
