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

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <form
        onClick={e => e.stopPropagation()}
        onSubmit={submit}
        className="bg-borg-surface border border-borg-border rounded-lg w-full max-w-md p-5 space-y-4"
      >
        <div>
          <h2 className="text-borg-green font-semibold">New Research Project</h2>
          <p className="text-borg-dim text-xs mt-0.5">
            Locutus will iterate with Seven, Data, and One as judge.
          </p>
        </div>

        <div className="space-y-3">
          <div>
            <label className="text-xs text-borg-muted block mb-1">Project Name</label>
            <input
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="Competitor analysis Q2..."
              className="w-full bg-borg-panel border border-borg-border rounded px-3 py-2 text-sm text-borg-text
                         placeholder-borg-dim focus:outline-none focus:border-borg-green/50"
            />
          </div>

          <div>
            <label className="text-xs text-borg-muted block mb-1">Research Objective</label>
            <textarea
              value={objective}
              onChange={e => setObjective(e.target.value)}
              placeholder="Analyze the top 5 competitors in the agentic AI space, focusing on pricing, positioning, and technical differentiation..."
              rows={4}
              className="w-full bg-borg-panel border border-borg-border rounded px-3 py-2 text-sm text-borg-text
                         placeholder-borg-dim focus:outline-none focus:border-borg-green/50 resize-none"
            />
          </div>

          <div>
            <label className="text-xs text-borg-muted block mb-1">
              Max Iterations <span className="text-borg-dim">(for testing, keep low)</span>
            </label>
            <div className="flex items-center gap-2">
              <input
                type="range" min={1} max={50} value={maxIter}
                onChange={e => setMaxIter(Number(e.target.value))}
                className="flex-1 accent-green-500"
              />
              <span className="text-borg-green font-mono w-8 text-center">{maxIter}</span>
            </div>
          </div>
        </div>

        <div className="flex gap-2 pt-1">
          <button type="button" onClick={onClose}
            className="flex-1 py-2 rounded border border-borg-border text-borg-muted hover:text-borg-text hover:border-borg-green/40 text-sm transition-colors">
            Cancel
          </button>
          <button type="submit" disabled={busy || !name.trim() || !objective.trim()}
            className="flex-1 py-2 rounded bg-borg-panel border border-borg-green/50 text-borg-green
                       hover:bg-borg-border disabled:opacity-40 disabled:cursor-not-allowed text-sm transition-colors">
            {busy ? 'Creating…' : 'Create Project'}
          </button>
        </div>
      </form>
    </div>
  )
}

function StatusBadge({ status }) {
  const map = {
    active:    'text-borg-green border-borg-green/40',
    complete:  'text-blue-400 border-blue-400/40',
    failed:    'text-red-400 border-red-400/40',
  }
  return (
    <span className={`text-xs border rounded px-1.5 py-0.5 ${map[status] || 'text-borg-dim border-borg-border'}`}>
      {status}
    </span>
  )
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
      <div className="flex items-center justify-between px-4 py-3 border-b border-borg-border bg-borg-surface shrink-0">
        <div>
          <div className="text-borg-green font-semibold text-sm">Research Projects</div>
          <div className="text-borg-dim text-xs">{projects.length} project{projects.length !== 1 ? 's' : ''}</div>
        </div>
        <button
          onClick={() => setModal(true)}
          className="flex items-center gap-1.5 text-xs text-borg-green px-2.5 py-1.5 rounded border border-borg-green/40
                     hover:bg-borg-panel transition-colors"
        >
          <Plus size={12} /> New Project
        </button>
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto p-4 space-y-2">
        {isLoading && (
          <div className="text-center text-borg-dim py-12">Loading…</div>
        )}
        {!isLoading && projects.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full text-borg-dim text-center space-y-3">
            <div className="text-4xl opacity-20">◈</div>
            <div>
              <div className="text-borg-muted">No research projects yet.</div>
              <div className="text-xs mt-1">Create one to begin autonomous research.</div>
            </div>
          </div>
        )}
        {projects.map(p => (
          <div
            key={p.id}
            onClick={() => onOpenProject(p)}
            className="group flex items-start gap-3 p-3 bg-borg-surface border border-borg-border rounded-lg
                       hover:border-borg-green/40 hover:bg-borg-panel cursor-pointer transition-all"
          >
            <div className="shrink-0 mt-0.5">
              <Layers size={14} className="text-borg-dim" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-borg-text font-medium text-sm">{p.name}</span>
                <StatusBadge status={p.status} />
              </div>
              <p className="text-borg-dim text-xs mt-1 line-clamp-2 leading-relaxed">{p.objective}</p>
              <div className="flex items-center gap-3 mt-2 text-xs text-borg-dim">
                <span className="flex items-center gap-1">
                  <Repeat size={10} />
                  {p.iteration_count || 0}/{p.max_iterations || '?'} iterations
                </span>
                {p.best_score != null && (
                  <span className="flex items-center gap-1 text-borg-green">
                    <Target size={10} />
                    best: {Number(p.best_score).toFixed(1)}
                  </span>
                )}
                <span className="text-borg-dim/60">
                  {p.created_at ? new Date(p.created_at).toLocaleDateString() : ''}
                </span>
              </div>
            </div>
            <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
              <button
                onClick={e => { e.stopPropagation(); remove.mutate(p.id) }}
                className="p-1.5 rounded text-borg-dim hover:text-red-400 hover:bg-borg-border transition-colors"
              >
                <Trash2 size={12} />
              </button>
              <ChevronRight size={14} className="text-borg-dim" />
            </div>
          </div>
        ))}
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
