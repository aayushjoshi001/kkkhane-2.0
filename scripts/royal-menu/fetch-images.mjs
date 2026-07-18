// Fetch a free-licensed photo per menu item/category from Wikimedia Commons,
// upload each to the prod `menu-images` bucket, and record the public URLs.
// Output: scripts/royal-menu/images.json  ({ slug: publicUrl })
//
// Usage: node scripts/royal-menu/fetch-images.mjs
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { MENU } from './menu.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..', '..')

// --- read prod creds from the production-backup env file ---
function parseEnv(path) {
  const out = {}
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/)
    if (m) out[m[1]] = m[2].trim()
  }
  return out
}
const env = parseEnv(join(ROOT, '.env.local.production-backup'))
const SUPABASE_URL = env.NEXT_PUBLIC_SUPABASE_URL
const SERVICE_KEY = env.SUPABASE_SERVICE_ROLE_KEY
if (!SUPABASE_URL?.includes('wwvuflbzacromudviaab')) throw new Error('Unexpected prod URL: ' + SUPABASE_URL)

const BUCKET = 'menu-images'
const PREFIX = 'royal-rest-house'
const UA = 'RoyalRestHouse-MenuSeed/1.0 (contact: siddantasodari123@gmail.com)'

const slugify = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')
const sleep = (ms) => new Promise(r => setTimeout(r, ms))

// fetch with retry/backoff on 429 + transient network errors.
async function politeFetch(url, opts = {}, tries = 5) {
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url, opts)
      if (res.status === 429) { await sleep(1500 * (i + 1)); continue }
      return res
    } catch (e) {
      if (i === tries - 1) throw e
      await sleep(1500 * (i + 1))
    }
  }
  return fetch(url, opts)
}

// Query Wikimedia Commons for a bitmap image matching `query`; return a ~700px thumbnail URL.
async function commonsImage(query) {
  const url = 'https://commons.wikimedia.org/w/api.php?' + new URLSearchParams({
    action: 'query', format: 'json', generator: 'search',
    gsrsearch: `${query} filetype:bitmap`, gsrnamespace: '6', gsrlimit: '8',
    prop: 'imageinfo', iiprop: 'url|mime|size', iiurlwidth: '700',
  })
  const res = await politeFetch(url, { headers: { 'User-Agent': UA } })
  if (!res.ok) throw new Error(`Commons API ${res.status}`)
  const json = await res.json()
  const pages = json?.query?.pages
  if (!pages) return null
  const cands = Object.values(pages)
    .map(p => p.imageinfo?.[0])
    .filter(ii => ii && /^image\/(jpeg|png)$/.test(ii.mime) && (ii.thumbwidth ?? ii.width) >= 400)
    // prefer landscape-ish real photos, skip tiny/odd ones
    .sort((a, b) => (b.width * b.height) - (a.width * a.height))
  const pick = cands[0]
  return pick ? { thumb: pick.thumburl, mime: pick.mime } : null
}

async function downloadAndUpload(query, slug) {
  const img = await commonsImage(query)
  if (!img) return { slug, query, status: 'no-match', url: null }
  const r = await politeFetch(img.thumb, { headers: { 'User-Agent': UA } })
  if (!r.ok) return { slug, query, status: `dl-${r.status}`, url: null }
  const buf = Buffer.from(await r.arrayBuffer())
  const ext = img.mime === 'image/png' ? 'png' : 'jpg'
  const path = `${PREFIX}/${slug}.${ext}`
  const up = await fetch(`${SUPABASE_URL}/storage/v1/object/${BUCKET}/${path}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${SERVICE_KEY}`,
      apikey: SERVICE_KEY,
      'Content-Type': img.mime,
      'x-upsert': 'true',
      'cache-control': '31536000',
    },
    body: buf,
  })
  if (!up.ok) return { slug, query, status: `upload-${up.status}: ${(await up.text()).slice(0, 120)}`, url: null }
  const publicUrl = `${SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${path}`
  return { slug, query, status: 'ok', url: publicUrl }
}

// Better queries for niche Nepali dishes Commons doesn't index under their local names.
const FALLBACKS = {
  'momo-sadeko-momo': 'momo nepal',
  'nepali-khana-set-nepali-khana-set': 'dal bhat',
  'khaja-set-khaja-set': 'poha flattened rice dish',
  'cat-sandeko': 'chicken tikka',
  'sandeko-meat-sandeko': 'chicken tikka',
  'sandeko-batmass-sandeko': 'roasted soybeans',
  'sandeko-peanut-sandeko': 'roasted peanuts',
  'sandeko-alu-sandeko': 'potato salad',
  'sandeko-chatpat': 'bhel puri',
  'sandeko-wai-wai-sandeko': 'instant noodles',
  'chicken-mutton-buff-sadeko': 'chicken tikka masala',
  'chicken-mutton-buff-tass': 'fried mutton',
  'chicken-mutton-buff-sekuwa': 'shish kebab grilled',
}

// Build the work list: one entry per category + per item (dedup by slug).
const jobs = []
const seen = new Set()
const add = (kind, catName, name, query) => {
  const slug = kind === 'cat' ? `cat-${slugify(catName)}` : `${slugify(catName)}-${slugify(name)}`
  if (seen.has(slug)) return
  seen.add(slug)
  jobs.push({ slug, query: FALLBACKS[slug] || query })
}
for (const cat of MENU) {
  add('cat', cat.category, cat.category, cat.img)
  for (const it of cat.items) add('item', cat.category, it.name, it.img)
}
// Resume: load anything already uploaded so re-runs only fill the gaps.
const outPath = join(__dirname, 'images.json')
let results = {}
try { results = JSON.parse(readFileSync(outPath, 'utf8')) } catch {}
const todo = jobs.filter(j => !results[j.slug])
console.log(`Total jobs: ${jobs.length}  |  already done: ${jobs.length - todo.length}  |  to fetch: ${todo.length}`)

// Single-threaded + inter-job delay to respect Wikimedia rate limits.
const report = []
for (const job of todo) {
  try {
    const r = await downloadAndUpload(job.query, job.slug)
    if (r.url) { results[job.slug] = r.url; writeFileSync(outPath, JSON.stringify(results, null, 2)) }
    report.push(r)
    process.stdout.write(r.status === 'ok' ? '.' : 'x')
  } catch (e) {
    report.push({ slug: job.slug, query: job.query, status: 'err: ' + e.message, url: null })
    process.stdout.write('!')
  }
  await sleep(400)
}
process.stdout.write('\n')

writeFileSync(outPath, JSON.stringify(results, null, 2))
const failed = report.filter(r => r.status !== 'ok')
console.log(`\nUploaded: ${Object.keys(results).length}/${jobs.length}`)
if (failed.length) {
  console.log(`\nFailed (${failed.length}):`)
  for (const f of failed) console.log(`  ${f.slug}  [${f.query}]  -> ${f.status}`)
}
console.log('\nWrote images.json')
