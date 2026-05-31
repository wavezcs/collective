import React, { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { listProjects, createProject, deleteProject } from '../api/projects'
import { Plus, Trash2, ChevronRight, Layers, Target, Repeat } from 'lucide-react'

function NewProjectModal({ onClose, onCreate }) {
  const [name, setName]           = useState('')
  const [objective, setObjective] = useState('')
  const [maxIter, setMaxIter]     = useState(5)
  const [busy, setBusy]           = useState(false)

  async function submit(e) {
    e.preventDefault()
    if (!name.trim() || !objective.trim()) return
    setBusy(true)
    await onCreate({ name: name.trim(), objective: objective.trim(), max_iterations: maxIter })
    onClose()
  }

  const inputCls = `w-full bg-borg-panel border border-borg-border rounded-lg px-3 py-2.5 text-sm text-borg-text
    placeholder-borg-dim focus:outline-none focus:border-borg-green/50 focus:bg-borg-panel transition-colors`
  const labelCls = 'text-xs font-medium text-borg-muted block mb-1.5'

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4 backdrop-blur-sm" onClick={onClose}>
      <form
        onClick={e => e.stopPropagation()}
        onSubmit={submit}
        className="bg-borg-surface border border-borg-border rounded-xl w-full max-w-md shadow-2xl"
      >
        <div className="px-6 py-5 border-b border-borg-border">
          <h2 className="text-borg-text font-semibold text-base">New Research Project</h2>
          <p className="text-borg-muted text-sm mt-1">
            Aria will iterate autonomously to reach your research goal.
          </p>
        </div>

        <div className="p-6 space-y-4">
          <div>
            <label className={labelCls}>Project name</label>
            <input
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="Competitor analysis Q2..."
              autoFocus
              className={inputCls}
            />
          </div>

          <div>
            <label className={labelCls}>Research objective</label>
            <textarea
              value={objective}
              onChange={e => setObjective(e.target.value)}
              placeholder="Analyze the top 5 competitors in the agentic AI space, focusing on pricing, positioning, and technical differentiation..."
              rows={4}
              className={inputCls + ' resize-none'}
            />
          </div>

          <div>
            <label className={labelCls}>
              Max iterations — <span className="text-borg-dim font-normal">current: {maxIter}</span>
            </label>
            <input
              type="range" min={1} max={50} value={maxIter}
              onChange={e => setMaxIter(Number(e.target.value))}
              className="w-full accent-violet-500"
            />
          </div>
        </div>

        <div className="flex gap-2.5 px-6 py-4 border-t border-borg-border">
          <button type="button" onClick={onClose}
            className="flex-1 py-2 rounded-lg text-borg-muted hover:text-borg-text hover:bg-borg-panel text-sm transition-colors">
            Cancel
          </button>
          <button type="submit" disabled={busy || !name.trim() || !objective.trim()}
            className="flex-1 py-2 rounded-lg bg-borg-green/10 border border-borg-green/30 text-borg-green
                       hover:bg-borg-green/20 disabled:opacity-40 disabled:cursor-not-allowed text-sm font-medium transition-colors">
            {busy ? 'Creating…' : 'Create project'}
          </button>
        </div>
      </form>
    </div>
  )
}

const STATUS_STYLE = {
  active:   { dot: 'bg-borg-green', text: 'text-borg-green' },
  complete: { dot: 'bg-blue-400',   text: 'text-blue-400' },
  failed:   { dot: 'bg-red-400',    text: 'text-red-400' },
}

export default function ProjectsView({ onOpenProject }) {
  const qc = useQueryClient()
  const [showModal, setModal] = useState(false)

  const { data: projects = [], isLoading } = useQuery({
    queryKey: ['projects'],
    queryFn: listProjects,
    refetchInterval: 10_000
  })

  const create = useMutation({
    mutationFn: createProject,
    onSuccess: () => qc.invalidateQueries(['projects'])
  })

  const remove = useMutation({
    mutationFn: deleteProject,
    onSuccess: () => qc.invalidateQueries(['projects'])
  })

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-borg-border shrink-0">
        <div>
          <h1 className="text-borg-text font-semibold text-base">Research</h1>
          <div className="text-borg-muted text-sm mt-0.5">
            {projects.length} project{projects.length !== 1 ? 's' : ''}
          </div>
        </div>
        <button
          onClick={() => setModal(true)}
          className="flex items-center gap-1.5 text-sm text-borg-green bg-borg-green/10 hover:bg-borg-green/15
                     border border-borg-green/25 px-3 py-1.5 rounded-lg transition-colors font-medium"
        >
          <Plus size={14} /> New project
        </button>
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto">
        {isLoading && (
          <div className="text-center text-borg-muted py-16 text-sm">Loading…</div>
        )}
        {!isLoading && projects.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full text-center space-y-3 p-8">
            <Layers size={32} className="text-borg-border" />
            <div>
              <div className="text-borg-text font-medium">No projects yet</div>
              <div className="text-borg-muted text-sm mt-1">Create a project to run autonomous research.</div>
            </div>
          </div>
        )}
        <div className="divide-y divide-borg-border/50">
          {projects.map(p => {
            const style = STATUS_STYLE[p.status] || {}
            return (
              <div
                key={p.id}
                onClick={() => onOpenProject(p)}
                className="group flex items-center gap-4 px-6 py-4 hover:bg-borg-panel/40 cursor-pointer transition-colors"
              >
                <div className={`w-2 h-2 rounded-full shrink-0 ${style.dot || 'bg-borg-border'}`} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-3">
                    <span className="text-borg-text font-medium text-sm">{p.name}</span>
                    <span className={`text-xs ${style.text || 'text-borg-dim'}`}>{p.status}</span>
                  </div>
                  <p className="text-borg-muted text-xs mt-0.5 line-clamp-1">{p.objective}</p>
                </div>
                <div className="shrink-0 text-right text-xs text-borg-dim hidden sm:block">
                  <div>{p.iteration_count || 0}/{p.max_iterations || '?'} iters</div>
                  {p.best_score != null && (
                    <div className={style.text}>score {Number(p.best_score).toFixed(1)}</div>
                  )}
                </div>
                <div className="shrink-0 text-borg-dim text-xs hidden md:block">
                  {p.created_at ? new Date(p.created_at).toLocaleDateString() : ''}
                </div>
                <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                  <button
                    onClick={e => { e.stopPropagation(); remove.mutate(p.id) }}
                    className="p-1.5 rounded-md text-borg-dim hover:text-red-400 hover:bg-borg-panel transition-colors"
                  >
                    <Trash2 size={13} />
                  </button>
                  <ChevronRight size={15} className="text-borg-dim" />
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {showModal && (
        <NewProjectModal
          onClose={() => setModal(false)}
          onCreate={data => create.mutateAsync(data)}
        />
      )}
    </div>
  )
}
