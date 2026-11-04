/**
 * dsh-plugin-outlast / store
 *
 * Loads the bundled JSON knowledge base (trials / enemies / items / mechanics /
 * news sources) and provides alias-aware fuzzy lookup for Chinese and English
 * queries. Data files are data, never instructions.
 * @module dsh-plugin-outlast/store
 */

import { readFileSync, existsSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const DATA_DIR = fileURLToPath(new URL('../data/', import.meta.url))

/** @type {ReturnType<typeof buildStore> | undefined} */
let cached
let cachedStamp = 0

function readJson(name) {
  const file = path.join(DATA_DIR, name)
  if (!existsSync(file)) return undefined
  try {
    return JSON.parse(readFileSync(file, 'utf8'))
  } catch (error) {
    return { __error: `${name} 解析失败：${error instanceof Error ? error.message : String(error)}` }
  }
}

function stamp() {
  let latest = 0
  for (const name of ['trials.json', 'enemies.json', 'items.json', 'mechanics.json', 'news.json']) {
    const file = path.join(DATA_DIR, name)
    if (!existsSync(file)) continue
    try {
      latest = Math.max(latest, statSync(file).mtimeMs)
    } catch {
      /* ignore */
    }
  }
  return latest
}

function asArray(value) {
  return Array.isArray(value) ? value : []
}

function strList(value) {
  if (Array.isArray(value)) return value.map((item) => String(item ?? '').trim()).filter(Boolean)
  if (typeof value === 'string' && value.trim()) return [value.trim()]
  return []
}

function asText(value) {
  if (value === undefined || value === null) return ''
  if (typeof value === 'string') return value.trim()
  if (Array.isArray(value)) return value.map(asText).filter(Boolean).join(' ')
  return String(value).trim()
}

function normalizeTrial(raw, index) {
  if (!raw || typeof raw !== 'object') return undefined
  const nameEn = asText(raw.nameEn ?? raw.name ?? raw.title)
  const nameZh = asText(raw.nameZh ?? raw.zhName)
  if (!nameEn && !nameZh) return undefined
  return {
    id: asText(raw.id) || `trial-${index}`,
    nameEn: nameEn || nameZh,
    nameZh: nameZh || nameEn,
    aliases: strList(raw.aliases ?? raw.alias),
    kind: asText(raw.kind) || 'trial',
    map: asText(raw.map ?? raw.location),
    difficulty: asText(raw.difficulty),
    players: asText(raw.players ?? raw.playercount),
    durationMin: raw.durationMin ?? raw.minutes,
    summary: asText(raw.summary ?? raw.desc ?? raw.description),
    objectives: strList(raw.objectives ?? raw.steps),
    walkthrough: strList(raw.walkthrough ?? raw.guide ?? raw.strategy),
    tips: strList(raw.tips ?? raw.advice),
    enemies: strList(raw.enemies),
    rewards: strList(raw.rewards ?? raw.unlocks),
    sources: strList(raw.sources ?? raw.source),
    confidence: asText(raw.confidence) || 'medium',
    raw,
  }
}

function normalizeEnemy(raw, index) {
  if (!raw || typeof raw !== 'object') return undefined
  const nameEn = asText(raw.nameEn ?? raw.name)
  const nameZh = asText(raw.nameZh ?? raw.zhName)
  if (!nameEn && !nameZh) return undefined
  return {
    id: asText(raw.id) || `enemy-${index}`,
    nameEn: nameEn || nameZh,
    nameZh: nameZh || nameEn,
    aliases: strList(raw.aliases ?? raw.alias),
    category: asText(raw.category),
    map: asText(raw.map ?? raw.location),
    summary: asText(raw.summary ?? raw.desc ?? raw.description),
    behavior: strList(raw.behavior ?? raw.behaviors),
    detect: strList(raw.detect ?? raw.detection ?? raw.senses),
    counters: strList(raw.counters ?? raw.counter ?? raw.howToBeat ?? raw.tips),
    weakness: strList(raw.weakness ?? raw.weaknesses),
    lore: asText(raw.lore ?? raw.background),
    sources: strList(raw.sources ?? raw.source),
    confidence: asText(raw.confidence) || 'medium',
    raw,
  }
}

function normalizeItem(raw, index) {
  if (!raw || typeof raw !== 'object') return undefined
  const nameEn = asText(raw.nameEn ?? raw.name)
  const nameZh = asText(raw.nameZh ?? raw.zhName)
  if (!nameEn && !nameZh) return undefined
  return {
    id: asText(raw.id) || `item-${index}`,
    nameEn: nameEn || nameZh,
    nameZh: nameZh || nameEn,
    aliases: strList(raw.aliases ?? raw.alias),
    use: asText(raw.use ?? raw.usage ?? raw.desc ?? raw.description),
    howToGet: asText(raw.howToGet ?? raw.source ?? raw.acquire),
    tips: strList(raw.tips),
    sources: strList(raw.sources),
    raw,
  }
}

function normalizeCategory(raw, index) {
  if (!raw || typeof raw !== 'object') return undefined
  const id = asText(raw.id) || `category-${index}`
  const nameZh = asText(raw.nameZh ?? raw.name) || id
  const items = asArray(raw.items).map(normalizeItem).filter(Boolean)
  return { id, nameZh, items, raw }
}

function normalizeFeed(raw, index) {
  if (!raw || typeof raw !== 'object') return undefined
  return {
    id: asText(raw.id) || `feed-${index}`,
    url: asText(raw.url),
    status: asText(raw.status) || 'unknown',
    format: asText(raw.format),
    fields: raw.fields && typeof raw.fields === 'object' ? raw.fields : {},
    notes: asText(raw.notes),
    example: raw.example,
  }
}

function normalizeNews(raw, index) {
  if (!raw || typeof raw !== 'object') return undefined
  return {
    id: asText(raw.id) || `news-${index}`,
    titleEn: asText(raw.titleEn ?? raw.title),
    titleZh: asText(raw.titleZh),
    date: asText(raw.date),
    source: asText(raw.source) || 'Steam',
    url: asText(raw.url),
    summaryZh: asText(raw.summaryZh ?? raw.summary),
    tags: strList(raw.tags),
    raw,
  }
}

function indexEntry(kind, kindZh, entry, category) {
  const names = [entry.nameZh, entry.nameEn, entry.id, ...(entry.aliases ?? [])].filter(Boolean)
  const haystack = [
    entry.nameZh,
    entry.nameEn,
    entry.id,
    ...(entry.aliases ?? []),
    entry.summary,
    entry.map,
    entry.difficulty,
    entry.use,
    entry.howToGet,
    ...(entry.objectives ?? []),
    ...(entry.walkthrough ?? []),
    ...(entry.tips ?? []),
    ...(entry.behavior ?? []),
    ...(entry.counters ?? []),
    ...(entry.detect ?? []),
    ...(entry.weakness ?? []),
    ...(entry.rewards ?? []),
    entry.lore,
  ]
    .filter(Boolean)
    .join(' ')
  return { kind, kindZh, entry, category, names, haystack }
}

/** Build the normalized data store from the bundled JSON files. */
export function buildStore() {
  const trialsDoc = readJson('trials.json') ?? {}
  const enemiesDoc = readJson('enemies.json') ?? {}
  const itemsDoc = readJson('items.json') ?? {}
  const mechanicsDoc = readJson('mechanics.json')
  const newsDoc = readJson('news.json') ?? {}

  const trials = asArray(trialsDoc.trials).map(normalizeTrial).filter(Boolean)
  const programs = asArray(trialsDoc.programs).map((raw, index) => ({
    id: asText(raw?.id) || `program-${index}`,
    nameEn: asText(raw?.nameEn ?? raw?.name),
    nameZh: asText(raw?.nameZh ?? raw?.name),
    desc: asText(raw?.desc ?? raw?.description),
    unlock: asText(raw?.unlock),
    raw,
  }))
  const enemies = asArray(enemiesDoc.enemies).map(normalizeEnemy).filter(Boolean)

  const categories = asArray(itemsDoc.categories).length
    ? asArray(itemsDoc.categories).map(normalizeCategory).filter(Boolean)
    : asArray(itemsDoc.items).length
      ? [{ id: 'items', nameZh: '道具', items: asArray(itemsDoc.items).map(normalizeItem).filter(Boolean), raw: {} }]
      : []

  const mechanics = []
  if (mechanicsDoc) {
    for (const section of asArray(mechanicsDoc.sections ?? mechanicsDoc.mechanics)) {
      if (!section || typeof section !== 'object') continue
      mechanics.push({
        id: asText(section.id) || `mechanic-${mechanics.length}`,
        nameZh: asText(section.nameZh ?? section.name) || '机制',
        nameEn: asText(section.nameEn),
        summary: asText(section.summary ?? section.desc),
        points: strList(section.points ?? section.items ?? section.tips),
        sources: strList(section.sources),
      })
    }
  }
  // Items data may carry a "核心操作机制" category; merge it in.
  for (const category of categories) {
    if (category.id !== 'mechanics') continue
    for (const item of category.items) {
      mechanics.push({
        id: item.id,
        nameZh: item.nameZh,
        nameEn: item.nameEn,
        summary: item.use,
        points: [item.howToGet, ...item.tips].filter(Boolean),
        sources: item.sources,
      })
    }
  }

  const news = {
    updatedAt: asText(newsDoc.updatedAt),
    feeds: asArray(newsDoc.feeds).map(normalizeFeed).filter(Boolean),
    snapshot: asArray(newsDoc.snapshot).map(normalizeNews).filter(Boolean),
  }

  const index = [
    ...trials.map((entry) => indexEntry('trial', entry.kind === 'mk-challenge' ? 'MK 挑战' : '试炼', entry)),
    ...programs.map((entry) =>
      indexEntry('program', '计划', {
        id: entry.id,
        nameZh: entry.nameZh,
        nameEn: entry.nameEn,
        aliases: [entry.unlock].filter(Boolean),
        summary: entry.desc,
        tips: [],
      }),
    ),
    ...enemies.map((entry) => indexEntry('enemy', '敌人', entry)),
    ...categories.flatMap((category) =>
      category.items.map((entry) => indexEntry('item', category.nameZh, entry, category)),
    ),
    ...mechanics.map((entry) => indexEntry('mechanic', '机制', entry)),
    ...news.snapshot.map((entry) => indexEntry('news', '资讯', {
      id: entry.id,
      nameZh: entry.titleZh,
      nameEn: entry.titleEn,
      aliases: entry.tags,
      summary: entry.summaryZh,
      tips: [],
    })),
  ]

  const diagnostics = []
  for (const [name, doc] of [
    ['trials.json', trialsDoc],
    ['enemies.json', enemiesDoc],
    ['items.json', itemsDoc],
    ['mechanics.json', mechanicsDoc],
    ['news.json', newsDoc],
  ]) {
    if (doc?.__error) diagnostics.push(doc.__error)
  }

  return {
    dir: DATA_DIR,
    trials,
    programs,
    enemies,
    categories,
    mechanics,
    news,
    index,
    diagnostics,
    counts: {
      trials: trials.length,
      mkChallenges: trials.filter((trial) => trial.kind === 'mk-challenge').length,
      enemies: enemies.length,
      items: categories.reduce((sum, category) => sum + category.items.length, 0),
      mechanics: mechanics.length,
      news: news.snapshot.length,
    },
  }
}

/** Load (and cache) the data store; reloads when a data file changes on disk. */
export function getStore() {
  const current = stamp()
  if (cached && current === cachedStamp) return cached
  cached = buildStore()
  cachedStamp = current
  return cached
}

function normalizeQuery(query) {
  return String(query ?? '')
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace(/[《》「」『』【】()（）:：,，.。!！?？'"“”‘’·\-_/\\|+]/g, '')
}

function bigrams(value) {
  const chars = [...value]
  const result = new Set()
  for (let i = 0; i < chars.length - 1; i += 1) result.add(chars[i] + chars[i + 1])
  if (chars.length === 1) result.add(chars[0])
  return result
}

/**
 * Colloquial shorthands players actually type in QQ. Each key is matched as a
 * substring of the normalized query and rewritten to the official term.
 */
const QUERY_SYNONYMS = [
  ['警局', '警察局'],
  ['派出所', '警察局'],
  ['法庭', '法院'],
  ['审判', '法院'],
  ['疯人院', '孤儿院'],
  ['幼儿园', '孤儿院'],
  ['游乐场', '游乐园'],
  ['工厂', '玩具工厂'],
  ['监狱', '监狱农场'],
  ['庄园', '豪宅'],
  ['别墅', '豪宅'],
  ['码头关', '在药物中下毒'],
  ['dlc', '在药物中下毒'],
  ['第一关', '杀死告密者'],
  ['新地图', '锁死典狱长'],
  ['boss', ''],
  ['鹅妈妈', '鹅莓妈妈'],
  ['gusi', '鹅莓妈妈'],
  ['coyle', '利兰·科伊尔'],
  ['koyel', '利兰·科伊尔'],
  ['barbi', '弗兰科·巴比'],
  ['rig', '装具'],
]

function expandQueries(query) {
  const normalized = normalizeQuery(query)
  const variants = new Set([normalized])
  for (const [from, to] of QUERY_SYNONYMS) {
    if (!to || !normalized.includes(from)) continue
    variants.add(normalized.replace(from, to))
  }
  return [...variants].filter(Boolean)
}

function scoreNormalized(item, q) {
  if (!q) return 0
  let best = 0
  for (const name of item.names) {
    const n = normalizeQuery(name)
    if (!n) continue
    if (n === q) best = Math.max(best, 1000)
    else if (n.startsWith(q)) best = Math.max(best, 820)
    else if (n.includes(q)) best = Math.max(best, 640)
    else if (q.includes(n) && n.length >= 2) best = Math.max(best, 520)
    else if (q.length >= 2 && n.length >= 2) {
      const qb = bigrams(q)
      const nb = bigrams(n)
      let overlap = 0
      for (const gram of qb) if (nb.has(gram)) overlap += 1
      if (overlap > 0) best = Math.max(best, Math.round((overlap / Math.min(qb.size, nb.size)) * 380))
    }
  }
  const hay = normalizeQuery(item.haystack)
  if (hay.includes(q)) best = Math.max(best, 220)
  else if (q.length >= 2) {
    const qb = bigrams(q)
    let overlap = 0
    for (const gram of qb) if (hay.includes(gram)) overlap += 1
    if (overlap === qb.size) best = Math.max(best, 150)
    else if (overlap > 0) best = Math.max(best, Math.min(140, overlap * 22))
  }
  return best
}

function scoreEntry(item, query) {
  let best = 0
  for (const variant of expandQueries(query)) best = Math.max(best, scoreNormalized(item, variant))
  return best
}

/** Rank every indexed entry against a free-form Chinese/English query. */
export function searchAll(query, limit = 8) {
  const store = getStore()
  const scored = []
  for (const item of store.index) {
    const score = scoreEntry(item, query)
    if (score > 0) scored.push({ ...item, score })
  }
  scored.sort((a, b) => b.score - a.score)
  return scored.slice(0, limit)
}

/** Find the single best entry of one kind (trial | enemy | item | mechanic | news). */
export function findOne(kind, query) {
  const results = searchAll(query, 10).filter((item) => item.kind === kind)
  if (results.length === 0) return undefined
  return results[0]
}

/** Return the best trial match, falling back to a global search hit. */
export function findTrial(query) {
  return findOne('trial', query)
}

/** Return the best enemy match. */
export function findEnemy(query) {
  return findOne('enemy', query)
}

/** Return mechanics sections, optionally filtered by a keyword. */
export function findMechanics(query) {
  const store = getStore()
  if (!query) return store.mechanics
  const results = searchAll(query, 10)
    .filter((item) => item.kind === 'mechanic' || item.kind === 'item')
    .map((item) => (item.kind === 'mechanic' ? item.entry : undefined))
    .filter(Boolean)
  if (results.length > 0) return results
  return store.mechanics.filter((section) => {
    const hay = [section.nameZh, section.summary, ...section.points].join(' ')
    return hay.includes(query)
  })
}

/** Reset the cache (used by the bundled self-test script). */
export function resetStoreCache() {
  cached = undefined
  cachedStamp = 0
}

export { DATA_DIR }
