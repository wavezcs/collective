const BASE = '/api'

export async function createSession(source = 'web') {
  const r = await fetch(`${BASE}/sessions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ source })
  })
  const d = await r.json()
  return d.session
}

export async function getSessions(limit = 50) {
  const r = await fetch(`${BASE}/sessions?limit=${limit}`)
  const d = await r.json()
  return d.items || []
}

export async function getMessages(sessionId) {
  const r = await fetch(`${BASE}/sessions/${sessionId}/messages`)
  return r.json()
}

export async function getSession(sessionId) {
  const r = await fetch(`${BASE}/sessions/${sessionId}`)
  const d = await r.json()
  return d.session
}

export async function getChildSessions(parentId) {
  const sessions = await getSessions(200)
  return sessions.filter(s => s.parent_session_id === parentId)
}

/**
 * Stream a chat turn via SSE.
 * Calls onDelta(text) for each token, onTool(name, preview) for tool calls,
 * onDone() when complete, onError(err) on failure.
 */
export function streamChat(sessionId, message, { onDelta, onTool, onDone, onError } = {}) {
  const controller = new AbortController()

  fetch(`${BASE}/sessions/${sessionId}/chat/stream`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message }),
    signal: controller.signal
  }).then(async res => {
    if (!res.ok) {
      onError?.(new Error(`HTTP ${res.status}`))
      return
    }
    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    let buf = ''

    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buf += decoder.decode(value, { stream: true })

      const blocks = buf.split('\n\n')
      buf = blocks.pop() // keep incomplete block

      for (const block of blocks) {
        const lines = block.trim().split('\n')
        let event = '', data = ''
        for (const l of lines) {
          if (l.startsWith('event: ')) event = l.slice(7)
          if (l.startsWith('data: '))  data  = l.slice(6)
        }
        if (!data) continue
        try {
          const payload = JSON.parse(data)
          if (event === 'assistant.delta') onDelta?.(payload.delta || '')
          if (event === 'tool.started')    onTool?.(payload.tool_name, payload.preview)
          if (event === 'tool.progress')   onDelta?.(payload.delta || '')
          if (event === 'run.completed')   onDone?.(payload)
        } catch { /* ignore malformed */ }
      }
    }
    onDone?.()
  }).catch(err => {
    if (err.name !== 'AbortError') onError?.(err)
  })

  return () => controller.abort()
}
