import React, { useState, useEffect, useRef } from 'react'
import { useQuery } from '@tanstack/react-query'
import { createSession, getMessages, streamChat } from '../api/hermes'
import { Message, StreamingMessage } from '../components/Message'
import MessageInput from '../components/MessageInput'
import SessionTree from '../components/SessionTree'
import { RotateCcw } from 'lucide-react'

export default function ChatView({ sessionId, onSessionCreated }) {
  const [sid, setSid]           = useState(sessionId)
  const [messages, setMessages] = useState([])
  const [streaming, setStreaming] = useState(null)  // {content, toolCalls}
  const [busy, setBusy]         = useState(false)
  const [showTree, setShowTree] = useState(false)
  const bottomRef               = useRef()
  const cancelRef               = useRef()

  // Load existing messages when session exists
  const { data: history } = useQuery({
    queryKey: ['messages', sid],
    queryFn: () => getMessages(sid),
    enabled: !!sid,
    staleTime: Infinity,
  })

  useEffect(() => {
    if (history) {
      const msgs = (history.messages || history || []).filter(m =>
        m.role === 'user' || m.role === 'assistant'
      ).map(m => ({
        role: m.role,
        content: typeof m.content === 'string' ? m.content : ''
      }))
      setMessages(msgs)
    }
  }, [history])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, streaming])

  async function ensureSession() {
    if (sid) return sid
    const s = await createSession('web')
    setSid(s.id)
    onSessionCreated?.(s.id)
    return s.id
  }

  async function send(text) {
    if (busy) return
    const session = await ensureSession()
    setMessages(prev => [...prev, { role: 'user', content: text }])
    setStreaming({ content: '', toolCalls: [] })
    setBusy(true)
    setShowTree(true)

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
        setMessages(prev => [
          ...prev,
          { role: 'assistant', content: finalContent }
        ])
        setStreaming(null)
        setBusy(false)
      },
      onError: err => {
        console.error(err)
        setMessages(prev => [
          ...prev,
          { role: 'assistant', content: `_Error: ${err.message}_` }
        ])
        setStreaming(null)
        setBusy(false)
      }
    })
  }

  async function newChat() {
    cancelRef.current?.()
    setSid(null)
    setMessages([])
    setStreaming(null)
    setBusy(false)
    setShowTree(false)
    onSessionCreated?.(null)
  }

  return (
    <div className="flex h-full">
      {/* Main chat column */}
      <div className="flex flex-col flex-1 min-w-0">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-borg-border bg-borg-surface shrink-0">
          <div>
            <div className="text-borg-green font-semibold text-sm">Locutus</div>
            <div className="text-borg-dim text-xs">{sid ? sid.slice(0, 16) + '…' : 'New session'}</div>
          </div>
          <div className="flex items-center gap-2">
            {sid && (
              <button
                onClick={() => setShowTree(t => !t)}
                className="text-xs text-borg-dim hover:text-borg-text px-2 py-1 rounded border border-borg-border hover:border-borg-green/40 transition-colors"
              >
                {showTree ? 'Hide' : 'Show'} agents
              </button>
            )}
            <button
              onClick={newChat}
              className="flex items-center gap-1.5 text-xs text-borg-dim hover:text-borg-text px-2 py-1 rounded border border-borg-border hover:border-borg-green/40 transition-colors"
            >
              <RotateCcw size={11} /> New
            </button>
          </div>
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
          {messages.length === 0 && !streaming && (
            <div className="flex flex-col items-center justify-center h-full text-borg-dim text-center space-y-3">
              <div className="text-4xl opacity-20">◈</div>
              <div>
                <div className="text-borg-muted">The Collective awaits.</div>
                <div className="text-xs mt-1">Ask Locutus anything, or start a research project.</div>
              </div>
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

        <MessageInput onSend={send} disabled={busy} />
      </div>

      {/* Agent tree panel */}
      {showTree && sid && (
        <div className="w-64 shrink-0 border-l border-borg-border bg-borg-surface overflow-y-auto p-3">
          <SessionTree parentSessionId={sid} />
        </div>
      )}
    </div>
  )
}
