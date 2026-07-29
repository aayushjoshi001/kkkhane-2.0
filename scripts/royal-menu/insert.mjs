// Insert the Royal Rest House menu (categories → items → variations) into PROD
// via PostgREST using the service-role key. Idempotency guard: aborts if any of
// these category names already exist for the restaurant (rerun-safe).
//
// Usage: node scripts/royal-menu/insert.mjs
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { MENU, RESTAURANT_ID } from './menu.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..', '..')

function parseEnv(path) {
  const out = {}
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/); if (m) out[m[1]] = m[2].trim()
  }
  return out
}
const env = parseEnv(join(ROOT, '.env.local.production-backup'))
const URL = env.NEXT_PUBLIC_SUPABASE_URL
const KEY = env.SUPABASE_SERVICE_ROLE_KEY
if (!URL?.includes('wwvuflbzacromudviaab')) throw new Error('Unexpected prod URL: ' + URL)
const images = JSON.parse(readFileSync(join(__dirname, 'images.json'), 'utf8'))

const slugify = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')
const BAR = new Set(['Cold Drinks', 'Hard Drinks', 'Beer'])

async function rest(method, path, body, prefer = 'return=representation') {
  const res = await fetch(`${URL}/rest/v1/${path}`, {
    method,
    headers: {
      apikey: KEY, Authorization: `Bearer ${KEY}`,
      'Content-Type': 'application/json', Prefer: prefer,
    },
    body: body ? JSON.stringify(body) : undefined,
  })
  const text = await res.text()
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status}: ${text.slice(0, 300)}`)
  return text ? JSON.parse(text) : null
}

// --- guard: don't double-insert ---
const names = MENU.map(c => c.category)
const inList = names.map(n => `"${n.replace(/"/g, '\\"')}"`).join(',')
const existing = await rest('GET',
  `menu_categories?restaurant_id=eq.${RESTAURANT_ID}&name=in.(${encodeURIComponent(inList)})&select=name`)
if (existing.length) {
  console.error('ABORT: these categories already exist -> ' + existing.map(e => e.name).join(', '))
  process.exit(1)
}

// --- 1. categories ---
const catPayload = MENU.map((c, i) => ({
  restaurant_id: RESTAURANT_ID,
  name: c.category,
  sort_order: i,
  is_visible: true,
  station: BAR.has(c.category) ? 'bar' : 'kitchen',
  image_url: images[`cat-${slugify(c.category)}`] || null,
}))
const cats = await rest('POST', 'menu_categories', catPayload)
const catId = Object.fromEntries(cats.map(c => [c.name, c.id]))
console.log(`Categories inserted: ${cats.length}`)

// --- 2. items ---
const itemPayload = []
for (const c of MENU) {
  const catSlug = slugify(c.category)
  for (const it of c.items) {
    itemPayload.push({
      restaurant_id: RESTAURANT_ID,
      category_id: catId[c.category],
      name: it.name,
      description: it.desc || null,
      price: it.price,
      image_url: images[`${catSlug}-${slugify(it.name)}`] || null,
      is_available: true,
      tags: it.tags && it.tags.length ? it.tags : null,
      station: BAR.has(c.category) ? 'bar' : null,
    })
  }
}
const items = await rest('POST', 'menu_items', itemPayload)
const itemId = Object.fromEntries(items.map(i => [`${i.category_id}::${i.name}`, i.id]))
console.log(`Items inserted: ${items.length}`)

// --- 3. variations ---
const varPayload = []
for (const c of MENU) {
  for (const it of c.items) {
    if (!it.variations) continue
    const id = itemId[`${catId[c.category]}::${it.name}`]
    for (const v of it.variations) {
      varPayload.push({ menu_item_id: id, name: v.name, price: v.price, is_available: true })
    }
  }
}
const vars = varPayload.length ? await rest('POST', 'menu_item_variations', varPayload) : []
console.log(`Variations inserted: ${vars.length}`)

console.log('\nDONE.')
