import React from 'react'
import { useQuery } from '@tanstack/react-query'
import { getChildSessions } from '../api/hermes'
import { GitBranch, MessageSquare, Wrench, Clock } from 'lucide-react'

const DRONE_LABELS = {
  'qwen3.5:35b-a3b': 'Locutus',
  'qwen3.5:27b':     'Seven',
  'qwen2.5-coder:14b': 'Data',
  'hermes3:latest':  'Hugh',
}

function fmt(ms) {
  if (!ms) return ''
  const s = Math.round(ms / 1000)
  return s < 60 ? `${s}s` : `${Math.round(s/60)}m${s%60}s`
}

function SessionNode({ session, depth = 0 }) {
  const label = DRONE_LABELS[session.model] || session.model || 'Unknown'
  const duration = session.ended_at && session.started_at
    ? fmt((session.ended_at - session.started_at) * 1000)
    : null

  return (
    <div className={`${depth > 0 ? 'ml-4 border-l border-borg-border pl-3' : ''}`}>
      <div className="flex items-start gap-2 py-1.5 text-xs">
        <GitBranch size={10} className="text-borg-dim mt-0.5 shrink-0" />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-borg-green font-medium">{label}</span>
            {session.title && (
              <span className="text-borg-muted truncate">{session.title}</span>
            )}
          </div>
          <div className="flex items-center gap-3 text-borg-dim mt-0.5 flex-wrap">
            <span className="flex items-center gap-1">
              <MessageSquare size={8} />{session.message_count || 0} msgs
            </span>
            <span className="flex items-center gap-1">
              <Wrench size={8} />{session.tool_call_count || 0} tools
            </span>
            {duration && (
              <span className="flex items-center gap-1">
                <Clock size={8} />{duration}
              </span>
            )}
            {session.estimated_cost_usd != null && (
              <span className="text-borg-dim/70">
                ${session.estimated_cost_usd.toFixed(4)}
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

export default function SessionTree({ parentSessionId }) {
  const { data: children = [] } = useQuery({
    queryKey: ['children', parentSessionId],
    queryFn: () => getChildSessions(parentSessionId),
    enabled: !!parentSessionId,
    refetchInterval: 5000
  })

  if (!children.length) return null

  return (
    <div className="border border-borg-border rounded bg-borg-surface p-3 space-y-0.5">
      <div className="text-xs text-borg-dim mb-2 uppercase tracking-wider">Agent Activity</div>
      {children.map(s => <SessionNode key={s.id} session={s} depth={1} />)}
    </div>
  )
}
