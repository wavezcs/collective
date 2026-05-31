import React, { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  listRecipes, createRecipe, updateRecipe, deleteRecipe, rateRecipe, scrapeRecipe,
  listPlans, getPlan, createPlan, updateDay, generatePlan, approvePlan,
  getGrocery, toggleGroceryItem
} from '../api/meals'
import {
  ChefHat, Zap, Clock, Star, Plus, Trash2, ThumbsUp, ThumbsDown,
  Heart, ShoppingCart, Calendar, ChevronLeft, ChevronRight,
  Check, Copy, User, UserX, RefreshCw, Loader2
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
    <div className="flex gap-1 border-b border-borg-border px-4">
      {tabs.map(t => (
        <button
          key={t.id}
          onClick={() => onChange(t.id)}
          className={`px-3 py-2.5 text-xs font-medium border-b-2 transition-colors -mb-px ${
            active === t.id
              ? 'border-borg-green text-borg-green'
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
    <span className={`inline-flex items-center gap-1 text-xs border rounded px-1.5 py-0.5 ${m.color} ${m.bg}`}>
      <Icon size={10} />
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

function RecipePickerModal({ recipes, day, onPick, onClose }) {
  const [search, setSearch] = useState('')
  const filtered = recipes.filter(r => {
    if (!search) return true
    return r.name.toLowerCase().includes(search.toLowerCase())
  })
  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div
        onClick={e => e.stopPropagation()}
        className="bg-borg-surface border border-borg-border rounded-lg w-full max-w-lg flex flex-col"
        style={{ maxHeight: '80vh' }}
      >
        <div className="flex items-center justify-between p-4 border-b border-borg-border">
          <div>
            <div className="text-borg-green font-semibold text-sm">Pick Meal</div>
            <div className="text-borg-dim text-xs">{day.day_name} · {fmtDate(day.date)}</div>
          </div>
          <button onClick={onClose} className="text-borg-muted hover:text-borg-text text-lg leading-none">×</button>
        </div>
        <div className="p-3 border-b border-borg-border">
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search recipes…"
            autoFocus
            className="w-full bg-borg-panel border border-borg-border rounded px-3 py-2 text-sm text-borg-text
                       placeholder-borg-dim focus:outline-none focus:border-borg-green/50"
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
                ${day.selected_recipe_id === r.id ? 'bg-borg-panel border border-borg-green/40' : ''}`}
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

// ─── Add Recipe Modal ─────────────────────────────────────────────────────────

function AddRecipeModal({ onClose, onCreate }) {
  const [form, setForm] = useState({
    name: '', url: '', source: '', prep_minutes: '', total_minutes: '',
    vegetarian: false, has_meat_option: false, kid_friendly: false,
    in_rotation: true, tags: '', notes: '',
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
        tags:          data.tags?.length ? data.tags.join(', ') : f.tags,
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
      tags: form.tags ? form.tags.split(',').map(t => t.trim()).filter(Boolean) : []
    })
    onClose()
  }

  const inputCls = `w-full bg-borg-panel border border-borg-border rounded px-3 py-2 text-sm text-borg-text
    placeholder-borg-dim focus:outline-none focus:border-borg-green/50`
  const labelCls = 'text-xs text-borg-muted block mb-1'

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <form
        onClick={e => e.stopPropagation()}
        onSubmit={submit}
        className="bg-borg-surface border border-borg-border rounded-lg w-full max-w-lg flex flex-col"
        style={{ maxHeight: '90vh' }}
      >
        <div className="flex items-center justify-between p-4 border-b border-borg-border">
          <div className="text-borg-green font-semibold text-sm">Add Recipe</div>
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
            <label className={labelCls}>Tags (comma-separated)</label>
            <input value={form.tags} onChange={e => set('tags', e.target.value)}
              placeholder="quick, soup, pasta, rotation…" className={inputCls} />
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
            className="flex-1 py-2 rounded border border-borg-border text-borg-muted hover:text-borg-text hover:border-borg-green/40 text-sm transition-colors">
            Cancel
          </button>
          <button type="submit" disabled={busy || !form.name.trim()}
            className="flex-1 py-2 rounded bg-borg-panel border border-borg-green/50 text-borg-green
                       hover:bg-borg-border disabled:opacity-40 text-sm transition-colors">
            {busy ? 'Adding…' : 'Add Recipe'}
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
  const [pickerDay, setPickerDay] = useState(null)

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

  const approve = useMutation({
    mutationFn: () => approvePlan(weekOf),
    onSuccess: () => { qc.invalidateQueries(['plan', weekOf]); qc.invalidateQueries(['grocery', weekOf]) }
  })

  const pickMeal = useMutation({
    mutationFn: ({ date, recipe_id }) => updateDay(weekOf, date, { selected_recipe_id: recipe_id }),
    onSuccess: () => qc.invalidateQueries(['plan', weekOf])
  })

  async function handlePick(recipeId) {
    await pickMeal.mutateAsync({ date: pickerDay.date, recipe_id: recipeId })
    setPickerDay(null)
  }

  const days = plan?.days || []
  const approved = plan?.status === 'approved'

  return (
    <div className="flex flex-col h-full">
      {/* Week navigator */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-borg-border shrink-0">
        <button onClick={() => setWeekOf(addWeeks(weekOf, -1))}
          className="p-1 rounded text-borg-muted hover:text-borg-text hover:bg-borg-panel transition-colors">
          <ChevronLeft size={16} />
        </button>
        <div className="text-center">
          <div className="text-borg-text text-sm font-medium">
            Week of {fmtDate(weekOf)}
          </div>
          {plan && (
            <div className={`text-xs ${approved ? 'text-borg-green' : 'text-borg-dim'}`}>
              {plan.status}
            </div>
          )}
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
        {plan && !approved && (
          <>
            <button onClick={() => generate.mutate()}
              disabled={generate.isPending}
              className="flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded border border-borg-border
                         text-borg-muted hover:text-borg-text hover:border-borg-green/40 transition-colors disabled:opacity-50">
              {generate.isPending ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
              Generate
            </button>
            <button onClick={() => approve.mutate()}
              disabled={approve.isPending}
              className="flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded border border-borg-green/50
                         text-borg-green hover:bg-borg-panel transition-colors disabled:opacity-50">
              {approve.isPending ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />}
              Approve week
            </button>
          </>
        )}
        {approved && (
          <div className="text-xs text-borg-green flex items-center gap-1.5">
            <Check size={12} /> Plan approved — grocery list ready
          </div>
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
        {days.map(day => {
          const recipe = day.selected_recipe_id ? recipeMap[day.selected_recipe_id] : null
          return (
            <div key={day.date}
              className="bg-borg-surface border border-borg-border rounded-lg p-3 hover:border-borg-green/30 transition-colors">
              <div className="flex items-start justify-between gap-2">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-borg-text font-medium text-sm">{day.day_name}</span>
                    <span className="text-borg-dim text-xs">{fmtDate(day.date)}</span>
                    <ContextBadge context={day.meal_context} />
                    {day.chris_home
                      ? <span className="flex items-center gap-0.5 text-xs text-borg-dim"><User size={10} /> Chris home</span>
                      : <span className="flex items-center gap-0.5 text-xs text-orange-400"><UserX size={10} /> Chris away</span>
                    }
                  </div>
                  {day.events_summary && (
                    <div className="text-xs text-borg-dim mt-0.5 truncate">{day.events_summary}</div>
                  )}
                  <div className="mt-1.5">
                    {recipe
                      ? (
                        <div className="flex items-center gap-2">
                          <ChefHat size={12} className="text-borg-green shrink-0" />
                          <span className="text-borg-text text-sm">{recipe.name}</span>
                          {recipe.source && <span className="text-borg-dim text-xs">{recipe.source}</span>}
                          <RatingBadge rating={recipe.rating} />
                        </div>
                      )
                      : <span className="text-borg-dim text-xs italic">Not planned</span>
                    }
                  </div>
                </div>
                {!approved && (
                  <button
                    onClick={() => setPickerDay(day)}
                    className="shrink-0 text-xs px-2 py-1 rounded border border-borg-border text-borg-muted
                               hover:text-borg-text hover:border-borg-green/40 transition-colors">
                    Pick
                  </button>
                )}
              </div>
            </div>
          )
        })}
      </div>

      {pickerDay && (
        <RecipePickerModal
          recipes={recipes}
          day={pickerDay}
          onPick={handlePick}
          onClose={() => setPickerDay(null)}
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

  const create = useMutation({
    mutationFn: createRecipe,
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

  // Filter client-side for speed
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
      <div className="px-4 py-3 border-b border-borg-border space-y-2 shrink-0">
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
              <button
                key={c.id}
                onClick={() => setChip(c.id)}
                className={`text-xs px-2 py-0.5 rounded border transition-colors ${
                  chip === c.id
                    ? 'border-borg-green text-borg-green bg-borg-panel'
                    : 'border-borg-border text-borg-muted hover:border-borg-green/40 hover:text-borg-text'
                }`}
              >
                {c.label}
              </button>
            ))}
          </div>
          <button
            onClick={() => setShowAdd(true)}
            className="flex items-center gap-1.5 text-xs text-borg-green px-2.5 py-1.5 rounded border border-borg-green/40
                       hover:bg-borg-panel transition-colors"
          >
            <Plus size={12} /> Add Recipe
          </button>
        </div>
      </div>

      {/* Recipe grid */}
      <div className="flex-1 overflow-y-auto p-3 space-y-2">
        {isLoading && <div className="text-center text-borg-dim py-8">Loading…</div>}
        {!isLoading && filtered.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full text-borg-dim text-center space-y-3">
            <ChefHat size={32} className="opacity-20" />
            <div className="text-sm">No recipes yet. Add one!</div>
          </div>
        )}
        {filtered.map(r => (
          <div key={r.id}
            className="group bg-borg-surface border border-borg-border rounded-lg overflow-hidden hover:border-borg-green/30 transition-colors">
            {/* Image */}
            {r.image && (
              <div className="w-full h-36 bg-borg-panel overflow-hidden">
                <img
                  src={r.image}
                  alt={r.name}
                  className="w-full h-full object-cover"
                  onError={e => { e.currentTarget.parentElement.style.display = 'none' }}
                />
              </div>
            )}
            <div className="p-3 flex items-start justify-between gap-2">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-borg-text font-medium text-sm">{r.name}</span>
                  {r.source && <span className="text-borg-dim text-xs">{r.source}</span>}
                  {r.url && (
                    <a href={r.url} target="_blank" rel="noopener noreferrer"
                      onClick={e => e.stopPropagation()}
                      className="text-xs text-borg-green/70 hover:text-borg-green">↗</a>
                  )}
                </div>
                <div className="flex items-center gap-3 mt-1 flex-wrap">
                  {r.total_minutes > 0 && (
                    <span className="flex items-center gap-1 text-xs text-borg-dim">
                      <Clock size={10} /> {r.total_minutes}m
                    </span>
                  )}
                  {r.vegetarian && <span className="text-xs text-green-500">vegetarian</span>}
                  {r.kid_friendly && <span className="text-xs text-blue-400">kids</span>}
                  {!r.in_rotation && <span className="text-xs text-borg-dim/60">off-rotation</span>}
                  {r.tags?.length > 0 && (
                    <div className="flex gap-1 flex-wrap">
                      {r.tags.map(t => (
                        <span key={t} className="text-xs text-borg-dim border border-borg-border rounded px-1">{t}</span>
                      ))}
                    </div>
                  )}
                </div>
                {r.notes && <div className="text-xs text-borg-dim mt-1 line-clamp-1">{r.notes}</div>}
              </div>

              {/* Actions */}
              <div className="flex items-center gap-1 shrink-0">
                <div className="flex gap-0.5">
                  {[-1, 1, 2].map(v => {
                    const m = RATING_META[String(v)]
                    const Icon = m.icon
                    return (
                      <button
                        key={v}
                        onClick={() => rate.mutate({ id: r.id, rating: v })}
                        className={`p-1 rounded transition-colors ${
                          r.rating === v
                            ? m.color + ' bg-borg-panel'
                            : 'text-borg-dim hover:' + m.color
                        }`}
                        title={m.label}
                      >
                        <Icon size={12} />
                      </button>
                    )
                  })}
                </div>
                <button
                  onClick={() => { if (confirm(`Delete "${r.name}"?`)) remove.mutate(r.id) }}
                  className="p-1 rounded text-borg-dim hover:text-red-400 hover:bg-borg-border transition-colors
                             opacity-0 group-hover:opacity-100"
                >
                  <Trash2 size={12} />
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>

      {showAdd && (
        <AddRecipeModal
          onClose={() => setShowAdd(false)}
          onCreate={data => create.mutateAsync(data)}
        />
      )}
    </div>
  )
}

// ─── Grocery Tab ──────────────────────────────────────────────────────────────

function GroceryTab({ weekOf }) {
  const qc = useQueryClient()

  const { data: grocery, isLoading } = useQuery({
    queryKey: ['grocery', weekOf],
    queryFn: () => getGrocery(weekOf)
  })

  const toggle = useMutation({
    mutationFn: ({ store, index, checked }) => toggleGroceryItem(weekOf, store, index, checked),
    onSuccess: (_, vars) => qc.invalidateQueries(['grocery', weekOf])
  })

  function copyList(store) {
    const items = grocery?.[store] || []
    const text = items.map(i => (i.checked ? '✓ ' : '• ') + i.item).join('\n')
    navigator.clipboard.writeText(text).catch(() => {})
  }

  if (isLoading) return <div className="text-center text-borg-dim py-8">Loading…</div>

  if (!grocery || (!grocery.whole_foods?.length && !grocery.target?.length)) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-borg-dim text-center space-y-3 p-8">
        <ShoppingCart size={32} className="opacity-20" />
        <div>
          <div className="text-sm text-borg-muted">No grocery list yet.</div>
          <div className="text-xs mt-1">Approve the week plan to generate one.</div>
        </div>
      </div>
    )
  }

  function StoreColumn({ storeKey, label }) {
    const items = grocery[storeKey] || []
    const done  = items.filter(i => i.checked).length
    return (
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between mb-2">
          <div>
            <div className="text-borg-text text-sm font-medium">{label}</div>
            <div className="text-borg-dim text-xs">{done}/{items.length} checked</div>
          </div>
          <button
            onClick={() => copyList(storeKey)}
            className="flex items-center gap-1 text-xs text-borg-muted hover:text-borg-text px-2 py-1 rounded
                       border border-borg-border hover:border-borg-green/40 transition-colors"
          >
            <Copy size={10} /> Copy
          </button>
        </div>
        <div className="space-y-1">
          {items.map((item, idx) => (
            <label key={idx}
              className={`flex items-center gap-2 p-2 rounded cursor-pointer transition-colors
                hover:bg-borg-panel ${item.checked ? 'opacity-50' : ''}`}
            >
              <input
                type="checkbox"
                checked={item.checked}
                onChange={e => toggle.mutate({ store: storeKey, index: idx, checked: e.target.checked })}
                className="accent-green-500 shrink-0"
              />
              <div className="flex-1 min-w-0">
                <span className={`text-sm ${item.checked ? 'line-through text-borg-dim' : 'text-borg-text'}`}>
                  {item.item}
                </span>
                {item.recipe && !item.staple && (
                  <span className="text-xs text-borg-dim ml-1">({item.recipe})</span>
                )}
                {item.staple && (
                  <span className="text-xs text-borg-dim/60 ml-1">staple</span>
                )}
              </div>
            </label>
          ))}
        </div>
      </div>
    )
  }

  return (
    <div className="flex-1 overflow-y-auto p-4">
      <div className="flex gap-6">
        <StoreColumn storeKey="whole_foods" label="Whole Foods" />
        <div className="w-px bg-borg-border shrink-0" />
        <StoreColumn storeKey="target" label="Target" />
      </div>
    </div>
  )
}

// ─── Main View ────────────────────────────────────────────────────────────────

export default function MealPlannerView() {
  const [tab, setTab] = useState('week')
  const [groceryWeek, setGroceryWeek] = useState(() => toMonday(new Date()))

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
      <div className="flex items-center gap-2 px-4 py-3 border-b border-borg-border bg-borg-surface shrink-0">
        <ChefHat size={16} className="text-borg-green" />
        <div>
          <div className="text-borg-green font-semibold text-sm">Meal Planner</div>
          <div className="text-borg-dim text-xs">{recipes.length} recipes</div>
        </div>
      </div>

      <TabBar tabs={tabs} active={tab} onChange={t => { setTab(t) }} />

      <div className="flex-1 overflow-hidden flex flex-col">
        {tab === 'week'    && <WeekTab recipes={recipes} />}
        {tab === 'catalog' && <CatalogTab recipes={recipes} isLoading={recipesLoading} onRefresh={refetchRecipes} />}
        {tab === 'grocery' && (
          <div className="flex flex-col h-full">
            <div className="px-4 py-2 border-b border-borg-border shrink-0">
              <div className="text-xs text-borg-dim">
                Grocery list for week of{' '}
                <span className="text-borg-text">{fmtDate(groceryWeek)}</span>
              </div>
            </div>
            <GroceryTab weekOf={groceryWeek} />
          </div>
        )}
      </div>
    </div>
  )
}
