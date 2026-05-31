#!/usr/bin/env node
/**
 * Meal Planning API — Mission Control
 *
 * Stores recipes and meal plans in Neo4j.
 * Runs on collective.csdyn.com on port 3003.
 *
 * Endpoints:
 *   GET    /meals/recipes              — list recipes (filters: tag, vegetarian, rating, search, in_rotation)
 *   POST   /meals/recipes              — create recipe
 *   GET    /meals/recipes/:id          — get recipe
 *   PATCH  /meals/recipes/:id          — update recipe
 *   DELETE /meals/recipes/:id          — delete recipe
 *   POST   /meals/recipes/:id/rate     — rate recipe {rating: -1|1|2}
 *
 *   GET    /meals/plans                — list recent plans
 *   POST   /meals/plans                — create plan {week_of: 'YYYY-MM-DD'}
 *   GET    /meals/plans/:week          — get plan
 *   PATCH  /meals/plans/:week/days/:date — update day {selected_recipe_id, notes, meal_context, chris_home}
 *   POST   /meals/plans/:week/generate — classify days + suggest recipes
 *   POST   /meals/plans/:week/approve  — lock plan + generate grocery list
 *
 *   GET    /meals/grocery/:week        — get grocery list
 *   PATCH  /meals/grocery/:week/item   — toggle item {store, index, checked}
 *
 *   GET    /health
 */

const http   = require('http');
const neo4j  = require('neo4j-driver');
const fs     = require('fs');
const path   = require('path');
const crypto = require('crypto');
const { execFile } = require('child_process');

const CONFIG_PATH = path.join(__dirname, '../config/collective.json');
const config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
const { NEO4J_URI, NEO4J_USER, NEO4J_PASSWORD } = config.GENERAL;
const PORT = 3003;
const OLLAMA_BASE = 'http://ollama.csdyn.com:11434/v1';
const PREFS_PATH = path.join(__dirname, 'preferences.md');

const driver = neo4j.driver(NEO4J_URI, neo4j.auth.basic(NEO4J_USER, NEO4J_PASSWORD));

// Standing staples — default, overridden by Config node in Neo4j
const DEFAULT_STAPLES = {
  whole_foods: [
    'Organic milk',
    'Organic eggs',
    'Avocados',
    'Bananas',
    'Salad greens',
    'Fresh parsley or cilantro'
  ],
  target: [
    'Kids cereal',
    'Snack bars (Kind/Clif)',
    'Paper towels',
    'Sparkling water'
  ]
};

// ─── Aria / Ollama helpers ────────────────────────────────────────────────────

// Call aria:latest via Ollama for structured JSON output
async function ollamaChat(messages, { model = 'aria:latest', temperature = 0.3, timeout = 60_000 } = {}) {
  const res = await fetch(`${OLLAMA_BASE}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ollama' },
    body: JSON.stringify({ model, messages, format: 'json', stream: false, options: { temperature } }),
    signal: AbortSignal.timeout(timeout),
  });
  if (!res.ok) throw new Error(`Ollama ${res.status}`);
  const data = await res.json();
  const content = data.choices?.[0]?.message?.content || '';
  return JSON.parse(content);
}

// Aria classifies a recipe: vegetarian, kid_friendly, type (main/side), tags
async function analyzeRecipeWithAria(recipe) {
  const ingredients = [];
  if (recipe.cached_wf_items)     try { ingredients.push(...JSON.parse(recipe.cached_wf_items)); }     catch {}
  if (recipe.cached_target_items) try { ingredients.push(...JSON.parse(recipe.cached_target_items)); } catch {}

  return await ollamaChat([
    { role: 'system', content: 'You classify recipes. Return only valid JSON, no extra text.' },
    { role: 'user', content: `Classify this recipe:
Name: "${recipe.name}"
Source: ${recipe.source || 'unknown'}
Time: ${recipe.total_minutes || '?'} minutes
Ingredients: ${ingredients.slice(0, 25).join(', ') || 'not available'}

Return JSON (all fields required):
{
  "vegetarian": true or false,
  "kid_friendly": true or false,
  "type": "main" or "side",
  "tags": [],
  "should_exclude": true or false
}

Definitions:
- vegetarian: contains no meat, poultry, or seafood
- kid_friendly: a 6 or 9 year old would willingly eat it — familiar flavors, not spicy, not bitter greens or offal
- type: "side" only if clearly a side dish (fries, salad, roasted veg, rice, bread, dipping sauce). Otherwise "main"
- tags: up to 5 from: quick, pasta, soup, salad, chicken, beef, seafood, mexican, italian, asian, mediterranean, comfort, baking, snack
- should_exclude: true if this is a dessert, sweet treat, drink/cocktail/smoothie, condiment/sauce, or anything NOT suitable as a dinner meal or dinner side dish` }
  ], { temperature: 0.1 });
}

// Apply Aria's analysis to a recipe in the DB
async function applyRecipeAnalysis(recipeId, existingTags, result) {
  if (!result) return;
  const updates = { aria_analyzed: true };
  if (result.vegetarian !== undefined) updates.vegetarian = result.vegetarian;
  if (result.kid_friendly !== undefined) updates.kid_friendly = result.kid_friendly;
  if (result.type)       updates.type = result.type;
  if (result.tags?.length) updates.tags = [...new Set([...(existingTags || []), ...result.tags])];
  if (result.should_exclude) {
    updates.in_rotation = false;
    console.log(`[aria] excluding from rotation: ${recipeId} (dessert/drink/non-meal)`);
  }
  await updateRecipe(recipeId, updates);
}

// Analyze newly added recipes in the background (called after Pinterest scan / discover)
function analyzeNewRecipesBackground(addedList) {
  if (!addedList.length) return;
  setTimeout(async () => {
    console.log(`[aria] analyzing ${addedList.length} new recipes in background`);
    for (const item of addedList) {
      try {
        const recipe = await getRecipe(item.id);
        if (!recipe || recipe.aria_analyzed) continue;
        const result = await analyzeRecipeWithAria(recipe);
        await applyRecipeAnalysis(recipe.id, recipe.tags, result);
        await new Promise(r => setTimeout(r, 400));
      } catch (err) {
        console.warn(`[aria] analysis failed for ${item.name || item.id}: ${err.message}`);
      }
    }
    console.log(`[aria] background analysis complete`);
  }, 3000);
}

// Batch-analyze all recipes that Aria hasn't classified yet (up to 30 per call)
async function analyzeAllRecipes() {
  const session = driver.session();
  let toAnalyze;
  try {
    const r = await session.run(
      'MATCH (r:Recipe) WHERE r.aria_analyzed IS NULL OR r.aria_analyzed = false RETURN r LIMIT 30'
    );
    toAnalyze = r.records.map(rec => serializeProps(rec.get('r').properties));
  } finally {
    await session.close();
  }

  let analyzed = 0;
  for (const recipe of toAnalyze) {
    try {
      const result = await analyzeRecipeWithAria(recipe);
      await applyRecipeAnalysis(recipe.id, recipe.tags, result);
      analyzed++;
      await new Promise(r => setTimeout(r, 400));
    } catch (err) {
      console.warn(`[aria] batch analysis failed for ${recipe.name}: ${err.message}`);
    }
  }
  console.log(`[aria] batch analyzed ${analyzed}/${toAnalyze.length} recipes`);
  return { analyzed, remaining: toAnalyze.length - analyzed };
}

// ─── Preferences (editable markdown file, Aria keeps it updated) ─────────────

const DEFAULT_PREFERENCES = `# Meal Preferences

## Family
- Adults: Jill and Chris
- Kids: ages 6 and 9

## Observations
*(Aria updates this section based on ratings and selection patterns)*

## Favorites & Themes
*(Aria notes recurring loved recipes and themes)*

## Things to Avoid
*(Recipes or ingredients that consistently get low ratings)*

## Custom Notes
*(Add any custom notes for meal planning here)*
`;

async function readPreferences() {
  try { return await fs.promises.readFile(PREFS_PATH, 'utf8'); }
  catch { return DEFAULT_PREFERENCES; }
}

async function writePreferences(content) {
  await fs.promises.writeFile(PREFS_PATH, content, 'utf8');
}

// Aria reviews rating patterns, never-tried recipes, and updates preferences.md
async function ariaLearn() {
  const session = driver.session();
  let recipes, assignedIds = new Set();
  try {
    const rr = await session.run('MATCH (r:Recipe) WHERE r.in_rotation = true RETURN r');
    recipes = rr.records.map(rec => serializeProps(rec.get('r').properties));

    // Collect all recipe IDs that have ever appeared in a plan
    const pr = await session.run('MATCH (p:MealPlan) RETURN p.days');
    for (const rec of pr.records) {
      try {
        const days = JSON.parse(rec.get('p.days') || '[]');
        for (const d of days) {
          if (d.adult_recipe_id) assignedIds.add(d.adult_recipe_id);
          if (d.kids_recipe_id)  assignedIds.add(d.kids_recipe_id);
        }
      } catch {}
    }
  } finally {
    await session.close();
  }

  const loved      = recipes.filter(r => r.rating === 2);
  const liked      = recipes.filter(r => r.rating === 1);
  const disliked   = recipes.filter(r => r.rating === -1);
  const neverPicked = recipes.filter(r => !assignedIds.has(r.id));

  const currentPrefs = await readPreferences();
  const fmt = r => `- ${r.name} [tags:${(r.tags||[]).join(',')||'none'}, type:${r.type||'?'}, veg:${!!r.vegetarian}, kids:${!!r.kid_friendly}]`;

  const result = await ollamaChat([
    { role: 'system', content: 'You are Aria, analyzing meal planning history. Return only valid JSON.' },
    { role: 'user', content: `Analyze meal planning patterns and update the family preferences file.

CURRENT PREFERENCES:
${currentPrefs}

LOVED (rating=2):
${loved.slice(0, 15).map(fmt).join('\n') || 'none yet'}

LIKED (rating=1):
${liked.slice(0, 15).map(fmt).join('\n') || 'none yet'}

DISLIKED:
${disliked.slice(0, 10).map(fmt).join('\n') || 'none yet'}

NEVER SELECTED (in rotation but never assigned to any plan — ${neverPicked.length} total):
${neverPicked.slice(0, 40).map(fmt).join('\n') || 'all recipes have been tried'}

Tasks:
1. Identify patterns in what this family loves (cuisines, ingredients, tags)
2. For never-selected recipes: flag any that seem MISCLASSIFIED (wrong type, missing useful tags, or should be excluded as a dessert/drink/non-meal)
3. Update the preferences markdown with your findings — be specific and actionable

Return JSON:
{
  "updated_preferences": "full updated markdown content",
  "misclassified": [{"id":"...","name":"...","issue":"e.g. tagged as main but is clearly a dessert","fix":{"should_exclude":true}}],
  "summary": "2-3 sentence summary of patterns found"
}

Only flag CLEAR misclassifications. Keep the markdown concise and practical.` }
  ], { temperature: 0.4, timeout: 120_000 });

  if (result.updated_preferences) {
    await writePreferences(result.updated_preferences);
  }

  // Apply misclassification fixes
  for (const fix of (result.misclassified || [])) {
    if (!fix.id || !fix.fix) continue;
    try {
      const recipe = recipes.find(r => r.id === fix.id);
      if (fix.fix.should_exclude) {
        await updateRecipe(fix.id, { in_rotation: false, aria_analyzed: true });
      } else {
        await updateRecipe(fix.id, { ...fix.fix, aria_analyzed: false }); // re-flag for re-analysis
      }
      console.log(`[aria-learn] fixed "${fix.name}": ${fix.issue}`);
    } catch (err) {
      console.warn(`[aria-learn] fix failed for ${fix.name}: ${err.message}`);
    }
  }

  return {
    summary: result.summary,
    misclassified: result.misclassified || [],
    neverSelected: neverPicked.length,
  };
}

// Aria plans the full week — reasons about schedule, taste, variety
async function planWithAria(weekOf) {
  let plan = await getPlan(weekOf);
  if (!plan) plan = await createPlan(weekOf);

  const [events, recipes, prefs] = await Promise.all([
    getCalendarEvents(14),
    listRecipes({ in_rotation: 'true' }),
    readPreferences(),
  ]);

  // Taste profile from ratings
  const loved    = recipes.filter(r => r.rating === 2).map(r => r.name).slice(0, 10);
  const liked    = recipes.filter(r => r.rating === 1).map(r => r.name).slice(0, 10);
  const disliked = recipes.filter(r => r.rating === -1).map(r => r.name).slice(0, 5);

  // Find recently used recipe IDs (last 3 plans) to avoid repeats
  const recentIds = new Set();
  try {
    const session2 = driver.session();
    try {
      const recentR = await session2.run('MATCH (p:MealPlan) RETURN p.week_of, p.days ORDER BY p.week_of DESC LIMIT 4');
      for (const rec of recentR.records) {
        if (rec.get('p.week_of') === weekOf) continue;
        try {
          const days2 = JSON.parse(rec.get('p.days') || '[]');
          for (const d of days2) {
            if (d.adult_recipe_id) recentIds.add(d.adult_recipe_id);
          }
        } catch {}
      }
    } finally { await session2.close(); }
  } catch {}

  // Recipes never picked before (prioritize for variety)
  const allPlanSession = driver.session();
  const everPickedIds = new Set();
  try {
    const allR = await allPlanSession.run('MATCH (p:MealPlan) RETURN p.days');
    for (const rec of allR.records) {
      try {
        const d2 = JSON.parse(rec.get('p.days') || '[]');
        for (const d of d2) { if (d.adult_recipe_id) everPickedIds.add(d.adult_recipe_id); }
      } catch {}
    }
  } finally { await allPlanSession.close(); }

  const neverPicked = recipes.filter(r => r.type !== 'side' && !everPickedIds.has(r.id));

  // Classify days from calendar
  const days = plan.days.map(day => {
    const { context, chrisHome, eventsSummary, contextReason } = classifyDay(events, day.date);
    return { ...day, meal_context: context, chris_home: chrisHome,
             events_summary: eventsSummary, context_reason: contextReason };
  });

  const dayLines = days.map(d =>
    `${d.date} ${d.day_name}: context=${d.meal_context}` +
    (d.chris_home ? '' : ', Chris away') +
    (d.context_reason ? ` (${d.context_reason})` : '')
  ).join('\n');

  // Mains only for day assignment
  const mains = recipes.filter(r => r.type !== 'side');
  const recipeLines = mains.slice(0, 80).map(r =>
    `${r.id}|${r.name}|${r.total_minutes || 0}min|veg:${!!r.vegetarian}|kids:${!!r.kid_friendly}|rated:${r.rating ?? 0}`
  ).join('\n');

  const recentNames = recipes.filter(r => recentIds.has(r.id)).map(r => r.name).slice(0, 10);
  const neverPickedLines = neverPicked.slice(0, 20).map(r =>
    `${r.id}|${r.name}|${r.total_minutes || 0}min|veg:${!!r.vegetarian}|kids:${!!r.kid_friendly}|rated:${r.rating ?? 0}`
  ).join('\n');

  const result = await ollamaChat([
    { role: 'system', content: 'You are Aria, a thoughtful family meal planner. Return only valid JSON, no extra text.' },
    { role: 'user', content: `Plan dinners for the week of ${weekOf}.

Family: Jill and Chris (adults) + kids ages 6 and 9.

PREFERENCES & NOTES:
${prefs}

TASTE PROFILE:
Loved: ${loved.join(', ') || 'none rated yet'}
Liked: ${liked.join(', ') || 'none rated yet'}
Avoid: ${disliked.join(', ') || 'none flagged'}
Used recently (avoid repeating): ${recentNames.join(', ') || 'none'}

WEEK SCHEDULE:
${dayLines}

Time rules: fast=max 30 min, super-fast=max 20 min. When Chris is away, prefer veg + kid-friendly.

NEVER-TRIED RECIPES (give these priority for variety — try to use at least 2 this week):
${neverPickedLines || 'all recipes have been tried before'}

ALL RECIPES (id|name|minutes|veg|kids|rating):
${recipeLines}

Pick a unique adult_recipe_id for each day. No repeats. Vary cuisines. Respect time limits strictly.
Prefer higher-rated and never-tried recipes. Avoid recently used recipes unless there's a good reason.

Return JSON:
{
  "days": [
    {"date":"YYYY-MM-DD","adult_recipe_id":"id or null","kids_recipe_id":null,"reasoning":"one sentence"}
  ],
  "week_summary": "2-3 sentences summarizing the week"
}` }
  ], { temperature: 0.7, timeout: 120_000 });

  // Validate recipe IDs
  const validIds = new Set(recipes.map(r => r.id));
  const updatedDays = days.map(day => {
    const pick = (result.days || []).find(d => d.date === day.date);
    if (!pick) return day;
    return {
      ...day,
      adult_recipe_id: (pick.adult_recipe_id && validIds.has(pick.adult_recipe_id)) ? pick.adult_recipe_id : day.adult_recipe_id,
      kids_recipe_id:  (pick.kids_recipe_id  && validIds.has(pick.kids_recipe_id))  ? pick.kids_recipe_id  : day.kids_recipe_id,
      plan_notes: pick.reasoning || null,
    };
  });

  const session = driver.session();
  try {
    await session.run(
      'MATCH (p:MealPlan {week_of: $weekOf}) SET p.days = $days, p.aria_notes = $notes',
      { weekOf, days: JSON.stringify(updatedDays), notes: result.week_summary || null }
    );
    return { ...plan, days: updatedDays, aria_notes: result.week_summary };
  } finally {
    await session.close();
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => {
      try { resolve(body ? JSON.parse(body) : {}); }
      catch (e) { reject(new Error('Invalid JSON')); }
    });
    req.on('error', reject);
  });
}

function json(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type'
  });
  res.end(body);
}

function serializeVal(v) {
  return neo4j.isInt(v) ? v.toNumber() : v;
}

function serializeProps(props) {
  const out = {};
  for (const [k, v] of Object.entries(props)) {
    out[k] = serializeVal(v);
  }
  return out;
}

// Parse URL into route parts
// Returns: { section, id, sub, subId, action } or null
function route(req) {
  const url   = req.url.replace(/\?.*$/, '');
  const parts = url.split('/').filter(Boolean);
  // parts[0] === 'meals'
  if (parts[0] !== 'meals') return null;
  const section = parts[1]; // 'recipes' | 'plans' | 'grocery'
  const id      = parts[2] || null;
  const sub     = parts[3] || null; // 'rate' | 'days' | 'generate' | 'approve' | 'item'
  const subId   = parts[4] || null; // date in plans/:week/days/:date
  return { section, id, sub, subId };
}

function getQuery(req) {
  const idx = req.url.indexOf('?');
  if (idx === -1) return {};
  const q = {};
  new URLSearchParams(req.url.slice(idx + 1)).forEach((v, k) => { q[k] = v; });
  return q;
}

// Get calendar events for the next N days via calendar script
function getCalendarEvents(days = 14) {
  return new Promise((resolve) => {
    execFile('python3', ['/usr/local/bin/calendar', String(days)], { timeout: 30000 }, (err, stdout) => {
      if (err) { resolve([]); return; }
      try {
        const text = stdout.trim();
        // calendar script outputs JSON array of events
        const parsed = JSON.parse(text);
        resolve(Array.isArray(parsed) ? parsed : []);
      } catch {
        resolve([]);
      }
    });
  });
}

// Classify a day's meal context based on events
function classifyDay(events, dateStr) {
  const dayEvents = events.filter(e => {
    const start = e.start || e.date || '';
    return start.startsWith(dateStr);
  });

  let chrisHome = true;
  let eventsSummary = '';
  let context = 'normal';
  let contextReason = null;

  // Check for Chris travel
  const travel = dayEvents.find(e => {
    const t = (e.title || e.summary || '').toLowerCase();
    return t.includes('travel') || t.includes('trip') || t.includes('flight') || t.includes('chris') && t.includes('away');
  });
  if (travel) chrisHome = false;

  // Evening activities (5pm+) → fast
  const eveningActivities = dayEvents.filter(e => {
    const start = e.start || '';
    const hour = parseInt((start.split('T')[1] || '').split(':')[0] || '0', 10);
    const t = (e.title || e.summary || '').toLowerCase();
    return hour >= 17 && (t.includes('game') || t.includes('practice') || t.includes('soccer') ||
      t.includes('gymnastics') || t.includes('swim') || t.includes('activity') || t.includes('class'));
  });

  const specialEvent = dayEvents.find(e => {
    const t = (e.title || e.summary || '').toLowerCase();
    return t.includes('birthday') || t.includes('guest') || t.includes('party') || t.includes('dinner party');
  });

  if (specialEvent) {
    context = 'special';
    contextReason = specialEvent.title || specialEvent.summary || null;
  } else if (eveningActivities.length >= 2) {
    context = 'super-fast';
    contextReason = eveningActivities.map(e => e.title || e.summary || '').filter(Boolean).join(' & ');
  } else if (eveningActivities.length === 1) {
    context = 'fast';
    contextReason = eveningActivities[0].title || eveningActivities[0].summary || null;
  }

  eventsSummary = dayEvents.map(e => e.title || e.summary || '').filter(Boolean).join(', ');

  return { context, chrisHome, eventsSummary, contextReason };
}

// Pick a suitable recipe for a day
function pickRecipe(recipes, context, chrisHome) {
  if (!recipes.length) return null;

  // Filter by constraints
  let pool = recipes.filter(r => r.rating !== -1 && r.in_rotation);

  if (context === 'fast' || context === 'super-fast') {
    const maxMin = context === 'super-fast' ? 20 : 30;
    pool = pool.filter(r => !r.total_minutes || r.total_minutes <= maxMin);
    if (!pool.length) pool = recipes.filter(r => r.rating !== -1 && r.in_rotation);
  }

  if (!chrisHome) {
    // Jill solo — prefer vegetarian, kid-friendly
    const pref = pool.filter(r => r.vegetarian && r.kid_friendly);
    if (pref.length) pool = pref;
  }

  if (!pool.length) return null;
  return pool[Math.floor(Math.random() * pool.length)];
}

// Build a Monday-anchored week of dates
function weekDates(weekOf) {
  const dates = [];
  const base = new Date(weekOf + 'T12:00:00Z');
  const days = ['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'];
  for (let i = 0; i < 7; i++) {
    const d = new Date(base);
    d.setUTCDate(base.getUTCDate() + i);
    dates.push({ date: d.toISOString().slice(0, 10), day_name: days[i] });
  }
  return dates;
}

// ─── Recipe scraper ──────────────────────────────────────────────────────────

// Decode HTML entities in recipe names: &quot; &#8217; &amp; etc.
function decodeHtmlEntities(str) {
  if (!str) return str;
  return str
    .replace(/&quot;/gi, '"')
    .replace(/&#x27;|&#39;|&apos;/gi, "'")
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCharCode(parseInt(h, 16)));
}

// Parse ISO 8601 duration (PT30M, PT1H30M, PT1H) → minutes
function parseDuration(str) {
  if (!str) return 0;
  const h = str.match(/(\d+)H/);
  const m = str.match(/(\d+)M/);
  return (h ? parseInt(h[1], 10) * 60 : 0) + (m ? parseInt(m[1], 10) : 0);
}

// Classify a single ingredient into whole_foods or target
function classifyIngredient(item) {
  const i = item.toLowerCase();
  const wfPatterns = [
    /\b(fresh|organic|produce)\b/,
    /\b(onion|garlic|tomato|pepper|spinach|kale|broccoli|carrot|potato|cucumber|zucchini|squash|mushroom|celery|leek|shallot|avocado|lemon|lime|orange|apple|berry|berries|herb|basil|parsley|cilantro|thyme|rosemary|dill|mint|chive|scallion|ginger|jalape|arugula|lettuce|greens|cabbage|cauliflower|beet|asparagus|corn|pea|edamame|fennel|eggplant|artichoke)\b/,
    /\b(milk|cream|butter|cheese|yogurt|egg|tofu|tempeh|mozzarella|parmesan|feta|ricotta|cheddar|brie|goat cheese)\b/,
    /\b(chicken|beef|pork|salmon|shrimp|turkey|lamb|fish|ground)\b/,
    /\b(bread|tortilla|pita|naan)\b/,
  ];
  const targetPatterns = [
    /\b(canned|can of|jarred|jar of|dried|dry)\b/,
    /\b(pasta|rice|quinoa|lentil|bean|chickpea|flour|sugar|salt|pepper|oil|vinegar|soy sauce|broth|stock|coconut milk|tomato paste|tomato sauce|crushed tomato)\b/,
    /\b(panko|breadcrumb|cornstarch|baking|powder|soda|vanilla|chocolate|chip|nut|almond|walnut|pecan|cashew|peanut)\b/,
    /\b(honey|maple syrup|molasses|jam|jelly|mustard|ketchup|mayo|hot sauce|worcestershire|sriracha)\b/,
    /\b(cereal|oat|granola|chip|cracker|pretzel|popcorn)\b/,
  ];
  if (wfPatterns.some(p => p.test(i))) return 'whole_foods';
  if (targetPatterns.some(p => p.test(i))) return 'target';
  // Default: pantry-ish items go to Target, produce-sounding items to WF
  return 'target';
}

// Strip measurements from ingredient strings: "1-2 cloves of garlic" → "Garlic"
function simplifyIngredient(raw) {
  let s = String(raw || '').trim();
  // Remove parenthetical notes: (15 oz), (optional), (about 2 cups)
  s = s.replace(/\s*\([^)]*\)/g, '');
  // Remove leading quantities: numbers, fractions, ranges, unicode vulgar fractions
  s = s.replace(/^[\d¼½¾⅓⅔⅛⅜⅝⅞][\d\s\-–\/\.]*\s+/, '');
  // Remove measurement units at start
  const unitRe = /^(?:cups?|tablespoons?|tbsps?|teaspoons?|tsps?|ounces?|oz|pounds?|lbs?|grams?|g|kg|ml|liters?|litres?|cloves?|bunche?s?|cans?|jars?|heads?|sprigs?|pieces?|slices?|packages?|pkgs?|sticks?|pinch(?:es)?|dash(?:es)?|handfuls?|small|medium|large)\s+(?:of\s+)?/i;
  s = s.replace(unitRe, '');
  // Remove leading "of"
  s = s.replace(/^of\s+/i, '');
  // Remove prep notes after comma: ", chopped", ", diced", ", softened"
  s = s.replace(/,.*$/, '');
  s = s.trim();
  if (s) s = s[0].toUpperCase() + s.slice(1);
  return s;
}

async function scrapeRecipe(url) {
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; meal-planner/1.0)' },
    signal: AbortSignal.timeout(15_000)
  });
  if (!res.ok) throw new Error(`Fetch failed: ${res.status}`);
  const html = await res.text();

  // Extract JSON-LD blocks
  const ldBlocks = [];
  const ldRe = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = ldRe.exec(html)) !== null) {
    try { ldBlocks.push(JSON.parse(m[1])); } catch {}
  }

  // Find Recipe schema (may be nested in @graph)
  let schema = null;
  for (const block of ldBlocks) {
    const candidates = Array.isArray(block['@graph']) ? block['@graph'] : [block];
    for (const node of candidates) {
      const t = node['@type'];
      if (t === 'Recipe' || (Array.isArray(t) && t.includes('Recipe'))) {
        schema = node;
        break;
      }
    }
    if (schema) break;
  }

  // Derive source from hostname
  const hostname = new URL(url).hostname.replace(/^www\./, '');
  const sourceMap = {
    'cookieandkate.com': 'Cookie & Kate',
    'everydayannie.com': 'Everyday Annie',
    'smittenkitchen.com': 'Smitten Kitchen',
    'minimalistbaker.com': 'Minimalist Baker',
    'halfbakedharvest.com': 'Half Baked Harvest',
    'budgetbytes.com': 'Budget Bytes',
    'allrecipes.com': 'Allrecipes',
    'food52.com': 'Food52',
    'thekitchn.com': 'The Kitchn',
    'epicurious.com': 'Epicurious',
    'delish.com': 'Delish',
    'tasteofhome.com': 'Taste of Home',
    'simplyrecipes.com': 'Simply Recipes',
    'skinnytaste.com': 'Skinnytaste',
    'wellplated.com': 'Well Plated',
  };
  const source = sourceMap[hostname] || hostname;

  // Extract og:image as fallback image source
  const ogImageMatch = html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i)
                    || html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i);
  const ogImage = ogImageMatch ? ogImageMatch[1] : null;

  if (!schema) {
    // Fallback: grab <title> and og:image
    const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
    const name = decodeHtmlEntities(titleMatch ? titleMatch[1].replace(/\s*[|\-–].*$/, '').trim() : '');
    return { name, url, source, image: ogImage };
  }

  const name = decodeHtmlEntities(typeof schema.name === 'string' ? schema.name.trim() : '');
  const prepMinutes  = parseDuration(schema.prepTime);
  const cookMinutes  = parseDuration(schema.cookTime);
  const totalMinutes = parseDuration(schema.totalTime) || (prepMinutes + cookMinutes);

  // Image: prefer schema.image, fall back to og:image
  let image = ogImage;
  if (schema.image) {
    const img = schema.image;
    if (typeof img === 'string') image = img;
    else if (Array.isArray(img)) image = typeof img[0] === 'string' ? img[0] : img[0]?.url || ogImage;
    else if (typeof img === 'object') image = img.url || ogImage;
  }

  // Ingredients
  const rawIngredients = Array.isArray(schema.recipeIngredient) ? schema.recipeIngredient : [];
  const wfItems = [];
  const targetItems = [];
  for (const ing of rawIngredients) {
    if (classifyIngredient(ing) === 'whole_foods') wfItems.push(ing);
    else targetItems.push(ing);
  }

  // Guess vegetarian: no meat keywords in ingredients
  const meatRe = /\b(chicken|beef|pork|turkey|lamb|fish|shrimp|bacon|sausage|anchov|tuna|salmon|meat|ground)\b/i;
  const allIngs = rawIngredients.join(' ');
  const vegetarian = rawIngredients.length > 0 && !meatRe.test(allIngs);

  // Tags
  const tags = [];
  if (totalMinutes > 0 && totalMinutes <= 30) tags.push('quick');
  const keywords = schema.keywords ? String(schema.keywords).split(/[,;]/).map(k => k.trim().toLowerCase()).filter(Boolean) : [];
  const tagKeep = ['soup', 'pasta', 'salad', 'vegan', 'gluten-free', 'one-pot', 'instant pot', 'slow cooker'];
  for (const k of keywords) {
    if (tagKeep.some(t => k.includes(t))) tags.push(k);
  }

  return {
    name,
    url,
    source,
    image,
    prep_minutes: prepMinutes,
    total_minutes: totalMinutes,
    vegetarian,
    tags,
    cached_wf_items: wfItems.length ? JSON.stringify(wfItems) : null,
    cached_target_items: targetItems.length ? JSON.stringify(targetItems) : null,
  };
}

// ─── Recipe DB ops ───────────────────────────────────────────────────────────

async function listRecipes(filters = {}) {
  const session = driver.session();
  try {
    let where = [];
    const params = {};
    if (filters.tag) {
      where.push('$tag IN r.tags');
      params.tag = filters.tag;
    }
    if (filters.vegetarian !== undefined) {
      where.push('r.vegetarian = $vegetarian');
      params.vegetarian = filters.vegetarian === 'true';
    }
    if (filters.in_rotation !== undefined) {
      where.push('r.in_rotation = $in_rotation');
      params.in_rotation = filters.in_rotation === 'true';
    }
    if (filters.rating !== undefined) {
      where.push('r.rating = $rating');
      params.rating = neo4j.int(parseInt(filters.rating, 10));
    }
    if (filters.search) {
      where.push('toLower(r.name) CONTAINS toLower($search)');
      params.search = filters.search;
    }
    const whereClause = where.length ? 'WHERE ' + where.join(' AND ') : '';
    const result = await session.run(
      `MATCH (r:Recipe) ${whereClause} RETURN r ORDER BY r.name ASC`,
      params
    );
    return result.records.map(rec => serializeProps(rec.get('r').properties));
  } finally {
    await session.close();
  }
}

async function getRecipe(id) {
  const session = driver.session();
  try {
    const result = await session.run('MATCH (r:Recipe {id: $id}) RETURN r', { id });
    if (!result.records.length) return null;
    return serializeProps(result.records[0].get('r').properties);
  } finally {
    await session.close();
  }
}

async function createRecipe(data) {
  // Deduplicate by URL atomically — prevents race conditions on concurrent scans
  if (data.url) {
    const existingId = await getRecipeByUrl(data.url);
    if (existingId) return getRecipe(existingId);
  }
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const session = driver.session();
  try {
    await session.run(
      `CREATE (r:Recipe {
        id: $id,
        name: $name,
        url: $url,
        source: $source,
        prep_minutes: $prep_minutes,
        total_minutes: $total_minutes,
        vegetarian: $vegetarian,
        has_meat_option: $has_meat_option,
        kid_friendly: $kid_friendly,
        tags: $tags,
        rating: $rating,
        in_rotation: $in_rotation,
        times_made: $times_made,
        last_made: $last_made,
        notes: $notes,
        image: $image,
        cached_wf_items: $cached_wf_items,
        cached_target_items: $cached_target_items,
        created_at: $created_at
      })`,
      {
        id,
        name:               data.name || 'Untitled Recipe',
        url:                data.url || null,
        source:             data.source || null,
        image:              data.image || null,
        prep_minutes:       neo4j.int(data.prep_minutes || 0),
        total_minutes:      neo4j.int(data.total_minutes || 0),
        vegetarian:         data.vegetarian === true || data.vegetarian === 'true',
        has_meat_option:    data.has_meat_option === true || data.has_meat_option === 'true',
        kid_friendly:       data.kid_friendly === true || data.kid_friendly === 'true',
        tags:               Array.isArray(data.tags) ? data.tags : [],
        rating:             neo4j.int(data.rating !== undefined ? data.rating : 0),
        in_rotation:        data.in_rotation !== false,
        times_made:         neo4j.int(data.times_made || 0),
        last_made:          data.last_made || null,
        notes:              data.notes || null,
        cached_wf_items:    data.cached_wf_items || null,
        cached_target_items: data.cached_target_items || null,
        created_at:         now
      }
    );
    return { id, name: data.name, created_at: now };
  } finally {
    await session.close();
  }
}

async function updateRecipe(id, data) {
  const session = driver.session();
  try {
    // Build dynamic SET — handle type coercion
    const sets = [];
    const params = { id };
    for (const [k, v] of Object.entries(data)) {
      sets.push(`r.${k} = $${k}`);
      if (k === 'prep_minutes' || k === 'total_minutes' || k === 'rating' || k === 'times_made') {
        params[k] = neo4j.int(v);
      } else {
        params[k] = v;
      }
    }
    if (!sets.length) return;
    await session.run(`MATCH (r:Recipe {id: $id}) SET ${sets.join(', ')}`, params);
  } finally {
    await session.close();
  }
}

async function deleteRecipe(id) {
  const session = driver.session();
  try {
    await session.run('MATCH (r:Recipe {id: $id}) DETACH DELETE r', { id });
  } finally {
    await session.close();
  }
}

async function rateRecipe(id, rating) {
  const session = driver.session();
  try {
    await session.run(
      'MATCH (r:Recipe {id: $id}) SET r.rating = $rating',
      { id, rating: neo4j.int(rating) }
    );
  } finally {
    await session.close();
  }
}

// ─── Plan DB ops ─────────────────────────────────────────────────────────────

async function listPlans() {
  const session = driver.session();
  try {
    const result = await session.run(
      'MATCH (p:MealPlan) RETURN p ORDER BY p.week_of DESC LIMIT 12'
    );
    return result.records.map(r => {
      const props = serializeProps(r.get('p').properties);
      // Don't send full days/grocery in list
      delete props.days;
      delete props.grocery;
      return props;
    });
  } finally {
    await session.close();
  }
}

async function getPlan(weekOf) {
  const session = driver.session();
  try {
    const result = await session.run(
      'MATCH (p:MealPlan {week_of: $weekOf}) RETURN p',
      { weekOf }
    );
    if (!result.records.length) return null;
    const props = serializeProps(result.records[0].get('p').properties);
    if (props.days) props.days = JSON.parse(props.days);
    if (props.grocery) props.grocery = JSON.parse(props.grocery);
    return props;
  } finally {
    await session.close();
  }
}

async function createPlan(weekOf) {
  const now = new Date().toISOString();
  const session = driver.session();
  try {
    // Check if plan already exists
    const existing = await getPlan(weekOf);
    if (existing) return existing;

    const days = weekDates(weekOf).map(({ date, day_name }) => ({
      date,
      day_name,
      meal_context: 'normal',
      chris_home: true,
      events_summary: '',
      adult_recipe_id: null,
      kids_recipe_id: null,
      extra_ids: [],
      notes: null
    }));

    await session.run(
      `CREATE (p:MealPlan {
        week_of: $weekOf,
        status: 'draft',
        days: $days,
        grocery: $grocery,
        created_at: $now
      })`,
      {
        weekOf,
        days: JSON.stringify(days),
        grocery: JSON.stringify({ whole_foods: [], target: [] }),
        now
      }
    );
    return { week_of: weekOf, status: 'draft', days, grocery: { whole_foods: [], target: [] }, created_at: now };
  } finally {
    await session.close();
  }
}

async function updateDay(weekOf, date, data) {
  const plan = await getPlan(weekOf);
  if (!plan) return null;

  const days = plan.days.map(d => {
    if (d.date !== date) return d;
    return { ...d, ...data };
  });

  const session = driver.session();
  try {
    await session.run(
      'MATCH (p:MealPlan {week_of: $weekOf}) SET p.days = $days',
      { weekOf, days: JSON.stringify(days) }
    );
    return days.find(d => d.date === date);
  } finally {
    await session.close();
  }
}

async function generatePlan(weekOf) {
  // Get or create the plan
  let plan = await getPlan(weekOf);
  if (!plan) plan = await createPlan(weekOf);

  // Fetch calendar events
  const events = await getCalendarEvents(14);

  // Get recipes for suggestions
  const recipes = await listRecipes({ in_rotation: 'true' });

  const days = plan.days.map(day => {
    const { context, chrisHome, eventsSummary, contextReason } = classifyDay(events, day.date);
    const suggested = pickRecipe(recipes, context, chrisHome);
    return {
      ...day,
      meal_context: context,
      chris_home: chrisHome,
      events_summary: eventsSummary,
      context_reason: contextReason,
      adult_recipe_id: day.adult_recipe_id || (suggested ? suggested.id : null),
      kids_recipe_id: day.kids_recipe_id || null
    };
  });

  const session = driver.session();
  try {
    await session.run(
      'MATCH (p:MealPlan {week_of: $weekOf}) SET p.days = $days',
      { weekOf, days: JSON.stringify(days) }
    );
    return { ...plan, days };
  } finally {
    await session.close();
  }
}

async function clearPlanRecipes(weekOf) {
  const plan = await getPlan(weekOf);
  if (!plan) return null;
  const days = plan.days.map(d => ({ ...d, adult_recipe_id: null, kids_recipe_id: null, extra_ids: [] }));
  const session = driver.session();
  try {
    await session.run('MATCH (p:MealPlan {week_of: $weekOf}) SET p.days = $days', { weekOf, days: JSON.stringify(days) });
    return { ...plan, days };
  } finally {
    await session.close();
  }
}

async function deduplicateRecipes() {
  const session = driver.session();
  try {
    const r = await session.run(`
      MATCH (r:Recipe)
      WHERE r.url IS NOT NULL AND r.url <> ''
      WITH r.url AS url, collect(r) AS recipes
      WHERE size(recipes) > 1
      RETURN url, recipes
    `);
    let deleted = 0;
    for (const rec of r.records) {
      const nodes = rec.get('recipes');
      const recipes = nodes.map(n => serializeProps(n.properties));
      // Keep the one created first, delete the rest
      recipes.sort((a, b) => (a.created_at || '') < (b.created_at || '') ? -1 : 1);
      for (const recipe of recipes.slice(1)) {
        await session.run('MATCH (r:Recipe {id: $id}) DETACH DELETE r', { id: recipe.id });
        deleted++;
      }
    }
    return { deleted };
  } finally {
    await session.close();
  }
}

// Parse <loc> entries from sitemap XML
function parseSitemapXml(xml) {
  const urls = [];
  const locRe = /<loc>([^<]+)<\/loc>/g;
  let m;
  while ((m = locRe.exec(xml)) !== null) urls.push(m[1].trim());
  return urls;
}

// Fetch URLs from a sitemap, following one level of sitemap index if needed
async function fetchSitemapUrls(sitemapUrl) {
  const res = await fetch(sitemapUrl, {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; meal-planner/1.0)' },
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) return [];
  const xml = await res.text();
  const urls = parseSitemapXml(xml);

  // If it's a sitemap index, follow the first sub-sitemap that looks recipe-related
  if (xml.includes('<sitemapindex') || (urls.length > 0 && urls[0].endsWith('.xml'))) {
    const subSitemaps = urls.filter(u => /recipe|post|article|content/i.test(u));
    const target = subSitemaps[0] || urls[0];
    if (target) {
      try {
        const subRes = await fetch(target, {
          headers: { 'User-Agent': 'Mozilla/5.0 (compatible; meal-planner/1.0)' },
          signal: AbortSignal.timeout(10_000),
        });
        if (subRes.ok) return parseSitemapXml(await subRes.text());
      } catch {}
    }
  }
  return urls;
}

// Discover new recipes from known recipe sites via sitemaps, saved as in_rotation: false
async function discoverRecipes(limit = 15) {
  const sites = [
    { host: 'cookieandkate.com',    sitemap: '/sitemap.xml' },
    { host: 'smittenkitchen.com',   sitemap: '/sitemap.xml' },
    { host: 'minimalistbaker.com',  sitemap: '/sitemap_index.xml' },
    { host: 'halfbakedharvest.com', sitemap: '/sitemap.xml' },
    { host: 'budgetbytes.com',      sitemap: '/sitemap.xml' },
    { host: 'food52.com',           sitemap: '/sitemap.xml' },
    { host: 'simplyrecipes.com',    sitemap: '/sitemap.xml' },
    { host: 'skinnytaste.com',      sitemap: '/sitemap.xml' },
    { host: 'wellplated.com',       sitemap: '/sitemap.xml' },
    { host: 'thekitchn.com',        sitemap: '/sitemap.xml' },
  ];

  // Shuffle sites to vary results each run
  sites.sort(() => Math.random() - 0.5);

  const added = [];

  for (const site of sites) {
    if (added.length >= limit) break;
    try {
      const allUrls = await fetchSitemapUrls(`https://${site.host}${site.sitemap}`);

      // Filter for page URLs that look like recipes (not tags, categories, pages)
      const recipeUrls = allUrls.filter(u => {
        try {
          const p = new URL(u).pathname;
          return p.length > 5 && !/\.(xml|json|rss|css|js)/.test(p) &&
            !/\/(tag|category|author|page|feed|wp-content|wp-admin)\//i.test(p);
        } catch { return false; }
      });

      // Randomly sample up to 8 from this site
      const sample = recipeUrls.sort(() => Math.random() - 0.5).slice(0, 8);

      for (const url of sample) {
        if (added.length >= limit) break;
        const existing = await getRecipeByUrl(url);
        if (existing) continue;

        await new Promise(r => setTimeout(r, 350));

        try {
          const scraped = await scrapeRecipe(url);
          if (!scraped.name) continue;
          const recipe = await createRecipe({ ...scraped, in_rotation: false, rating: 0 });
          added.push({ id: recipe.id, name: scraped.name, url });
          console.log(`[discover] added: ${scraped.name} (${url})`);
        } catch (err) {
          console.warn(`[discover] skipped ${url}: ${err.message}`);
        }
      }
    } catch (err) {
      console.warn(`[discover] site ${site.host} failed: ${err.message}`);
    }
  }

  console.log(`[discover] done — added ${added.length} recipes`);
  analyzeNewRecipesBackground(added);
  return { added };
}

async function getStaples() {
  const session = driver.session();
  try {
    const r = await session.run('MATCH (c:Config {key: "staples"}) RETURN c.value AS v');
    if (r.records.length) {
      try { return JSON.parse(r.records[0].get('v')); } catch {}
    }
  } finally {
    await session.close();
  }
  return DEFAULT_STAPLES;
}

async function updateStaples(staples) {
  const session = driver.session();
  try {
    await session.run(
      'MERGE (c:Config {key: "staples"}) SET c.value = $v',
      { v: JSON.stringify(staples) }
    );
  } finally {
    await session.close();
  }
}

async function generateGrocery(weekOf) {
  const plan = await getPlan(weekOf);
  if (!plan) return null;

  const staples = await getStaples();
  const wfItems = [...staples.whole_foods.map(item => ({ item, checked: false, staple: true }))];
  const targetItems = [...staples.target.map(item => ({ item, checked: false, staple: true }))];

  const seenItems = new Set();

  const recipeIds = new Set(
    plan.days.flatMap(d => [d.adult_recipe_id, d.kids_recipe_id, ...(d.extra_ids || [])]).filter(Boolean)
  );
  for (const recipeId of recipeIds) {
    const recipe = await getRecipe(recipeId);
    if (!recipe) continue;

    if (recipe.cached_wf_items) {
      try {
        const items = JSON.parse(recipe.cached_wf_items);
        for (const raw of items) {
          const item = simplifyIngredient(raw);
          if (!item) continue;
          const key = item.toLowerCase();
          if (!seenItems.has(key)) {
            seenItems.add(key);
            wfItems.push({ item, checked: false, recipe: recipe.name });
          }
        }
      } catch {}
    }

    if (recipe.cached_target_items) {
      try {
        const items = JSON.parse(recipe.cached_target_items);
        for (const raw of items) {
          const item = simplifyIngredient(raw);
          if (!item) continue;
          const key = item.toLowerCase();
          if (!seenItems.has(key)) {
            seenItems.add(key);
            targetItems.push({ item, checked: false, recipe: recipe.name });
          }
        }
      } catch {}
    }
  }

  const grocery = { whole_foods: wfItems, target: targetItems };

  const session = driver.session();
  try {
    await session.run(
      'MATCH (p:MealPlan {week_of: $weekOf}) SET p.grocery = $grocery',
      { weekOf, grocery: JSON.stringify(grocery) }
    );
    return { ...plan, grocery };
  } finally {
    await session.close();
  }
}

// ─── Grocery ops ─────────────────────────────────────────────────────────────

async function getGrocery(weekOf) {
  const plan = await getPlan(weekOf);
  if (!plan) return null;
  return plan.grocery || { whole_foods: [], target: [] };
}

async function updateGroceryItem(weekOf, store, index, data) {
  const plan = await getPlan(weekOf);
  if (!plan) return null;
  const grocery = plan.grocery || { whole_foods: [], target: [] };
  const list = grocery[store];
  if (!list || index < 0 || index >= list.length) return null;
  if ('checked' in data) list[index].checked = data.checked;
  if ('item' in data) list[index].item = data.item;
  const session = driver.session();
  try {
    await session.run('MATCH (p:MealPlan {week_of: $weekOf}) SET p.grocery = $grocery', { weekOf, grocery: JSON.stringify(grocery) });
    return grocery;
  } finally {
    await session.close();
  }
}

async function addGroceryItem(weekOf, store, item) {
  const plan = await getPlan(weekOf);
  if (!plan) return null;
  const grocery = plan.grocery || { whole_foods: [], target: [] };
  if (!grocery[store]) grocery[store] = [];
  grocery[store].push({ item, checked: false });
  const session = driver.session();
  try {
    await session.run('MATCH (p:MealPlan {week_of: $weekOf}) SET p.grocery = $grocery', { weekOf, grocery: JSON.stringify(grocery) });
    return grocery;
  } finally {
    await session.close();
  }
}

async function removeGroceryItem(weekOf, store, index) {
  const plan = await getPlan(weekOf);
  if (!plan) return null;
  const grocery = plan.grocery || { whole_foods: [], target: [] };
  const list = grocery[store];
  if (!list || index < 0 || index >= list.length) return null;
  list.splice(index, 1);
  const session = driver.session();
  try {
    await session.run('MATCH (p:MealPlan {week_of: $weekOf}) SET p.grocery = $grocery', { weekOf, grocery: JSON.stringify(grocery) });
    return grocery;
  } finally {
    await session.close();
  }
}

// ─── Pinterest ───────────────────────────────────────────────────────────────

const PINTEREST_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
  'Cache-Control': 'no-cache',
};

// Extract external recipe links from a Pinterest pins object
function extractPinLinks(pins) {
  const urls = new Set();
  for (const pin of Object.values(pins)) {
    const link = pin?.link || pin?.rich_metadata?.url || pin?.story_pin_data?.pages?.[0]?.blocks?.[0]?.link?.url;
    if (link && typeof link === 'string' && link.startsWith('http') && !/pinterest\.com|pin\.it/i.test(link)) {
      urls.add(link);
    }
  }
  return urls;
}

// Paginate a board using Pinterest's internal BoardFeedResource API
async function paginateBoardFeed(boardId, boardPath, initialBookmark) {
  const urls = new Set();
  let bookmark = initialBookmark;
  let page = 0;

  while (page < 20) { // max 20 pages × 50 pins = 1000 pins
    const options = { board_id: String(boardId), page_size: 50, add_vase: true };
    if (bookmark) options.bookmarks = [bookmark];

    const dataParam = encodeURIComponent(JSON.stringify({ options, context: {} }));
    const apiUrl = `https://www.pinterest.com/resource/BoardFeedResource/get/?source_url=${encodeURIComponent(boardPath)}&data=${dataParam}&_=${Date.now()}`;

    try {
      const res = await fetch(apiUrl, {
        headers: {
          ...PINTEREST_HEADERS,
          'Accept': 'application/json, text/javascript, */*, q=0.01',
          'X-Requested-With': 'XMLHttpRequest',
          'X-Pinterest-AppState': 'active',
          'Referer': `https://www.pinterest.com${boardPath}`,
        },
        signal: AbortSignal.timeout(15_000),
      });

      if (!res.ok) break;
      const json = await res.json();
      const pins = json?.resource_response?.data;
      if (!Array.isArray(pins) || pins.length === 0) break;

      for (const pin of pins) {
        const link = pin?.link || pin?.rich_metadata?.url;
        if (link && typeof link === 'string' && link.startsWith('http') && !/pinterest\.com|pin\.it/i.test(link)) {
          urls.add(link);
        }
      }

      bookmark = json?.resource_response?.bookmark;
      if (!bookmark || bookmark === '-end-') break;

      page++;
      await new Promise(r => setTimeout(r, 200));
    } catch {
      break;
    }
  }

  console.log(`[pinterest] paginated ${page} pages, found ${urls.size} more links`);
  return urls;
}

// Extract recipe URLs from a Pinterest board page
async function scrapePinterestBoard(boardUrl) {
  const res = await fetch(boardUrl, {
    headers: PINTEREST_HEADERS,
    signal: AbortSignal.timeout(20_000),
    redirect: 'follow',
  });
  if (!res.ok) throw new Error(`Pinterest fetch failed: ${res.status}`);
  const html = await res.text();

  const urls = new Set();
  let boardId = null;
  let boardPath = null;
  let initialBookmark = null;

  try { boardPath = new URL(boardUrl).pathname; } catch {}

  // Strategy 1: __PWS_DATA__ Redux state (main Pinterest data blob)
  const pwsMatch = html.match(/<script id="__PWS_DATA__">\s*window\.__PWS_DATA__\s*=\s*(\{[\s\S]*?\});\s*<\/script>/);
  if (pwsMatch) {
    try {
      const data = JSON.parse(pwsMatch[1]);
      const state = data?.props?.initialReduxState || {};

      // Extract initial pin links
      const pinUrls = extractPinLinks(state.pins || {});
      for (const u of pinUrls) urls.add(u);

      // Extract board_id for pagination
      const boards = state.boards || {};
      for (const board of Object.values(boards)) {
        if (board?.url && boardPath && boardPath.startsWith(board.url.replace(/\/?$/, ''))) {
          boardId = board.id;
          break;
        }
        // Also try matching by checking if the board URL is a prefix
        if (!boardId && board?.id) boardId = board.id; // fallback: use any board
      }

      // Extract pagination bookmark from feed state
      const feeds = state.feeds || {};
      for (const feed of Object.values(feeds)) {
        if (feed?.bookmark) { initialBookmark = feed.bookmark; break; }
      }
    } catch {}
  }

  // Strategy 2: JSON "link" values anywhere in page (catches Pinterest v2 format)
  if (urls.size < 10) {
    const linkRe = /"link"\s*:\s*"(https?:\/\/(?!(?:[^"\/]*\.)?pinterest\.com|pin\.it)[^"]+)"/g;
    let m;
    while ((m = linkRe.exec(html)) !== null) urls.add(m[1]);
  }

  // Strategy 3: href attributes pointing off-domain (last resort)
  if (urls.size < 5) {
    const hrefRe = /href="(https?:\/\/(?!(?:[^"\/]*\.)?pinterest\.com|pin\.it)[^"]+)"/g;
    let m;
    while ((m = hrefRe.exec(html)) !== null) {
      const u = m[1];
      try { if (new URL(u).pathname.length > 3) urls.add(u); } catch {}
    }
  }

  console.log(`[pinterest] initial scrape: ${urls.size} links, boardId=${boardId}`);

  // Paginate via internal API to get remaining pins
  if (boardId && boardPath) {
    const moreUrls = await paginateBoardFeed(boardId, boardPath, initialBookmark);
    for (const u of moreUrls) urls.add(u);
  }

  console.log(`[pinterest] total links found: ${urls.size}`);

  // Board name from <title>
  const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
  const name = titleMatch ? titleMatch[1].replace(/\s*[\|–\-].*$/, '').trim() : boardUrl;

  return { urls: [...urls], name };
}

// Check if a recipe URL already exists
async function getRecipeByUrl(url) {
  const session = driver.session();
  try {
    const r = await session.run('MATCH (r:Recipe {url: $url}) RETURN r.id AS id', { url });
    return r.records.length ? r.records[0].get('id') : null;
  } finally {
    await session.close();
  }
}

// Pinterest board DB ops
async function listPinterestBoards() {
  const session = driver.session();
  try {
    const r = await session.run('MATCH (b:PinterestBoard) RETURN b ORDER BY b.created_at DESC');
    return r.records.map(rec => serializeProps(rec.get('b').properties));
  } finally {
    await session.close();
  }
}

async function addPinterestBoard(url, name) {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const session = driver.session();
  try {
    // Check for duplicate
    const existing = await session.run('MATCH (b:PinterestBoard {url: $url}) RETURN b', { url });
    if (existing.records.length) return serializeProps(existing.records[0].get('b').properties);
    await session.run(
      `CREATE (b:PinterestBoard {
        id: $id, url: $url, name: $name,
        last_scanned: null, recipes_added: $zero, pin_count: $zero,
        created_at: $now
      })`,
      { id, url, name: name || url, zero: neo4j.int(0), now }
    );
    return { id, url, name: name || url, last_scanned: null, recipes_added: 0, pin_count: 0, created_at: now };
  } finally {
    await session.close();
  }
}

async function deletePinterestBoard(id) {
  const session = driver.session();
  try {
    await session.run('MATCH (b:PinterestBoard {id: $id}) DELETE b', { id });
  } finally {
    await session.close();
  }
}

async function scanPinterestBoard(boardId) {
  const session = driver.session();
  let board;
  try {
    const r = await session.run('MATCH (b:PinterestBoard {id: $id}) RETURN b', { id: boardId });
    if (!r.records.length) return null;
    board = serializeProps(r.records[0].get('b').properties);
  } finally {
    await session.close();
  }

  console.log(`[pinterest] scanning board: ${board.url}`);
  let urls, boardName;
  try {
    ({ urls, name: boardName } = await scrapePinterestBoard(board.url));
  } catch (err) {
    console.error(`[pinterest] scrape failed: ${err.message}`);
    return { error: err.message, added: [], skipped: 0 };
  }

  const added = [];
  let skipped = 0;

  for (const url of urls) {
    // Skip non-recipe-looking URLs
    if (/\.(jpg|jpeg|png|gif|pdf|mp4|zip)/i.test(url)) { skipped++; continue; }

    const existing = await getRecipeByUrl(url);
    if (existing) { skipped++; continue; }

    // Small delay to avoid hammering recipe sites
    await new Promise(r => setTimeout(r, 400));

    try {
      const scraped = await scrapeRecipe(url);
      if (!scraped.name) { skipped++; continue; }
      const recipe = await createRecipe({ ...scraped, in_rotation: true });
      added.push({ id: recipe.id, name: scraped.name, url });
      console.log(`[pinterest] added: ${scraped.name}`);
    } catch (err) {
      console.warn(`[pinterest] skipped ${url}: ${err.message}`);
      skipped++;
    }
  }

  // Update board stats
  const s2 = driver.session();
  try {
    await s2.run(
      `MATCH (b:PinterestBoard {id: $id})
       SET b.last_scanned = $now,
           b.pin_count = $pinCount,
           b.name = $name,
           b.recipes_added = b.recipes_added + $newCount`,
      {
        id: boardId,
        now: new Date().toISOString(),
        pinCount: neo4j.int(urls.length),
        name: boardName || board.name,
        newCount: neo4j.int(added.length),
      }
    );
  } finally {
    await s2.close();
  }

  console.log(`[pinterest] board scan done — added ${added.length}, skipped ${skipped}`);
  analyzeNewRecipesBackground(added);
  return { added, skipped, pin_count: urls.length };
}

async function scanAllBoards() {
  const boards = await listPinterestBoards();
  for (const board of boards) {
    try { await scanPinterestBoard(board.id); } catch {}
  }
}

// Auto-scan: 3 min after startup, then every 24 h
setTimeout(scanAllBoards, 3 * 60 * 1000);
setInterval(scanAllBoards, 24 * 60 * 60 * 1000);

// ─── Server ──────────────────────────────────────────────────────────────────

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') { json(res, 200, {}); return; }
  if (req.method === 'GET' && (req.url === '/health' || req.url === '/meals/health')) {
    json(res, 200, { ok: true }); return;
  }

  const r = route(req);
  if (!r) { json(res, 404, { error: 'Not found' }); return; }

  try {
    const { section, id, sub, subId } = r;

    // ── Recipes ──────────────────────────────────────────────────────────────
    if (section === 'recipes') {
      // GET /meals/recipes
      if (req.method === 'GET' && !id) {
        const q = getQuery(req);
        json(res, 200, { recipes: await listRecipes(q) });
        return;
      }
      // POST /meals/recipes
      if (req.method === 'POST' && !id) {
        const body = await parseBody(req);
        json(res, 201, await createRecipe(body));
        return;
      }
      // POST /meals/recipes/analyze — batch-analyze unclassified recipes in background
      if (req.method === 'POST' && id === 'analyze') {
        analyzeAllRecipes().catch(() => {});
        json(res, 202, { ok: true, message: 'Analysis started' });
        return;
      }
      // POST /meals/recipes/deduplicate
      if (req.method === 'POST' && id === 'deduplicate') {
        json(res, 200, await deduplicateRecipes());
        return;
      }
      // POST /meals/recipes/discover
      if (req.method === 'POST' && id === 'discover') {
        const body = await parseBody(req);
        json(res, 200, await discoverRecipes(body.limit || 15));
        return;
      }
      // POST /meals/recipes/scrape
      if (req.method === 'POST' && id === 'scrape') {
        const body = await parseBody(req);
        if (!body.url) { json(res, 400, { error: 'url required' }); return; }
        json(res, 200, await scrapeRecipe(body.url));
        return;
      }
      // GET /meals/recipes/:id
      if (req.method === 'GET' && id && !sub) {
        const recipe = await getRecipe(id);
        if (!recipe) { json(res, 404, { error: 'Not found' }); return; }
        json(res, 200, recipe);
        return;
      }
      // PATCH /meals/recipes/:id
      if (req.method === 'PATCH' && id && !sub) {
        const body = await parseBody(req);
        await updateRecipe(id, body);
        json(res, 200, { ok: true });
        return;
      }
      // DELETE /meals/recipes/:id
      if (req.method === 'DELETE' && id && !sub) {
        await deleteRecipe(id);
        json(res, 200, { ok: true });
        return;
      }
      // POST /meals/recipes/:id/rate
      if (req.method === 'POST' && id && sub === 'rate') {
        const body = await parseBody(req);
        await rateRecipe(id, body.rating);
        json(res, 200, { ok: true });
        return;
      }
    }

    // ── Plans ────────────────────────────────────────────────────────────────
    if (section === 'plans') {
      // GET /meals/plans
      if (req.method === 'GET' && !id) {
        json(res, 200, { plans: await listPlans() });
        return;
      }
      // POST /meals/plans
      if (req.method === 'POST' && !id) {
        const body = await parseBody(req);
        json(res, 201, await createPlan(body.week_of));
        return;
      }
      // GET /meals/plans/:week
      if (req.method === 'GET' && id && !sub) {
        const plan = await getPlan(id);
        if (!plan) { json(res, 404, { error: 'Not found' }); return; }
        json(res, 200, plan);
        return;
      }
      // PATCH /meals/plans/:week/days/:date
      if (req.method === 'PATCH' && id && sub === 'days' && subId) {
        const body = await parseBody(req);
        const day = await updateDay(id, subId, body);
        if (!day) { json(res, 404, { error: 'Not found' }); return; }
        json(res, 200, day);
        return;
      }
      // POST /meals/plans/:week/generate
      if (req.method === 'POST' && id && sub === 'generate') {
        json(res, 200, await generatePlan(id));
        return;
      }
      // POST /meals/plans/:week/plan-with-aria
      if (req.method === 'POST' && id && sub === 'plan-with-aria') {
        json(res, 200, await planWithAria(id));
        return;
      }
      // POST /meals/plans/:week/clear
      if (req.method === 'POST' && id && sub === 'clear') {
        const plan = await clearPlanRecipes(id);
        if (!plan) { json(res, 404, { error: 'Not found' }); return; }
        json(res, 200, plan);
        return;
      }
      // POST /meals/plans/:week/approve (backward compat — now just generates grocery)
      if (req.method === 'POST' && id && sub === 'approve') {
        const plan = await generateGrocery(id);
        if (!plan) { json(res, 404, { error: 'Not found' }); return; }
        json(res, 200, plan);
        return;
      }
    }

    // ── Grocery ──────────────────────────────────────────────────────────────
    if (section === 'grocery') {
      // GET /meals/grocery/:week
      if (req.method === 'GET' && id && !sub) {
        const grocery = await getGrocery(id);
        if (!grocery) { json(res, 404, { error: 'Not found' }); return; }
        json(res, 200, grocery);
        return;
      }
      // POST /meals/grocery/:week/generate
      if (req.method === 'POST' && id && sub === 'generate') {
        const plan = await generateGrocery(id);
        if (!plan) { json(res, 404, { error: 'Not found' }); return; }
        json(res, 200, plan.grocery || {});
        return;
      }
      // PATCH /meals/grocery/:week/item — update item (checked or name)
      if (req.method === 'PATCH' && id && sub === 'item') {
        const body = await parseBody(req);
        const grocery = await updateGroceryItem(id, body.store, body.index, body);
        if (!grocery) { json(res, 404, { error: 'Not found' }); return; }
        json(res, 200, grocery);
        return;
      }
      // POST /meals/grocery/:week/item — add item
      if (req.method === 'POST' && id && sub === 'item') {
        const body = await parseBody(req);
        const grocery = await addGroceryItem(id, body.store, body.item);
        if (!grocery) { json(res, 404, { error: 'Not found' }); return; }
        json(res, 200, grocery);
        return;
      }
      // DELETE /meals/grocery/:week/item — remove item
      if (req.method === 'DELETE' && id && sub === 'item') {
        const body = await parseBody(req);
        const grocery = await removeGroceryItem(id, body.store, body.index);
        if (!grocery) { json(res, 404, { error: 'Not found' }); return; }
        json(res, 200, grocery);
        return;
      }
    }

    // ── Staples ───────────────────────────────────────────────────────────────
    if (section === 'staples') {
      if (req.method === 'GET' && !id) {
        json(res, 200, await getStaples());
        return;
      }
      if (req.method === 'PATCH' && !id) {
        const body = await parseBody(req);
        await updateStaples(body);
        json(res, 200, { ok: true });
        return;
      }
    }

    // ── Preferences ───────────────────────────────────────────────────────────
    if (section === 'preferences') {
      // GET /meals/preferences
      if (req.method === 'GET' && !id) {
        json(res, 200, { content: await readPreferences() });
        return;
      }
      // PATCH /meals/preferences
      if (req.method === 'PATCH' && !id) {
        const body = await parseBody(req);
        await writePreferences(body.content || '');
        json(res, 200, { ok: true });
        return;
      }
      // POST /meals/preferences/learn — Aria analyzes patterns and updates preferences
      if (req.method === 'POST' && id === 'learn') {
        json(res, 200, await ariaLearn());
        return;
      }
    }

    // ── Pinterest ─────────────────────────────────────────────────────────────
    if (section === 'pinterest') {
      // GET /meals/pinterest — list boards
      if (req.method === 'GET' && !id) {
        json(res, 200, { boards: await listPinterestBoards() });
        return;
      }
      // POST /meals/pinterest — add board {url}
      if (req.method === 'POST' && !id) {
        const body = await parseBody(req);
        if (!body.url) { json(res, 400, { error: 'url required' }); return; }
        // Derive name from board URL while fetching; we'll update after first scan
        const name = body.url.replace(/\/$/, '').split('/').slice(-2).join(' / ');
        const board = await addPinterestBoard(body.url, name);
        // Kick off initial scan in background (don't await)
        scanPinterestBoard(board.id).catch(() => {});
        json(res, 201, board);
        return;
      }
      // DELETE /meals/pinterest/:id
      if (req.method === 'DELETE' && id && !sub) {
        await deletePinterestBoard(id);
        json(res, 200, { ok: true });
        return;
      }
      // POST /meals/pinterest/:id/scan — trigger scan now
      if (req.method === 'POST' && id && sub === 'scan') {
        const result = await scanPinterestBoard(id);
        if (!result) { json(res, 404, { error: 'Board not found' }); return; }
        json(res, 200, result);
        return;
      }
    }

    json(res, 405, { error: 'Method not allowed' });
  } catch (err) {
    console.error('[meal-api] error:', err);
    json(res, 500, { error: err.message });
  }
});

server.listen(PORT, '0.0.0.0', () => console.log(`[meal-api] listening on :${PORT}`));
process.on('SIGTERM', async () => { await driver.close(); process.exit(0); });
