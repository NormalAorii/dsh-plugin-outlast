/**
 * dsh-plugin-outlast / news
 *
 * 实时抓取 Steam 官方《逃生：试炼》公告（appid 1304930）。
 * 优先 ISteamNews JSON（含中文），失败退 RSS，再失败回退打包快照。
 * @module dsh-plugin-outlast/news
 */

import { requestJson, requestText, stripMarkup, clip, formatDate, oneLine } from './core.js'
import { getStore } from './store.js'

export const STEAM_APP_ID = 1304930

/** Stable hub page: Steam points individual announcements at the unreachable steamcommunity.com. */
export const NEWS_HUB_URL = `https://store.steampowered.com/news/app/${STEAM_APP_ID}`

const USER_HEADERS = {
  'accept-language': 'zh-CN,zh;q=0.9,en;q=0.6',
}

function newsApiUrl(count) {
  // feeds=steam_community_announcements keeps Red Barrels' own posts and drops
  // SteamDB chart noise / third-party Russian reposts.
  return `https://api.steampowered.com/ISteamNews/GetNewsForApp/v2/?appid=${STEAM_APP_ID}&count=${count}&maxlength=1600&format=json&feeds=steam_community_announcements`
}

/** Normalise a title for snapshot matching (Steam ignores l=schinese, so titles stay English). */
function normTitle(text) {
  return String(text ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, ' ')
    .trim()
}

/** Snapshot titles are hand-checked Chinese, so reuse them to translate live English titles. */
function titleTranslationMap() {
  const map = new Map()
  try {
    for (const item of getStore().news.snapshot) {
      if (!item.titleEn || !item.titleZh || item.titleZh === item.titleEn) continue
      map.set(normTitle(item.titleEn), item.titleZh)
    }
  } catch {
    /* snapshot is optional */
  }
  return map
}

function translate(title, map) {
  if (!title) return ''
  const direct = map.get(normTitle(title))
  if (direct) return direct
  // Tolerate Steam appending a patch tag or date range to the snapshot title.
  const normalized = normTitle(title)
  for (const [key, value] of map) {
    if (key.length >= 12 && normalized.includes(key.slice(0, 40))) return value
  }
  return ''
}

function normaliseUrl(url) {
  const text = oneLine(url ?? '')
  if (!text) return NEWS_HUB_URL
  if (/akamaihd\.net|steamcommunity\.com|steamstatic\.com/i.test(text)) return NEWS_HUB_URL
  return text
}

function rssUrl() {
  return `https://store.steampowered.com/feeds/news/app/${STEAM_APP_ID}/?cc=CN&l=schinese`
}

function cleanBody(contents) {
  return stripMarkup(String(contents ?? ''))
    .replace(/\[img\][^[]*\[\/img\]/gi, ' ')
    .replace(/\{[A-Z_]+\}\/[^\s]+/g, ' ')
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function toSummary(contents, max = 210) {
  const cleaned = cleanBody(contents)
  if (!cleaned) return ''
  return clip(cleaned, max)
}

function fromJson(doc) {
  const items = doc?.appnews?.newsitems
  if (!Array.isArray(items)) return []
  const map = titleTranslationMap()
  return items
    .filter((item) => item && (item.title || item.url))
    .map((item) => {
      const title = oneLine(item.title ?? '')
      return {
        titleEn: title,
        titleZh: translate(title, map),
        date: item.date ? new Date(item.date * 1000).toISOString() : '',
        url: normaliseUrl(item.url),
        summaryZh: toSummary(item.contents),
        source: 'Steam',
        tags: [item.feedlabel ?? item.feedname ?? 'Steam'].filter(Boolean),
      }
    })
}

function xmlTag(block, tag) {
  const match = block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'i'))
  if (!match) return ''
  return oneLine(
    match[1]
      .replace(/^<!\[CDATA\[/, '')
      .replace(/\]\]>$/, '')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&amp;/g, '&')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'"),
  )
}

function fromRss(xml) {
  const blocks = String(xml).match(/<item[\s\S]*?<\/item>/gi) ?? []
  const map = titleTranslationMap()
  return blocks.map((block) => {
    const title = xmlTag(block, 'title')
    const link = xmlTag(block, 'link')
    const pubDate = xmlTag(block, 'pubDate')
    const description = xmlTag(block, 'description')
    return {
      titleEn: title,
      titleZh: translate(title, map),
      date: pubDate ? new Date(pubDate).toISOString() : '',
      url: normaliseUrl(link),
      summaryZh: toSummary(description),
      source: 'Steam RSS',
      tags: ['Steam'],
    }
  })
}

function dedupe(items) {
  const seen = new Set()
  const out = []
  for (const item of items) {
    const key = `${item.url || ''}|${(item.titleZh || item.titleEn || '').slice(0, 40)}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push(item)
  }
  return out
}

/** Snapshot from the bundled data file, used when the network is unavailable. */
export function snapshotNews(limit = 6) {
  const store = getStore()
  return store.news.snapshot.slice(0, limit).map((item) => ({
    titleEn: item.titleEn,
    titleZh: item.titleZh || item.titleEn,
    date: item.date,
    url: item.url,
    summaryZh: item.summaryZh,
    source: item.source,
    tags: item.tags,
  }))
}

/**
 * Fetch the newest official news.
 *
 * `options.fetchText(url, signal)` lets the Host's web service do the retrieval;
 * some environments can reach api.steampowered.com through the Host but not from
 * this process directly (sandboxed networking), so it is tried first.
 * @returns {Promise<{items: Array<object>, live: boolean, error: string, updatedAt: string, via: string}>}
 */
export async function fetchLatestNews(limit = 6, signal, options = {}) {
  const store = getStore()
  const errors = []
  const hostText = typeof options.fetchText === 'function' ? options.fetchText : undefined
  const count = Math.min(12, Math.max(limit, 6))

  if (hostText) {
    try {
      const raw = await hostText(newsApiUrl(count), signal)
      const doc = JSON.parse(raw)
      const items = dedupe(fromJson(doc)).slice(0, limit)
      if (items.length > 0) {
        return { items, live: true, error: '', updatedAt: formatDate(new Date()), via: '宿主 web 服务' }
      }
      errors.push('宿主抓取 Steam 新闻接口返回空列表')
    } catch (error) {
      errors.push(`宿主抓取失败：${error instanceof Error ? error.message : String(error)}`)
    }
    if (signal?.aborted) {
      return { items: snapshotNews(limit), live: false, error: errors.join('；'), updatedAt: store.news.updatedAt, via: 'snapshot' }
    }
  }

  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      const doc = await requestJson(newsApiUrl(count), {
        headers: USER_HEADERS,
        signal,
        timeoutMs: attempt === 1 ? 14000 : 22000,
      })
      const items = dedupe(fromJson(doc)).slice(0, limit)
      if (items.length > 0) {
        return { items, live: true, error: '', updatedAt: formatDate(new Date()), via: 'Node fetch' }
      }
      errors.push('Steam 新闻接口返回空列表')
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error))
    }
    if (signal?.aborted) break
  }

  if (hostText) {
    try {
      const xml = await hostText(rssUrl(), signal)
      const items = dedupe(fromRss(xml)).slice(0, limit)
      if (items.length > 0) {
        return { items, live: true, error: '', updatedAt: formatDate(new Date()), via: '宿主 web 服务（RSS）' }
      }
      errors.push('宿主抓取 Steam RSS 未包含公告条目')
    } catch (error) {
      errors.push(`宿主 RSS 抓取失败：${error instanceof Error ? error.message : String(error)}`)
    }
  }

  try {
    const xml = await requestText(rssUrl(), {
      headers: { ...USER_HEADERS, accept: 'application/rss+xml, application/xml, text/xml;q=0.9, */*;q=0.8' },
      signal,
      timeoutMs: 12000,
    })
    const items = dedupe(fromRss(xml)).slice(0, limit)
    if (items.length > 0) {
      return { items, live: true, error: '', updatedAt: formatDate(new Date()), via: 'Node fetch（RSS）' }
    }
    errors.push('Steam RSS 未包含公告条目')
  } catch (error) {
    errors.push(error instanceof Error ? error.message : String(error))
  }

  return {
    items: snapshotNews(limit),
    live: false,
    error: errors.join('；') || '网络不可用',
    updatedAt: store.news.updatedAt,
    via: 'snapshot',
  }
}
