import React, { useState, useMemo, useRef } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  listRecipes, createRecipe, updateRecipe, deleteRecipe, rateRecipe, scrapeRecipe,
  listPlans, getPlan, createPlan, updateDay, generatePlan,
  getGrocery, generateGrocery, updateGroceryItem, addGroceryItem, removeGroceryItem,
  getStaples, updateStaples,
  listPinterestBoards, addPinterestBoard, deletePinterestBoard, scanPinterestBoard
} from '../api/meals'
import {
  ChefHat, Zap, Clock, Star, Plus, Trash2, ThumbsUp, ThumbsDown,
  Heart, ShoppingCart, Calendar, ChevronLeft, ChevronRight,
  Check, Copy, User, UserX, RefreshCw, Loader2, Pencil, Download
} from 'lucide-react'

// ─── Helpers ─────────────────────────────────────────────────────────────────

function toMonday(date) {
  const d = new Date(date)
  const day = d.getUTCDay()
  const diff = day === 0 ? -6 : 1 - day
  d.setUTCDate(d.getUTCDate() + diff)
  return d.toISOString().slice(0, 10)
}

function addWeeks(weekOf, n) {
  const d = new Date(weekOf + 'T12:00:00Z')
  d.setUTCDate(d.getUTCDate() + n * 7)
  return d.toISOString().slice(0, 10)
}

function fmtDate(dateStr) {
  const d = new Date(dateStr + 'T12:00:00Z')
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })
}

const CONTEXT_META = {
  normal:     { icon: Clock,  color: 'text-borg-green',   bg: 'border-borg-green/30',   label: 'Normal' },
  fast:       { icon: Zap,    color: 'text-yellow-400',   bg: 'border-yellow-400/30',   label: 'Fast (30m)' },
  'super-fast': { icon: Zap,  color: 'text-red-400',      bg: 'border-red-400/30',      label: 'Super-fast' },
  special:    { icon: Star,   color: 'text-purple-400',   bg: 'border-purple-400/30',   label: 'Special' },
}

const RATING_META = {
  '-1': { icon: ThumbsDown, color: 'text-red-400',    label: 'Avoid' },
  '0':  { icon: null,       color: 'text-borg-dim',   label: 'Unrated' },
  '1':  { icon: ThumbsUp,   color: 'text-borg-green', label: 'Liked' },
  '2':  { icon: Heart,      color: 'text-pink-400',   label: 'Loved' },
}

// ─── Shared components ───────────────────────────────────────────────────────

function TabBar({ tabs, active, onChange }) {
  return (
    <div className="flex border-b border-borg-border px-5">
      {tabs.map(t => (
        <button
          key={t.id}
          onClick={() => onChange(t.id)}
          className={`px-4 py-3 text-sm font-medium border-b-2 transition-colors -mb-px ${
            active === t.id
              ? 'border-borg-green text-borg-text'
              : 'border-transparent text-borg-muted hover:text-borg-text'
          }`}
        >
          {t.label}
        </button>
      ))}
    </div>
  )
}

function ContextBadge({ context }) {
  const m = CONTEXT_META[context] || CONTEXT_META.normal
  const Icon = m.icon
  return (
    <span className={`inline-flex items-center gap-1 text-xs rounded-full px-2 py-0.5 bg-borg-panel ${m.color}`}>
      <Icon size={9} />
      {m.label}
    </span>
  )
}

function RatingBadge({ rating }) {
  const m = RATING_META[String(rating)] || RATING_META['0']
  if (!m.icon) return null
  const Icon = m.icon
  return <Icon size={12} className={m.color} />
}

// ─── Recipe Picker Modal ──────────────────────────────────────────────────────

function RecipePickerModal({ recipes, day, slot, onPick, onClose }) {
  const [search, setSearch] = useState('')
  const filtered = recipes.filter(r => {
    if (!search) return true
    return r.name.toLowerCase().includes(search.toLowerCase())
  })
  const currentId = slot === 'kids' ? day.kids_recipe_id : day.adult_recipe_id
  const slotLabel = slot === 'kids' ? 'Kids' : 'Adults'
  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4 backdrop-blur-sm" onClick={onClose}>
      <div
        onClick={e => e.stopPropagation()}
        className="bg-borg-surface border border-borg-border rounded-xl w-full max-w-lg flex flex-col shadow-2xl"
        style={{ maxHeight: '80vh' }}
      >
        <div className="flex items-center justify-between p-4 border-b border-borg-border">
          <div>
            <div className="text-borg-text font-semibold">Pick Meal — {slotLabel}</div>
            <div className="text-borg-muted text-sm">{day.day_name} · {fmtDate(day.date)}</div>
          </div>
          <button onClick={onClose} className="text-borg-muted hover:text-borg-text text-lg leading-none">×</button>
        </div>
        <div className="p-3 border-b border-borg-border">
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search recipes…"
            autoFocus
            className="w-full bg-borg-panel border border-borg-border/80 rounded-lg px-3 py-2 text-sm text-borg-text
                       placeholder-borg-dim focus:outline-none focus:border-borg-green/50 focus:bg-borg-panel"
          />
        </div>
        <div className="overflow-y-auto flex-1 p-2 space-y-1">
          <button
            onClick={() => onPick(null)}
            className="w-full text-left px-3 py-2 rounded text-borg-muted text-sm hover:bg-borg-panel hover:text-borg-text transition-colors"
          >
            — Clear / Not planned
          </button>
          {filtered.map(r => (
            <button
              key={r.id}
              onClick={() => onPick(r.id)}
              className={`w-full text-left px-3 py-2 rounded transition-colors hover:bg-borg-panel
                ${currentId === r.id ? 'bg-borg-panel border border-borg-green/40' : ''}`}
            >
              <div className="flex items-center justify-between">
                <span className="text-borg-text text-sm">{r.name}</span>
                <RatingBadge rating={r.rating} />
              </div>
              <div className="flex items-center gap-2 mt-0.5 text-xs text-borg-dim">
                {r.source && <span>{r.source}</span>}
                {r.total_minutes > 0 && <span>{r.total_minutes}m</span>}
                {r.vegetarian && <span className="text-green-500">veg</span>}
                {r.kid_friendly && <span className="text-blue-400">kids</span>}
              </div>
            </button>
          ))}
          {filtered.length === 0 && (
            <div className="text-center text-borg-dim text-xs py-6">No recipes match</div>
          )}
        </div>
      </div>
    </div>
  )
}

// ─── Tag Input ───────────────────────────────────────────────────────────────

function TagInput({ value = [], onChange, allTags = [] }) {
  const [input, setInput] = useState('')
  const [open, setOpen] = useState(false)
  const inputRef = useRef(null)

  const q = input.trim().toLowerCase()
  const suggestions = allTags.filter(t => t.toLowerCase().includes(q) && !value.includes(t))
  const isNew = q.length > 0 && !allTags.some(t => t.toLowerCase() === q) && !value.includes(q)

  function add(tag) {
    const t = tag.trim().toLowerCase()
    if (!t || value.includes(t)) return
    onChange([...value, t])
    setInput('')
    setOpen(false)
    inputRef.current?.focus()
  }

  function remove(tag) {
    onChange(value.filter(t => t !== tag))
  }

  function handleKeyDown(e) {
    if ((e.key === 'Enter' || e.key === ',') && input.trim()) {
      e.preventDefault()
      add(input.trim())
    }
    if (e.key === 'Backspace' && !input && value.length) {
      onChange(value.slice(0, -1))
    }
    if (e.key === 'Escape') setOpen(false)
  }

  return (
    <div className="relative">
      <div
        className="flex flex-wrap gap-1 bg-borg-panel border border-borg-border rounded px-2 py-1.5 min-h-[38px] cursor-text
                   focus-within:border-borg-green/50"
        onClick={() => inputRef.current?.focus()}
      >
        {value.map(tag => (
          <span key={tag} className="flex items-center gap-1 bg-borg-border/70 text-borg-text text-xs rounded px-2 py-0.5">
            {tag}
            <button type="button" onClick={e => { e.stopPropagation(); remove(tag) }}
              className="text-borg-dim hover:text-red-400 leading-none">×</button>
          </span>
        ))}
        <input
          ref={inputRef}
          value={input}
          onChange={e => { setInput(e.target.value); setOpen(true) }}
          onKeyDown={handleKeyDown}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          placeholder={value.length ? '' : 'quick, soup, pasta…'}
          className="flex-1 min-w-20 bg-transparent text-sm text-borg-text placeholder-borg-dim focus:outline-none py-0.5"
        />
      </div>
      {open && (suggestions.length > 0 || isNew) && (
        <div className="absolute z-20 top-full left-0 right-0 mt-0.5 bg-borg-surface border border-borg-border
                        rounded shadow-lg max-h-36 overflow-y-auto">
          {suggestions.map(t => (
            <button key={t} type="button" onMouseDown={() => add(t)}
              className="w-full text-left px-3 py-1.5 text-sm text-borg-text hover:bg-borg-panel transition-colors">
              {t}
            </button>
          ))}
          {isNew && (
            <button type="button" onMouseDown={() => add(input.trim())}
              className="w-full text-left px-3 py-1.5 text-sm text-borg-green hover:bg-borg-panel transition-colors
                         flex items-center gap-1.5 border-t border-borg-border/50">
              <Plus size={11} /> Add "{input.trim()}"
            </button>
          )}
        </div>
      )}
    </div>
  )
}

// ─── Add Recipe Modal ─────────────────────────────────────────────────────────

function AddRecipeModal({ onClose, onCreate, allTags = [] }) {
  const [form, setForm] = useState({
    name: '', url: '', source: '', prep_minutes: '', total_minutes: '',
    vegetarian: false, has_meat_option: false, kid_friendly: false,
    in_rotation: true, tags: [], notes: '',
    image: null, cached_wf_items: null, cached_target_items: null
  })
  const [busy, setBusy] = useState(false)
  const [scraping, setScraping] = useState(false)
  const [scrapeError, setScrapeError] = useState(null)

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  async function handleUrlBlur() {
    const url = form.url.trim()
    if (!url || !url.startsWith('http')) return
    setScraping(true)
    setScrapeError(null)
    try {
      const data = await scrapeRecipe(url)
      if (data.error) { setScrapeError('Could not read recipe from URL'); return; }
      setForm(f => ({
        ...f,
        name:          data.name        || f.name,
        source:        data.source      || f.source,
        prep_minutes:  data.prep_minutes ? String(data.prep_minutes) : f.prep_minutes,
        total_minutes: data.total_minutes ? String(data.total_minutes) : f.total_minutes,
        vegetarian:    data.vegetarian  ?? f.vegetarian,
        tags:          data.tags?.length ? data.tags : f.tags,
        image:               data.image               || f.image,
        cached_wf_items:     data.cached_wf_items     || f.cached_wf_items,
        cached_target_items: data.cached_target_items || f.cached_target_items,
      }))
    } catch {
      setScrapeError('Could not reach URL')
    } finally {
      setScraping(false)
    }
  }

  async function submit(e) {
    e.preventDefault()
    if (!form.name.trim()) return
    setBusy(true)
    await onCreate({
      ...form,
      prep_minutes: parseInt(form.prep_minutes || '0', 10),
      total_minutes: parseInt(form.total_minutes || '0', 10),
    })
    onClose()
  }

  const inputCls = `w-full bg-borg-panel border border-borg-border/80 rounded-lg px-3 py-2 text-sm text-borg-text
    placeholder-borg-dim focus:outline-none focus:border-borg-green/50 transition-colors`
  const labelCls = 'text-xs font-medium text-borg-muted block mb-1.5'

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4 backdrop-blur-sm" onClick={onClose}>
      <form
        onClick={e => e.stopPropagation()}
        onSubmit={submit}
        className="bg-borg-surface border border-borg-border rounded-xl w-full max-w-lg flex flex-col shadow-2xl"
        style={{ maxHeight: '90vh' }}
      >
        <div className="flex items-center justify-between p-4 border-b border-borg-border">
          <div className="text-borg-text font-semibold">Add Recipe</div>
          <button type="button" onClick={onClose} className="text-borg-muted hover:text-borg-text text-lg leading-none">×</button>
        </div>

        <div className="overflow-y-auto flex-1 p-4 space-y-3">
          <div>
            <label className={labelCls}>URL — paste to auto-fill</label>
            <div className="relative">
              <input
                value={form.url}
                onChange={e => { set('url', e.target.value); setScrapeError(null) }}
                onBlur={handleUrlBlur}
                placeholder="https://cookieandkate.com/…"
                className={inputCls + (scraping ? ' pr-8' : '')}
              />
              {scraping && (
                <Loader2 size={14} className="animate-spin text-borg-green absolute right-2.5 top-1/2 -translate-y-1/2" />
              )}
            </div>
            {scrapeError && <div className="text-xs text-red-400 mt-1">{scrapeError}</div>}
            {!scraping && !scrapeError && form.name && form.url && (
              <div className="text-xs text-borg-green mt-1">Recipe info loaded from URL</div>
            )}
          </div>
          <div>
            <label className={labelCls}>Recipe Name *</label>
            <input value={form.name} onChange={e => set('name', e.target.value)}
              placeholder="Lemon pasta, black bean tacos…" className={inputCls} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>Source</label>
              <input value={form.source} onChange={e => set('source', e.target.value)}
                placeholder="Cookie & Kate, Everyday Annie…" className={inputCls} />
            </div>
            <div />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>Prep (min)</label>
              <input type="number" min="0" value={form.prep_minutes}
                onChange={e => set('prep_minutes', e.target.value)} className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>Total (min)</label>
              <input type="number" min="0" value={form.total_minutes}
                onChange={e => set('total_minutes', e.target.value)} className={inputCls} />
            </div>
          </div>
          <div>
            <label className={labelCls}>Tags</label>
            <TagInput value={form.tags} onChange={v => set('tags', v)} allTags={allTags} />
          </div>
          <div>
            <label className={labelCls}>Notes</label>
            <textarea value={form.notes} onChange={e => set('notes', e.target.value)}
              rows={2} className={inputCls + ' resize-none'} />
          </div>
          <div className="flex flex-wrap gap-4 text-sm text-borg-text">
            {[['vegetarian','Vegetarian'],['has_meat_option','Has meat option'],['kid_friendly','Kid-friendly'],['in_rotation','In rotation']].map(([k, label]) => (
              <label key={k} className="flex items-center gap-1.5 cursor-pointer">
                <input type="checkbox" checked={form[k]} onChange={e => set(k, e.target.checked)}
                  className="accent-green-500" />
                {label}
              </label>
            ))}
          </div>
        </div>

        <div className="flex gap-2 p-4 border-t border-borg-border">
          <button type="button" onClick={onClose}
            className="flex-1 py-2 rounded-lg text-borg-muted hover:text-borg-text hover:bg-borg-panel text-sm transition-colors">
            Cancel
          </button>
          <button type="submit" disabled={busy || !form.name.trim()}
            className="flex-1 py-2 rounded-lg bg-borg-green/10 border border-borg-green/30 text-borg-green
                       hover:bg-borg-green/20 disabled:opacity-40 text-sm font-medium transition-colors">
            {busy ? 'Adding…' : 'Add Recipe'}
          </button>
        </div>
      </form>
    </div>
  )
}

// ─── Pinterest Import Modal ───────────────────────────────────────────────────

function PinterestModal({ onClose, onImported }) {
  const qc = useQueryClient()
  const [url, setUrl] = useState('')
  const [adding, setAdding] = useState(false)
  const [scanning, setScanning] = useState(null) // board id being scanned
  const [lastResult, setLastResult] = useState(null) // { added, skipped, boardId }

  const { data: boards = [], refetch: refetchBoards } = useQuery({
    queryKey: ['pinterest-boards'],
    queryFn: listPinterestBoards,
  })

  const addBoard = useMutation({
    mutationFn: addPinterestBoard,
    onSuccess: () => { refetchBoards(); setUrl('') },
  })

  const removeBoard = useMutation({
    mutationFn: deletePinterestBoard,
    onSuccess: () => refetchBoards(),
  })

  function isPinterestUrl(u) {
    return u.includes('pinterest.com') || u.includes('pin.it')
  }

  async function handleAdd(e) {
    e.preventDefault()
    const trimmed = url.trim()
    if (!trimmed || !isPinterestUrl(trimmed)) return
    setAdding(true)
    await addBoard.mutateAsync(trimmed)
    setAdding(false)
  }

  async function handleScan(boardId) {
    setScanning(boardId)
    setLastResult(null)
    try {
      const result = await scanPinterestBoard(boardId)
      setLastResult({ ...result, boardId })
      refetchBoards()
      if (result.added?.length) {
        qc.invalidateQueries(['recipes'])
        onImported?.()
      }
    } finally {
      setScanning(null)
    }
  }

  function fmtDate(iso) {
    if (!iso) return 'Never'
    return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
  }

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4 backdrop-blur-sm" onClick={onClose}>
      <div
        onClick={e => e.stopPropagation()}
        className="bg-borg-surface border border-borg-border rounded-xl w-full max-w-lg flex flex-col shadow-2xl"
        style={{ maxHeight: '85vh' }}
      >
        <div className="flex items-center justify-between p-4 border-b border-borg-border">
          <div>
            <div className="text-borg-text font-semibold">Pinterest Import</div>
            <div className="text-borg-muted text-sm">Boards are scanned automatically every 24 hours</div>
          </div>
          <button onClick={onClose} className="text-borg-muted hover:text-borg-text text-lg leading-none">×</button>
        </div>

        {/* Add board form */}
        <form onSubmit={handleAdd} className="flex gap-2 p-3 border-b border-borg-border">
          <input
            value={url}
            onChange={e => setUrl(e.target.value)}
            placeholder="https://www.pinterest.com/you/board-name/"
            className="flex-1 bg-borg-panel border border-borg-border/80 rounded-lg px-3 py-2 text-sm text-borg-text
                       placeholder-borg-dim focus:outline-none focus:border-borg-green/50 focus:bg-borg-panel"
          />
          <button
            type="submit"
            disabled={adding || !isPinterestUrl(url.trim())}
            className="flex items-center gap-1.5 text-xs px-3 py-2 rounded border border-borg-green/50
                       text-borg-green hover:bg-borg-panel disabled:opacity-40 transition-colors shrink-0"
          >
            {adding ? <Loader2 size={12} className="animate-spin" /> : <Plus size={12} />}
            Add Board
          </button>
        </form>

        {/* Board list */}
        <div className="flex-1 overflow-y-auto">
          {boards.length === 0 && (
            <div className="text-center text-borg-dim text-sm py-10">No boards saved yet. Paste a Pinterest board URL above.</div>
          )}
          {boards.map(b => {
            const isScanning = scanning === b.id
            const result = lastResult?.boardId === b.id ? lastResult : null
            return (
              <div key={b.id} className="p-3 border-b border-borg-border last:border-b-0">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="text-borg-text text-sm font-medium truncate">{b.name}</div>
                    <a href={b.url} target="_blank" rel="noopener noreferrer"
                      className="text-xs text-borg-dim hover:text-borg-green truncate block">{b.url}</a>
                    <div className="flex items-center gap-3 mt-1 text-xs text-borg-dim">
                      <span>Last scanned: {fmtDate(b.last_scanned)}</span>
                      {b.pin_count > 0 && <span>{b.pin_count} pins found</span>}
                      {b.recipes_added > 0 && <span className="text-borg-green">{b.recipes_added} recipes added total</span>}
                    </div>
                    {result && (
                      <div className={`mt-1.5 text-xs px-2 py-1 rounded border ${
                        result.added?.length ? 'border-borg-green/30 text-borg-green bg-borg-panel' : 'border-borg-border text-borg-dim'
                      }`}>
                        {result.error
                          ? `Error: ${result.error}`
                          : `Scan complete — ${result.added?.length || 0} new recipes added, ${result.skipped || 0} skipped`
                        }
                        {result.added?.length > 0 && (
                          <div className="mt-1 space-y-0.5">
                            {result.added.slice(0, 5).map((r, i) => (
                              <div key={i} className="text-borg-muted truncate">+ {r.name}</div>
                            ))}
                            {result.added.length > 5 && <div className="text-borg-dim">…and {result.added.length - 5} more</div>}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      onClick={() => handleScan(b.id)}
                      disabled={!!scanning}
                      className="flex items-center gap-1 text-xs px-2 py-1 rounded border border-borg-border
                                 text-borg-muted hover:text-borg-text hover:border-borg-green/40 disabled:opacity-40 transition-colors"
                    >
                      {isScanning ? <Loader2 size={11} className="animate-spin" /> : <RefreshCw size={11} />}
                      {isScanning ? 'Scanning…' : 'Scan now'}
                    </button>
                    <button
                      onClick={() => removeBoard.mutate(b.id)}
                      className="p-1 rounded text-borg-dim hover:text-red-400 hover:bg-borg-border transition-colors"
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

// ─── Edit Recipe Modal ────────────────────────────────────────────────────────

function EditRecipeModal({ recipe, onClose, onSave, allTags = [] }) {
  const [form, setForm] = useState({
    name:          recipe.name          || '',
    url:           recipe.url           || '',
    source:        recipe.source        || '',
    prep_minutes:  recipe.prep_minutes  ? String(recipe.prep_minutes)  : '',
    total_minutes: recipe.total_minutes ? String(recipe.total_minutes) : '',
    vegetarian:    recipe.vegetarian    || false,
    has_meat_option: recipe.has_meat_option || false,
    kid_friendly:  recipe.kid_friendly  || false,
    in_rotation:   recipe.in_rotation   !== false,
    tags:          Array.isArray(recipe.tags) ? recipe.tags : [],
    notes:         recipe.notes         || '',
  })
  const [busy, setBusy] = useState(false)
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  async function submit(e) {
    e.preventDefault()
    if (!form.name.trim()) return
    setBusy(true)
    await onSave(recipe.id, {
      ...form,
      prep_minutes:  parseInt(form.prep_minutes  || '0', 10),
      total_minutes: parseInt(form.total_minutes || '0', 10),
    })
    onClose()
  }

  const inputCls = `w-full bg-borg-panel border border-borg-border/80 rounded-lg px-3 py-2 text-sm text-borg-text
    placeholder-borg-dim focus:outline-none focus:border-borg-green/50 transition-colors`
  const labelCls = 'text-xs font-medium text-borg-muted block mb-1.5'

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4 backdrop-blur-sm" onClick={onClose}>
      <form
        onClick={e => e.stopPropagation()}
        onSubmit={submit}
        className="bg-borg-surface border border-borg-border rounded-xl w-full max-w-lg flex flex-col shadow-2xl"
        style={{ maxHeight: '90vh' }}
      >
        <div className="flex items-center justify-between p-4 border-b border-borg-border">
          <div className="text-borg-text font-semibold">Edit Recipe</div>
          <button type="button" onClick={onClose} className="text-borg-muted hover:text-borg-text text-lg leading-none">×</button>
        </div>
        <div className="overflow-y-auto flex-1 p-4 space-y-3">
          <div>
            <label className={labelCls}>Recipe Name *</label>
            <input value={form.name} onChange={e => set('name', e.target.value)} className={inputCls} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>URL</label>
              <input value={form.url} onChange={e => set('url', e.target.value)} className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>Source</label>
              <input value={form.source} onChange={e => set('source', e.target.value)} className={inputCls} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>Prep (min)</label>
              <input type="number" min="0" value={form.prep_minutes}
                onChange={e => set('prep_minutes', e.target.value)} className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>Total (min)</label>
              <input type="number" min="0" value={form.total_minutes}
                onChange={e => set('total_minutes', e.target.value)} className={inputCls} />
            </div>
          </div>
          <div>
            <label className={labelCls}>Tags</label>
            <TagInput value={form.tags} onChange={v => set('tags', v)} allTags={allTags} />
          </div>
          <div>
            <label className={labelCls}>Notes</label>
            <textarea value={form.notes} onChange={e => set('notes', e.target.value)}
              rows={2} className={inputCls + ' resize-none'} />
          </div>
          <div className="flex flex-wrap gap-4 text-sm text-borg-text">
            {[['vegetarian','Vegetarian'],['has_meat_option','Has meat option'],['kid_friendly','Kid-friendly'],['in_rotation','In rotation']].map(([k, label]) => (
              <label key={k} className="flex items-center gap-1.5 cursor-pointer">
                <input type="checkbox" checked={form[k]} onChange={e => set(k, e.target.checked)}
                  className="accent-green-500" />
                {label}
              </label>
            ))}
          </div>
        </div>
        <div className="flex gap-2 p-4 border-t border-borg-border">
          <button type="button" onClick={onClose}
            className="flex-1 py-2 rounded-lg text-borg-muted hover:text-borg-text hover:bg-borg-panel text-sm transition-colors">
            Cancel
          </button>
          <button type="submit" disabled={busy || !form.name.trim()}
            className="flex-1 py-2 rounded-lg bg-borg-green/10 border border-borg-green/30 text-borg-green
                       hover:bg-borg-green/20 disabled:opacity-40 text-sm font-medium transition-colors">
            {busy ? 'Saving…' : 'Save Changes'}
          </button>
        </div>
      </form>
    </div>
  )
}

// ─── Week Tab ─────────────────────────────────────────────────────────────────

function WeekTab({ recipes }) {
  const qc = useQueryClient()
  const [weekOf, setWeekOf] = useState(() => toMonday(new Date()))
  // pickerDay: { day, slot: 'adult'|'kids' }
  const [picker, setPicker] = useState(null)

  const { data: plan, isLoading } = useQuery({
    queryKey: ['plan', weekOf],
    queryFn: () => getPlan(weekOf),
    retry: false
  })

  const recipeMap = Object.fromEntries(recipes.map(r => [r.id, r]))

  const ensurePlan = useMutation({
    mutationFn: () => createPlan(weekOf),
    onSuccess: () => qc.invalidateQueries(['plan', weekOf])
  })

  const generate = useMutation({
    mutationFn: () => generatePlan(weekOf),
    onSuccess: () => qc.invalidateQueries(['plan', weekOf])
  })

  const pickMeal = useMutation({
    mutationFn: ({ date, slot, recipe_id }) => updateDay(weekOf, date, {
      [slot === 'kids' ? 'kids_recipe_id' : 'adult_recipe_id']: recipe_id
    }),
    onSuccess: () => qc.invalidateQueries(['plan', weekOf])
  })

  async function handlePick(recipeId) {
    await pickMeal.mutateAsync({ date: picker.day.date, slot: picker.slot, recipe_id: recipeId })
    setPicker(null)
  }

  const days = plan?.days || []

  function MealLine({ recipeId, slot, day }) {
    const recipe = recipeId ? recipeMap[recipeId] : null
    const isKids = slot === 'kids'
    return (
      <div className="flex items-center gap-2 mt-1">
        <span className={`text-xs shrink-0 w-10 ${isKids ? 'text-blue-400' : 'text-borg-muted'}`}>
          {isKids ? 'Kids' : 'Adults'}
        </span>
        {recipe
          ? (
            <div className="flex items-center gap-1.5 flex-1 min-w-0">
              <ChefHat size={11} className={isKids ? 'text-blue-400 shrink-0' : 'text-borg-green shrink-0'} />
              <span className="text-borg-text text-sm truncate">{recipe.name}</span>
              {recipe.source && <span className="text-borg-dim text-xs hidden sm:inline">{recipe.source}</span>}
              <RatingBadge rating={recipe.rating} />
            </div>
          )
          : <span className="text-borg-dim text-xs italic flex-1">Not planned</span>
        }
        <button
          onClick={() => setPicker({ day, slot })}
          className="shrink-0 text-xs px-1.5 py-0.5 rounded border border-borg-border text-borg-muted
                     hover:text-borg-text hover:border-borg-green/40 transition-colors">
          Pick
        </button>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full">
      {/* Week navigator */}
      <div className="flex items-center justify-between px-5 py-3.5 border-b border-borg-border shrink-0">
        <button onClick={() => setWeekOf(addWeeks(weekOf, -1))}
          className="p-1 rounded text-borg-muted hover:text-borg-text hover:bg-borg-panel transition-colors">
          <ChevronLeft size={16} />
        </button>
        <div className="text-center">
          <div className="text-borg-text font-semibold">Week of {fmtDate(weekOf)}</div>
          {plan && <div className="text-xs text-borg-muted mt-0.5">{plan.status}</div>}
        </div>
        <button onClick={() => setWeekOf(addWeeks(weekOf, 1))}
          className="p-1 rounded text-borg-muted hover:text-borg-text hover:bg-borg-panel transition-colors">
          <ChevronRight size={16} />
        </button>
      </div>

      {/* Action buttons */}
      <div className="flex gap-2 px-4 py-2 border-b border-borg-border shrink-0">
        {!plan && (
          <button onClick={() => ensurePlan.mutate()}
            className="flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded border border-borg-border
                       text-borg-muted hover:text-borg-text hover:border-borg-green/40 transition-colors">
            <Plus size={12} /> Start plan
          </button>
        )}
        {plan && (
          <button onClick={() => generate.mutate()} disabled={generate.isPending}
            className="flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded border border-borg-border
                       text-borg-muted hover:text-borg-text hover:border-borg-green/40 transition-colors disabled:opacity-50">
            {generate.isPending ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
            Auto-fill from calendar
          </button>
        )}
      </div>

      {/* Day rows */}
      <div className="flex-1 overflow-y-auto p-3 space-y-2">
        {isLoading && <div className="text-center text-borg-dim py-8">Loading…</div>}
        {!isLoading && !plan && (
          <div className="flex flex-col items-center justify-center h-full text-borg-dim text-center space-y-3">
            <Calendar size={32} className="opacity-20" />
            <div>
              <div className="text-borg-muted text-sm">No plan for this week.</div>
              <div className="text-xs mt-1">Click "Start plan" to begin.</div>
            </div>
          </div>
        )}
        {days.map(day => (
          <div key={day.date}
            className="bg-borg-surface rounded-xl p-4 hover:bg-borg-panel/30 transition-colors border border-borg-border/60">
            <div className="flex items-center gap-2.5 flex-wrap mb-2">
              <span className="text-borg-text font-semibold">{day.day_name}</span>
              <span className="text-borg-muted text-sm">{fmtDate(day.date)}</span>
              <ContextBadge context={day.meal_context} />
              {day.chris_home
                ? <span className="flex items-center gap-1 text-xs text-borg-dim"><User size={10} /> Chris home</span>
                : <span className="flex items-center gap-1 text-xs text-orange-400"><UserX size={10} /> Chris away</span>
              }
            </div>
            {day.events_summary && (
              <div className="text-xs text-borg-muted/70 mb-2 truncate">{day.events_summary}</div>
            )}
            <MealLine recipeId={day.adult_recipe_id} slot="adult" day={day} />
            <MealLine recipeId={day.kids_recipe_id}  slot="kids"  day={day} />
          </div>
        ))}
      </div>

      {picker && (
        <RecipePickerModal
          recipes={recipes}
          day={picker.day}
          slot={picker.slot}
          onPick={handlePick}
          onClose={() => setPicker(null)}
        />
      )}
    </div>
  )
}

// ─── Catalog Tab ──────────────────────────────────────────────────────────────

const FILTER_CHIPS = [
  { id: '', label: 'All' },
  { id: 'in_rotation', label: 'In Rotation' },
  { id: 'quick', label: 'Quick' },
  { id: 'vegetarian', label: 'Vegetarian' },
]

function CatalogTab({ recipes, isLoading, onRefresh }) {
  const qc = useQueryClient()
  const [search, setSearch] = useState('')
  const [chip, setChip] = useState('')
  const [showAdd, setShowAdd] = useState(false)
  const [showPinterest, setShowPinterest] = useState(false)
  const [editRecipe, setEditRecipe] = useState(null)

  const create = useMutation({
    mutationFn: createRecipe,
    onSuccess: () => { qc.invalidateQueries(['recipes']); onRefresh() }
  })

  const edit = useMutation({
    mutationFn: ({ id, data }) => updateRecipe(id, data),
    onSuccess: () => { qc.invalidateQueries(['recipes']); onRefresh() }
  })

  const remove = useMutation({
    mutationFn: deleteRecipe,
    onSuccess: () => { qc.invalidateQueries(['recipes']); onRefresh() }
  })

  const rate = useMutation({
    mutationFn: ({ id, rating }) => rateRecipe(id, rating),
    onSuccess: () => { qc.invalidateQueries(['recipes']); onRefresh() }
  })

  const allTags = useMemo(() => {
    const s = new Set()
    recipes.forEach(r => (r.tags || []).forEach(t => s.add(t)))
    return [...s].sort()
  }, [recipes])

  const filtered = recipes.filter(r => {
    if (search && !r.name.toLowerCase().includes(search.toLowerCase())) return false
    if (chip === 'in_rotation' && !r.in_rotation) return false
    if (chip === 'quick' && r.total_minutes > 30) return false
    if (chip === 'vegetarian' && !r.vegetarian) return false
    return true
  })

  return (
    <div className="flex flex-col h-full">
      {/* Search + filters */}
      <div className="px-5 py-3 border-b border-borg-border space-y-2.5 shrink-0">
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search recipes…"
          className="w-full bg-borg-panel border border-borg-border rounded px-3 py-2 text-sm text-borg-text
                     placeholder-borg-dim focus:outline-none focus:border-borg-green/50"
        />
        <div className="flex items-center justify-between">
          <div className="flex gap-1 flex-wrap">
            {FILTER_CHIPS.map(c => (
              <button key={c.id} onClick={() => setChip(c.id)}
                className={`text-xs px-2 py-0.5 rounded border transition-colors ${
                  chip === c.id
                    ? 'border-borg-green text-borg-green bg-borg-panel'
                    : 'border-borg-border text-borg-muted hover:border-borg-green/40 hover:text-borg-text'
                }`}>
                {c.label}
              </button>
            ))}
          </div>
          <div className="flex gap-1.5">
            <button onClick={() => setShowPinterest(true)}
              className="flex items-center gap-1.5 text-xs text-borg-muted px-2.5 py-1.5 rounded border border-borg-border
                         hover:text-borg-text hover:border-borg-green/40 transition-colors">
              <Download size={12} /> Pinterest
            </button>
            <button onClick={() => setShowAdd(true)}
              className="flex items-center gap-1.5 text-xs text-borg-green px-2.5 py-1.5 rounded border border-borg-green/40
                         hover:bg-borg-panel transition-colors">
              <Plus size={12} /> Add Recipe
            </button>
          </div>
        </div>
      </div>

      {/* Recipe grid */}
      <div className="flex-1 overflow-y-auto p-4">
        {isLoading && <div className="text-center text-borg-muted py-12">Loading…</div>}
        {!isLoading && filtered.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full text-center space-y-3">
            <ChefHat size={36} className="text-borg-border" />
            <div>
              <div className="text-borg-text font-medium">No recipes yet</div>
              <div className="text-borg-muted text-sm mt-0.5">Add your first recipe to get started.</div>
            </div>
          </div>
        )}
        <div className="grid gap-4" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(230px, 1fr))' }}>
          {filtered.map(r => (
            <div key={r.id}
              className="group bg-borg-surface border border-borg-border/60 rounded-xl overflow-hidden
                         hover:border-borg-border hover:shadow-lg transition-all flex flex-col">
              {/* Image */}
              <div className="relative overflow-hidden bg-borg-panel" style={{ paddingBottom: '62.5%' }}>
                {r.image
                  ? <img src={r.image} alt={r.name}
                      className="absolute inset-0 w-full h-full object-cover"
                      onError={e => { e.currentTarget.parentElement.classList.add('hidden') }} />
                  : <div className="absolute inset-0 flex items-center justify-center">
                      <ChefHat size={28} className="text-borg-border/60" />
                    </div>
                }
              </div>

              <div className="p-3.5 flex flex-col flex-1">
                {/* Name + link */}
                <div className="flex items-start justify-between gap-1 mb-1.5">
                  <span className="text-borg-text font-medium leading-snug">{r.name}</span>
                  {r.url && (
                    <a href={r.url} target="_blank" rel="noopener noreferrer"
                      className="text-borg-dim hover:text-borg-green shrink-0 mt-0.5 transition-colors">
                      <span className="text-xs">↗</span>
                    </a>
                  )}
                </div>

                {/* Meta row */}
                <div className="flex items-center gap-2 flex-wrap text-xs text-borg-muted mb-1">
                  {r.source && <span>{r.source}</span>}
                  {r.total_minutes > 0 && (
                    <span className="flex items-center gap-0.5">
                      <Clock size={9} />{r.total_minutes}m
                    </span>
                  )}
                  {r.vegetarian && <span className="text-emerald-400">veg</span>}
                  {r.kid_friendly && <span className="text-blue-400">kids</span>}
                  {!r.in_rotation && <span className="text-borg-dim">off-rotation</span>}
                </div>

                {r.notes && <div className="text-xs text-borg-muted/80 line-clamp-2 mb-1.5 leading-relaxed">{r.notes}</div>}

                <div className="flex-1" />
                <div className="flex items-center justify-between mt-2.5 pt-2.5 border-t border-borg-border/40">
                  {/* Rating */}
                  <div className="flex gap-0.5">
                    {[-1, 1, 2].map(v => {
                      const m = RATING_META[String(v)]
                      const Icon = m.icon
                      return (
                        <button key={v} onClick={() => rate.mutate({ id: r.id, rating: v })}
                          className={`p-1 rounded-md transition-colors ${
                            r.rating === v ? m.color + ' bg-borg-panel' : 'text-borg-dim/60 hover:' + m.color
                          }`} title={m.label}>
                          <Icon size={12} />
                        </button>
                      )
                    })}
                  </div>
                  {/* Edit + Delete */}
                  <div className="flex gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button onClick={() => setEditRecipe(r)}
                      className="p-1 rounded-md text-borg-dim hover:text-borg-green hover:bg-borg-panel transition-colors">
                      <Pencil size={12} />
                    </button>
                    <button onClick={() => { if (confirm(`Delete "${r.name}"?`)) remove.mutate(r.id) }}
                      className="p-1 rounded-md text-borg-dim hover:text-red-400 hover:bg-borg-panel transition-colors">
                      <Trash2 size={12} />
                    </button>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {showPinterest && (
        <PinterestModal
          onClose={() => setShowPinterest(false)}
          onImported={() => { qc.invalidateQueries(['recipes']); onRefresh() }}
        />
      )}
      {showAdd && (
        <AddRecipeModal onClose={() => setShowAdd(false)} onCreate={data => create.mutateAsync(data)} allTags={allTags} />
      )}
      {editRecipe && (
        <EditRecipeModal
          recipe={editRecipe}
          onClose={() => setEditRecipe(null)}
          onSave={(id, data) => edit.mutateAsync({ id, data })}
          allTags={allTags}
        />
      )}
    </div>
  )
}

// ─── Clipboard helper ─────────────────────────────────────────────────────────

function copyToClipboard(text) {
  if (navigator.clipboard) {
    return navigator.clipboard.writeText(text).catch(() => fallbackClipboard(text))
  }
  fallbackClipboard(text)
  return Promise.resolve()
}

function fallbackClipboard(text) {
  const ta = document.createElement('textarea')
  ta.value = text
  ta.style.cssText = 'position:fixed;opacity:0;top:0;left:0;pointer-events:none'
  document.body.appendChild(ta)
  ta.select()
  document.execCommand('copy')
  document.body.removeChild(ta)
}

// ─── Store Column ─────────────────────────────────────────────────────────────

function StoreColumn({ label, items, onToggle, onEditName, onAdd, onRemove, copied, onCopy }) {
  const [editIdx, setEditIdx] = useState(null)
  const [editVal, setEditVal] = useState('')
  const [newItem, setNewItem] = useState('')
  const done = items.filter(i => i.checked).length

  function startEdit(idx, val) { setEditIdx(idx); setEditVal(val) }
  function commitEdit() {
    if (editIdx !== null && editVal.trim()) onEditName(editIdx, editVal.trim())
    setEditIdx(null)
  }

  return (
    <div className="flex-1 min-w-0">
      <div className="flex items-center justify-between mb-2">
        <div>
          <div className="text-borg-text text-sm font-medium">{label}</div>
          <div className="text-borg-dim text-xs">{done}/{items.length} checked</div>
        </div>
        <button onClick={onCopy}
          className={`flex items-center gap-1 text-xs px-2 py-1 rounded border transition-colors ${
            copied ? 'border-borg-green text-borg-green' : 'border-borg-border text-borg-muted hover:text-borg-text hover:border-borg-green/40'
          }`}>
          {copied ? <Check size={10} /> : <Copy size={10} />}
          {copied ? 'Copied!' : 'Copy'}
        </button>
      </div>
      <div className="space-y-0.5">
        {items.map((item, idx) => (
          <div key={idx}
            className={`group flex items-center gap-2 px-1.5 py-1 rounded transition-colors hover:bg-borg-panel ${item.checked ? 'opacity-50' : ''}`}>
            <input type="checkbox" checked={!!item.checked}
              onChange={e => onToggle(idx, e.target.checked)}
              className="accent-green-500 shrink-0" />
            {editIdx === idx
              ? <input autoFocus value={editVal}
                  onChange={e => setEditVal(e.target.value)}
                  onBlur={commitEdit}
                  onKeyDown={e => { if (e.key === 'Enter') commitEdit(); if (e.key === 'Escape') setEditIdx(null) }}
                  className="flex-1 bg-borg-panel border border-borg-green/50 rounded px-2 py-0.5 text-sm text-borg-text focus:outline-none" />
              : <span className={`flex-1 text-sm min-w-0 truncate ${item.checked ? 'line-through text-borg-dim' : 'text-borg-text'}`}>
                  {item.item}
                  {item.recipe && !item.staple && <span className="text-borg-dim/60 ml-1 text-xs">({item.recipe})</span>}
                  {item.staple && <span className="text-borg-dim/40 ml-1 text-xs">staple</span>}
                </span>
            }
            <div className="flex gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
              <button onClick={() => startEdit(idx, item.item)}
                className="p-0.5 rounded text-borg-dim hover:text-borg-green hover:bg-borg-panel transition-colors">
                <Pencil size={10} />
              </button>
              <button onClick={() => onRemove(idx)}
                className="p-0.5 rounded text-borg-dim hover:text-red-400 hover:bg-borg-border transition-colors">
                <Trash2 size={10} />
              </button>
            </div>
          </div>
        ))}
      </div>
      <form onSubmit={e => { e.preventDefault(); const v = newItem.trim(); if (v) { onAdd(v); setNewItem('') } }}
        className="flex gap-1.5 mt-2">
        <input value={newItem} onChange={e => setNewItem(e.target.value)} placeholder="Add item…"
          className="flex-1 bg-borg-panel border border-borg-border rounded px-2 py-1 text-xs text-borg-text
                     placeholder-borg-dim focus:outline-none focus:border-borg-green/50" />
        <button type="submit" disabled={!newItem.trim()}
          className="p-1.5 rounded border border-borg-border text-borg-muted hover:text-borg-green hover:border-borg-green/40 disabled:opacity-30 transition-colors">
          <Plus size={12} />
        </button>
      </form>
    </div>
  )
}

// ─── Staples Editor ───────────────────────────────────────────────────────────

function StaplesEditor({ staples, onSave }) {
  const [local, setLocal] = useState(() => ({
    whole_foods: [...(staples?.whole_foods || [])],
    target: [...(staples?.target || [])]
  }))
  const [inputs, setInputs] = useState({ whole_foods: '', target: '' })

  function removeItem(store, idx) {
    setLocal(l => ({ ...l, [store]: l[store].filter((_, i) => i !== idx) }))
  }
  function addItem(store) {
    const v = inputs[store].trim()
    if (!v) return
    setLocal(l => ({ ...l, [store]: [...l[store], v] }))
    setInputs(i => ({ ...i, [store]: '' }))
  }

  return (
    <div className="mt-3 space-y-4 bg-borg-panel border border-borg-border rounded-lg p-3">
      {[['whole_foods', 'Whole Foods'], ['target', 'Target']].map(([store, label]) => (
        <div key={store}>
          <div className="text-xs text-borg-muted mb-1.5">{label} staples</div>
          <div className="flex flex-wrap gap-1 mb-1.5">
            {local[store].map((item, idx) => (
              <span key={idx} className="flex items-center gap-1 bg-borg-border/70 text-borg-text text-xs rounded px-2 py-0.5">
                {item}
                <button type="button" onClick={() => removeItem(store, idx)}
                  className="text-borg-dim hover:text-red-400 leading-none">×</button>
              </span>
            ))}
          </div>
          <div className="flex gap-1.5">
            <input value={inputs[store]} onChange={e => setInputs(i => ({ ...i, [store]: e.target.value }))}
              onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addItem(store) } }}
              placeholder="Add staple…"
              className="flex-1 bg-borg-surface border border-borg-border rounded px-2 py-1 text-xs text-borg-text
                         placeholder-borg-dim focus:outline-none focus:border-borg-green/50" />
            <button type="button" onClick={() => addItem(store)} disabled={!inputs[store].trim()}
              className="p-1.5 rounded border border-borg-border text-borg-muted hover:text-borg-green hover:border-borg-green/40 disabled:opacity-30 transition-colors">
              <Plus size={12} />
            </button>
          </div>
        </div>
      ))}
      <button onClick={() => onSave(local)}
        className="text-xs px-3 py-1.5 rounded border border-borg-green/50 text-borg-green hover:bg-borg-surface transition-colors">
        Save Staples
      </button>
    </div>
  )
}

// ─── Grocery Tab ──────────────────────────────────────────────────────────────

function GroceryTab() {
  const qc = useQueryClient()
  const [weekOf, setWeekOf] = useState(() => toMonday(new Date()))
  const [copied, setCopied] = useState(null)
  const [showStaples, setShowStaples] = useState(false)

  const { data: grocery, isLoading } = useQuery({
    queryKey: ['grocery', weekOf],
    queryFn: () => getGrocery(weekOf)
  })

  const { data: staples } = useQuery({
    queryKey: ['staples'],
    queryFn: getStaples
  })

  const generateMut = useMutation({
    mutationFn: () => generateGrocery(weekOf),
    onSuccess: () => qc.invalidateQueries(['grocery', weekOf])
  })

  const updateItem = useMutation({
    mutationFn: ({ store, index, data }) => updateGroceryItem(weekOf, store, index, data),
    onSuccess: () => qc.invalidateQueries(['grocery', weekOf])
  })

  const addItemMut = useMutation({
    mutationFn: ({ store, item }) => addGroceryItem(weekOf, store, item),
    onSuccess: () => qc.invalidateQueries(['grocery', weekOf])
  })

  const removeItemMut = useMutation({
    mutationFn: ({ store, index }) => removeGroceryItem(weekOf, store, index),
    onSuccess: () => qc.invalidateQueries(['grocery', weekOf])
  })

  const updateStaplesMut = useMutation({
    mutationFn: updateStaples,
    onSuccess: () => qc.invalidateQueries(['staples'])
  })

  function doCopy(store) {
    const items = grocery?.[store] || []
    const text = items.map(i => (i.checked ? '✓ ' : '• ') + i.item).join('\n')
    copyToClipboard(text).then(() => {
      setCopied(store)
      setTimeout(() => setCopied(null), 2000)
    })
  }

  const hasItems = !!(grocery?.whole_foods?.length || grocery?.target?.length)

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-borg-border shrink-0">
        <div className="flex items-center gap-1">
          <button onClick={() => setWeekOf(addWeeks(weekOf, -1))}
            className="p-1 rounded text-borg-muted hover:text-borg-text hover:bg-borg-panel transition-colors">
            <ChevronLeft size={14} />
          </button>
          <span className="text-xs text-borg-text px-1">Week of {fmtDate(weekOf)}</span>
          <button onClick={() => setWeekOf(addWeeks(weekOf, 1))}
            className="p-1 rounded text-borg-muted hover:text-borg-text hover:bg-borg-panel transition-colors">
            <ChevronRight size={14} />
          </button>
        </div>
        <button onClick={() => generateMut.mutate()} disabled={generateMut.isPending}
          className="flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded border border-borg-green/50
                     text-borg-green hover:bg-borg-panel disabled:opacity-50 transition-colors shrink-0">
          {generateMut.isPending ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
          {hasItems ? 'Update List' : 'Generate List'}
        </button>
      </div>

      {isLoading
        ? <div className="text-center text-borg-dim py-8">Loading…</div>
        : (
          <div className="flex-1 overflow-y-auto p-4">
            {!hasItems
              ? (
                <div className="flex flex-col items-center justify-center h-40 text-borg-dim text-center space-y-3">
                  <ShoppingCart size={32} className="opacity-20" />
                  <div className="text-sm">No grocery list. Click "Generate List" to build from this week's plan.</div>
                </div>
              )
              : (
                <div className="flex gap-6">
                  <StoreColumn label="Whole Foods" items={grocery.whole_foods || []}
                    onToggle={(i, c) => updateItem.mutate({ store: 'whole_foods', index: i, data: { checked: c } })}
                    onEditName={(i, v) => updateItem.mutate({ store: 'whole_foods', index: i, data: { item: v } })}
                    onAdd={v => addItemMut.mutate({ store: 'whole_foods', item: v })}
                    onRemove={i => removeItemMut.mutate({ store: 'whole_foods', index: i })}
                    copied={copied === 'whole_foods'} onCopy={() => doCopy('whole_foods')} />
                  <div className="w-px bg-borg-border shrink-0" />
                  <StoreColumn label="Target" items={grocery.target || []}
                    onToggle={(i, c) => updateItem.mutate({ store: 'target', index: i, data: { checked: c } })}
                    onEditName={(i, v) => updateItem.mutate({ store: 'target', index: i, data: { item: v } })}
                    onAdd={v => addItemMut.mutate({ store: 'target', item: v })}
                    onRemove={i => removeItemMut.mutate({ store: 'target', index: i })}
                    copied={copied === 'target'} onCopy={() => doCopy('target')} />
                </div>
              )
            }

            {/* Staples editor */}
            <div className="mt-6 border-t border-borg-border pt-4">
              <button onClick={() => setShowStaples(s => !s)}
                className="flex items-center gap-1.5 text-xs text-borg-muted hover:text-borg-text transition-colors">
                <span>{showStaples ? '▾' : '▸'}</span> Edit Standing Staples
              </button>
              {showStaples && staples && (
                <StaplesEditor staples={staples} onSave={s => updateStaplesMut.mutate(s)} />
              )}
            </div>
          </div>
        )
      }
    </div>
  )
}

// ─── Main View ────────────────────────────────────────────────────────────────

export default function MealPlannerView() {
  const [tab, setTab] = useState('week')

  const { data: recipes = [], isLoading: recipesLoading, refetch: refetchRecipes } = useQuery({
    queryKey: ['recipes'],
    queryFn: () => listRecipes()
  })

  const tabs = [
    { id: 'week',    label: 'Week' },
    { id: 'catalog', label: 'Catalog' },
    { id: 'grocery', label: 'Grocery' },
  ]

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center gap-3 px-6 py-4 border-b border-borg-border shrink-0">
        <ChefHat size={18} className="text-borg-green" />
        <div>
          <div className="text-borg-text font-semibold">Meal Planner</div>
          <div className="text-borg-muted text-sm">{recipes.length} recipes</div>
        </div>
      </div>

      <TabBar tabs={tabs} active={tab} onChange={t => { setTab(t) }} />

      <div className="flex-1 overflow-hidden flex flex-col">
        {tab === 'week'    && <WeekTab recipes={recipes} />}
        {tab === 'catalog' && <CatalogTab recipes={recipes} isLoading={recipesLoading} onRefresh={refetchRecipes} />}
        {tab === 'grocery' && <GroceryTab />}
      </div>
    </div>
  )
}
