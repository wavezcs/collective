const BASE = '/gate'

export async function getGateStatus() {
  const r = await fetch(`${BASE}/status`)
  return r.json()
}

export async function sendGateCommand(command, node = 'gate') {
  const r = await fetch(`${BASE}/command`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ command, node })
  })
  if (!r.ok) {
    const d = await r.json().catch(() => ({}))
    throw new Error(d.error || `Command failed (${r.status})`)
  }
  return r.json()
}

// Live updates via SSE. Returns a cleanup function.
// handlers: { snapshot, node, log, broker } — each receives parsed event data.
export function subscribeGateEvents(handlers) {
  const es = new EventSource(`${BASE}/events`)
  for (const event of ['snapshot', 'node', 'log', 'broker']) {
    if (handlers[event]) {
      es.addEventListener(event, e => handlers[event](JSON.parse(e.data)))
    }
  }
  if (handlers.error) es.onerror = handlers.error
  return () => es.close()
}
