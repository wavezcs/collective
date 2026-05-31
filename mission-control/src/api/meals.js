const BASE = '/meals'

// ─── Recipes ──────────────────────────────────────────────────────────────────

export async function listRecipes(params = {}) {
  const q = new URLSearchParams()
  if (params.tag)        q.set('tag', params.tag)
  if (params.vegetarian !== undefined) q.set('vegetarian', params.vegetarian)
  if (params.rating !== undefined)     q.set('rating', params.rating)
  if (params.search)     q.set('search', params.search)
  if (params.in_rotation !== undefined) q.set('in_rotation', params.in_rotation)
  const qs = q.toString()
  const r = await fetch(`${BASE}/recipes${qs ? '?' + qs : ''}`)
  const d = await r.json()
  return d.recipes || []
}

export async function getRecipe(id) {
  const r = await fetch(`${BASE}/recipes/${id}`)
  return r.json()
}

export async function createRecipe(data) {
  const r = await fetch(`${BASE}/recipes`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data)
  })
  return r.json()
}

export async function updateRecipe(id, data) {
  await fetch(`${BASE}/recipes/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data)
  })
}

export async function deleteRecipe(id) {
  await fetch(`${BASE}/recipes/${id}`, { method: 'DELETE' })
}

export async function scrapeRecipe(url) {
  const r = await fetch(`${BASE}/recipes/scrape`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url })
  })
  return r.json()
}

export async function rateRecipe(id, rating) {
  await fetch(`${BASE}/recipes/${id}/rate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ rating })
  })
}

// ─── Plans ────────────────────────────────────────────────────────────────────

export async function listPlans() {
  const r = await fetch(`${BASE}/plans`)
  const d = await r.json()
  return d.plans || []
}

export async function getPlan(weekOf) {
  const r = await fetch(`${BASE}/plans/${weekOf}`)
  if (!r.ok) return null
  return r.json()
}

export async function createPlan(weekOf) {
  const r = await fetch(`${BASE}/plans`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ week_of: weekOf })
  })
  return r.json()
}

export async function updateDay(weekOf, date, data) {
  const r = await fetch(`${BASE}/plans/${weekOf}/days/${date}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data)
  })
  return r.json()
}

export async function generatePlan(weekOf) {
  const r = await fetch(`${BASE}/plans/${weekOf}/generate`, { method: 'POST' })
  return r.json()
}

export async function approvePlan(weekOf) {
  const r = await fetch(`${BASE}/plans/${weekOf}/approve`, { method: 'POST' })
  return r.json()
}

// ─── Grocery ──────────────────────────────────────────────────────────────────

export async function getGrocery(weekOf) {
  const r = await fetch(`${BASE}/grocery/${weekOf}`)
  if (!r.ok) return null
  return r.json()
}

// ─── Pinterest ────────────────────────────────────────────────────────────────

export async function listPinterestBoards() {
  const r = await fetch(`${BASE}/pinterest`)
  const d = await r.json()
  return d.boards || []
}

export async function addPinterestBoard(url) {
  const r = await fetch(`${BASE}/pinterest`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url })
  })
  return r.json()
}

export async function deletePinterestBoard(id) {
  await fetch(`${BASE}/pinterest/${id}`, { method: 'DELETE' })
}

export async function scanPinterestBoard(id) {
  const r = await fetch(`${BASE}/pinterest/${id}/scan`, { method: 'POST' })
  return r.json()
}

// ─── Grocery ──────────────────────────────────────────────────────────────────

export async function toggleGroceryItem(weekOf, store, index, checked) {
  await fetch(`${BASE}/grocery/${weekOf}/item`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ store, index, checked })
  })
}
