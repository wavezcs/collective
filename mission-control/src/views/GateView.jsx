import React, { useState, useEffect, useRef } from 'react'
import { sendGateCommand, subscribeGateEvents } from '../api/gate'
import {
  DoorOpen, DoorClosed, Radio, Wifi, WifiOff, Loader2,
  Bot, Activity, RefreshCw, Bell
} from 'lucide-react'

const NODE_META = {
  gate:  { label: 'Gate',  desc: 'controller @ gate' },
  front: { label: 'Front', desc: 'BLE scanner, front yard' },
  back:  { label: 'Back',  desc: 'BLE scanner, back yard' },
}

function fmtTime(iso) {
  if (!iso) return '—'
  return new Date(iso).toLocaleTimeString('en-US', { hour12: false })
}

function rssiOf(node) {
  // gate publishes rssiAvg in status; front/back publish rssiAvg in status, rssi in config
  const s = node.status || {}
  const c = node.config || {}
  const v = s.rssiAvg ?? c.rssi
  return typeof v === 'number' ? v : null
}

function lubaPresentOf(node) {
  const s = node.status || {}
  const c = node.config || {}
  if (typeof s.lubaPresent === 'boolean') return s.lubaPresent
  if (typeof c.lubaPresent === 'boolean') return c.lubaPresent
  // front/back status omits presence; RSSI of -100 means not seen
  const r = rssiOf(node)
  return r !== null && r > -100
}

function RssiBar({ rssi, areaRssi = -87, triggerRssi = -76 }) {
  if (rssi === null || rssi <= -100) {
    return <span className="text-borg-dim text-xs">no signal</span>
  }
  // Map -100..-40 dBm to 0..100%
  const pctOf = v => Math.max(0, Math.min(100, ((v + 100) / 60) * 100))
  const pct = pctOf(rssi)
  const color = rssi >= triggerRssi ? 'bg-borg-accent'
              : rssi >= areaRssi    ? 'bg-borg-warning'
              : 'bg-borg-dim'
  return (
    <div className="flex items-center gap-2">
      <div className="relative flex-1 h-1.5 rounded-full bg-borg-panel">
        <div className={`absolute inset-y-0 left-0 rounded-full transition-all duration-500 ${color}`} style={{ width: `${pct}%` }} />
        <span className="absolute -inset-y-0.5 w-px bg-borg-warning/60" style={{ left: `${pctOf(areaRssi)}%` }} title={`approach ≥ ${areaRssi} dBm`} />
        <span className="absolute -inset-y-0.5 w-px bg-borg-accent/60" style={{ left: `${pctOf(triggerRssi)}%` }} title={`trigger ≥ ${triggerRssi} dBm`} />
      </div>
      <span className="text-xs text-borg-muted tabular-nums w-14 text-right whitespace-nowrap shrink-0">{Math.round(rssi)} dBm</span>
    </div>
  )
}

function NodeCard({ id, node }) {
  const meta = NODE_META[id]
  const cfg = node.config || {}
  const rssi = rssiOf(node)
  const present = lubaPresentOf(node)
  return (
    <div className="rounded-lg border border-borg-border bg-borg-surface p-4">
      <div className="flex items-center justify-between mb-1">
        <div className="flex items-center gap-2">
          <Radio size={14} className={node.online ? 'text-borg-accent' : 'text-borg-dim'} />
          <span className="text-sm font-medium text-borg-text">{meta.label}</span>
        </div>
        <span className={`flex items-center gap-1.5 text-xs ${node.online ? 'text-borg-success' : 'text-borg-danger'}`}>
          <span className={`w-1.5 h-1.5 rounded-full ${node.online ? 'bg-borg-success' : 'bg-borg-danger'}`} />
          {node.online ? 'online' : 'offline'}
        </span>
      </div>
      <div className="text-xs text-borg-dim mb-3">{meta.desc}</div>

      <div className="space-y-2">
        <div>
          <div className="flex items-center justify-between text-xs text-borg-muted mb-1">
            <span className="flex items-center gap-1.5">
              <Bot size={11} className={present ? 'text-borg-accent' : 'text-borg-dim'} />
              Luba {present ? 'in range' : 'not seen'}
            </span>
            <span className="text-borg-dim">{fmtTime(node.statusAt)}</span>
          </div>
          <RssiBar rssi={rssi} areaRssi={Number(cfg.areaRssi) || -87} triggerRssi={Number(cfg.triggerRssi) || -76} />
        </div>
        {cfg.triggerRssi !== undefined && (
          <div className="text-xs text-borg-dim">
            zones: approach ≥ {cfg.areaRssi} dBm · trigger ≥ {cfg.triggerRssi} dBm
          </div>
        )}
      </div>
    </div>
  )
}

export default function GateView() {
  const [nodes, setNodes] = useState(null)   // null until snapshot arrives
  const [logs, setLogs] = useState([])
  const [broker, setBroker] = useState('connecting')
  const [connected, setConnected] = useState(false)
  const [pending, setPending] = useState(null) // command in flight
  const [error, setError] = useState(null)
  const logEndRef = useRef(null)

  useEffect(() => {
    const close = subscribeGateEvents({
      snapshot: s => {
        setNodes(s.nodes)
        setLogs(s.logs)
        setBroker(s.broker)
        setConnected(true)
      },
      node: d => {
        const { node, ...rec } = d
        setNodes(prev => ({ ...prev, [node]: rec }))
      },
      log: entry => setLogs(prev => [...prev.slice(-199), entry]),
      broker: d => setBroker(d.broker),
      error: () => setConnected(false), // EventSource auto-reconnects
    })
    return close
  }, [])

  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [logs])

  async function command(cmd, node = 'gate') {
    setPending(cmd)
    setError(null)
    try {
      await sendGateCommand(cmd, node)
    } catch (e) {
      setError(e.message)
    } finally {
      setPending(null)
    }
  }

  const gate = nodes?.gate
  const gateState = gate?.status?.gateState ?? gate?.config?.gateState ?? 'unknown'
  const isOpen = gateState === 'open'

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-4 border-b border-borg-border">
        <div className="flex items-center gap-2.5">
          {isOpen ? <DoorOpen size={18} className="text-borg-accent" /> : <DoorClosed size={18} className="text-borg-muted" />}
          <h1 className="text-sm font-semibold text-borg-text">Gate</h1>
          <span className="text-xs text-borg-dim">gateduino · mqtt</span>
        </div>
        <div className="flex items-center gap-2 text-xs text-borg-muted">
          {connected && broker === 'connected'
            ? <><Wifi size={12} className="text-borg-success" /> live</>
            : <><WifiOff size={12} className="text-borg-danger" /> {connected ? `broker ${broker}` : 'reconnecting…'}</>}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-5 space-y-5">
        {!nodes ? (
          <div className="flex items-center gap-2 text-borg-muted text-sm">
            <Loader2 size={14} className="animate-spin" /> Connecting…
          </div>
        ) : (
          <>
            {/* Gate control */}
            <div className="rounded-lg border border-borg-border bg-borg-surface p-5">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-xs text-borg-muted mb-1">Gate state</div>
                  <div className={`text-2xl font-semibold tracking-tight ${isOpen ? 'text-borg-accent' : 'text-borg-text'}`}>
                    {gateState.toUpperCase()}
                  </div>
                  <div className="text-xs text-borg-dim mt-1">updated {fmtTime(gate?.statusAt)}</div>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => command('OPEN')}
                    disabled={pending !== null || !gate?.online}
                    className="flex items-center gap-2 px-4 py-2.5 rounded-md text-sm font-medium
                               bg-borg-accent/15 text-borg-accent hover:bg-borg-accent/25
                               disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                  >
                    {pending === 'OPEN' ? <Loader2 size={14} className="animate-spin" /> : <DoorOpen size={14} />}
                    Open
                  </button>
                  <button
                    onClick={() => command('CLOSE')}
                    disabled={pending !== null || !gate?.online}
                    className="flex items-center gap-2 px-4 py-2.5 rounded-md text-sm font-medium
                               bg-borg-panel text-borg-text hover:bg-borg-panel/70
                               disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                  >
                    {pending === 'CLOSE' ? <Loader2 size={14} className="animate-spin" /> : <DoorClosed size={14} />}
                    Close
                  </button>
                  <button
                    onClick={() => command('PING')}
                    disabled={pending !== null || !gate?.online}
                    title="Ping gate node"
                    className="flex items-center gap-2 px-3 py-2.5 rounded-md text-sm
                               text-borg-muted hover:text-borg-text hover:bg-borg-panel/60
                               disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                  >
                    {pending === 'PING' ? <Loader2 size={14} className="animate-spin" /> : <Bell size={14} />}
                  </button>
                </div>
              </div>
              {error && <div className="mt-3 text-xs text-borg-danger">{error}</div>}
              {!gate?.online && (
                <div className="mt-3 text-xs text-borg-warning">
                  Gate node offline — commands disabled. (Nodes come online after ESPHome serial flash.)
                </div>
              )}
            </div>

            {/* Nodes */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {['gate', 'front', 'back'].map(id => (
                <NodeCard key={id} id={id} node={nodes[id]} />
              ))}
            </div>

            {/* Activity log */}
            <div className="rounded-lg border border-borg-border bg-borg-surface">
              <div className="flex items-center gap-2 px-4 py-3 border-b border-borg-border">
                <Activity size={13} className="text-borg-dim" />
                <span className="text-xs font-medium text-borg-text">Activity</span>
              </div>
              <div className="max-h-64 overflow-y-auto p-3 font-mono text-xs space-y-1">
                {logs.length === 0 && (
                  <div className="text-borg-dim px-1">No activity yet — log lines from the nodes appear here.</div>
                )}
                {logs.map((l, i) => (
                  <div key={i} className="flex gap-2 px-1">
                    <span className="text-borg-dim shrink-0">{fmtTime(l.at)}</span>
                    <span className="text-borg-accent shrink-0 w-10">{l.node}</span>
                    <span className="text-borg-muted">{l.message}</span>
                  </div>
                ))}
                <div ref={logEndRef} />
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
