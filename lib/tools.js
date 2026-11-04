/**
 * dsh-plugin-outlast / tools
 *
 * 9 个模型可调用工具，面向 QQ 群聊/私聊的中文查询场景：
 * 菜单、搜索、关卡列表、单关攻略、敌人图鉴、道具升级、核心机制、最新资讯、图文卡片。
 * @module dsh-plugin-outlast/tools
 */

import { text, toolError, guardTool, requireString, optionalString, optionalInt } from './core.js'
import { getStore, searchAll, findTrial, findEnemy, findMechanics } from './store.js'
import {
  renderHelp,
  renderTrialList,
  renderGuide,
  renderEnemyList,
  renderEnemyDetail,
  renderItemsOverview,
  renderItemCategory,
  renderItemDetail,
  renderMechanics,
  renderNews,
  renderSearchResults,
  renderMiss,
  renderPrograms,
  fit,
} from './render.js'
import { fetchLatestNews } from './news.js'
import { renderCard } from './cards.js'

const OUTPUT_SCHEMA = {
  type: 'object',
  properties: {
    text: { type: 'string', description: 'Markdown 文本回复，可直接发到 QQ。' },
  },
  required: ['text'],
}

function out(value) {
  return { text: value }
}

function output(render) {
  return {
    schema: OUTPUT_SCHEMA,
    render: (_args, value) => [text(String(value?.text ?? ''))],
  }
}

const QQ_NOTE = '返回内容已按 QQ 消息长度限制精简；若用户接着问细节，再调用本工具取对应片段。'

/** Build every Outlast Trials tool with the supplied defineTool implementation. */
export function createTools(define, options = {}) {
  const web = options.web
  /** Retrieve a URL through the Host web service when it is available. */
  const hostFetchText = typeof web?.fetch === 'function'
    ? async (url, signal) => {
        const result = await web.fetch({ url }, signal)
        const status = Number(result?.statusCode ?? 0)
        if (status && (status < 200 || status >= 300)) {
          throw new Error(`HTTP ${status}`)
        }
        const body = result?.body?.content
        if (typeof body !== 'string' || body.length === 0) throw new Error('空响应')
        return body
      }
    : undefined

  const help = define({
    name: 'outlast_help',
    description:
      '《逃生：试炼》(The Outlast Trials) 查询机器人的总菜单与能力说明。' +
      '当用户在 QQ 里发「帮助」「菜单」「指令」「你能干什么」「怎么用」「/help」或第一次开口问逃生相关问题时调用，' +
      '返回功能清单、可用指令和示例问法。用户只是打招呼或问这个机器人能做什么时也用它。' +
      QQ_NOTE,
    parameters: {},
    output: output(),
    execute: guardTool('outlast_help', async () => out(renderHelp(getStore()))),
  })

  const search = define({
    name: 'outlast_search',
    description:
      '在所有《逃生：试炼》资料（关卡、敌人、道具/装备、机制、资讯）里做中英文模糊搜索。' +
      '当用户给的是模棱两可、不确定属于哪一类的关键词时先调用它，例如「监狱」「鹅妈妈」「注射器」「电击」「那个胖女人」。' +
      '支持中文、英文、社区别名（警局 / Police Station / 法院 / 孤儿院…）。返回命中列表与下一步指令提示。',
    parameters: {
      query: { type: 'string', required: true, description: '用户输入的关键词或名字，中英文均可。' },
      limit: { type: 'integer', description: '最多返回几条，1-15，默认 6。' },
    },
    output: output(),
    execute: guardTool('outlast_search', async (args) => {
      const query = requireString(args, 'query', '搜索关键词')
      const limit = optionalInt(args, 'limit', 6, 1, 15)
      const store = getStore()
      const results = searchAll(query, limit)
      if (results.length === 0) {
        const suggestions = searchAll(query, 3).slice(0, 3)
        void store
        return out(renderMiss(query, suggestions))
      }
      const top = results[0]
      // A keyword that names a whole item category (「Rig」「装具」「处方」) should
      // list that category instead of whichever item happens to contain the word.
      const categoryMatch = matchCategory(store.categories, query)
      if (categoryMatch && (!top || top.score < 900)) {
        return out(fit(renderItemCategory(categoryMatch)))
      }
      const strong = top.score >= 640
      if (strong && results.filter((item) => item.score > top.score * 0.85).length === 1) {
        const detail = detailFor(top)
        if (detail) {
          return out(fit(`🔎 匹配到：${top.kindZh}「${top.entry.nameZh || top.entry.titleZh}」\n\n${detail}`))
        }
      }
      return out(renderSearchResults(results, query))
    }),
  })

  const trials = define({
    name: 'outlast_trials',
    description:
      '列出《逃生：试炼》的全部关卡（主线试炼 Trials + MK 挑战）或关卡进度结构（Program）。' +
      '当用户问「有哪些关卡」「关卡列表」「试炼难度」「MK 挑战有哪些」「这游戏怎么推进」「程序/关卡顺序」时调用，' +
      '可按 kind 过滤，也可用 keyword 过滤某个关卡。返回关卡名、地图、难度、人数、一句话简介。',
    parameters: {
      kind: {
        type: 'string',
        enum: ['all', 'trial', 'mk', 'program'],
        description: 'all=全部（默认），trial=只看主线试炼，mk=只看 MK 挑战，program=关卡进度结构。',
      },
      keyword: { type: 'string', description: '可选，只看名字/描述里包含该关键词的关卡。' },
    },
    output: output(),
    execute: guardTool('outlast_trials', async (args) => {
      const store = getStore()
      const kind = optionalString(args, 'kind') ?? 'all'
      const keyword = optionalString(args, 'keyword')
      if (kind === 'program') return out(renderPrograms(store.programs, store.trials))

      let list = store.trials
      if (keyword) {
        const hits = searchAll(keyword, 20)
          .filter((item) => item.kind === 'trial')
          .map((item) => item.entry)
        list = hits.length > 0 ? hits : list.filter((trial) =>
          [trial.nameZh, trial.nameEn, trial.map, trial.summary].join(' ').includes(keyword))
      }
      if (list.length === 0) return out(renderMiss(keyword ?? '', []))
      return out(renderTrialList(list, { kind }))
    }),
  })

  const guide = define({
    name: 'outlast_guide',
    description:
      '查《逃生：试炼》单个关卡（含 MK 挑战）的通关攻略：目标流程、分步打法、老手技巧、主要敌人与奖励。' +
      '当用户问「XX 怎么打」「XX 攻略」「XX 有什么目标」「XX 卡关了」「XX 怎么过」时调用；' +
      'name 传用户说的关卡名（中英文/别名均可，如「警局」「孤儿院」「游乐园」「法院」「Fun Park」）。' +
      'section=objectives/walkthrough/tips 只返回其中一段，用于用户在 QQ 里追问细节时避免消息过长。' + QQ_NOTE,
    parameters: {
      name: { type: 'string', required: true, description: '关卡名，中英文或社区别名均可。' },
      section: {
        type: 'string',
        enum: ['all', 'objectives', 'walkthrough', 'tips'],
        description: 'all=完整攻略（默认），objectives=只看目标流程，walkthrough=只看分步打法，tips=只看技巧。',
      },
    },
    output: output(),
    execute: guardTool('outlast_guide', async (args) => {
      const name = requireString(args, 'name', '关卡名')
      const section = optionalString(args, 'section') ?? 'all'
      const hit = findTrial(name)
      if (!hit) {
        const suggestions = searchAll(name, 4)
        return out(renderMiss(name, suggestions))
      }
      return out(renderGuide(hit.entry, { section }))
    }),
  })

  const enemies = define({
    name: 'outlast_enemies',
    description:
      '查《逃生：试炼》敌人图鉴：不传 name 返回全部敌人列表；传 name 返回单个敌人的行为模式、感知方式、应对方法与弱点。' +
      '当用户问「有哪些敌人」「XX 怎么躲」「XX 怎么打」「追我的那个是谁」「鹅妈妈/Leland/警察 是谁」时调用。' + QQ_NOTE,
    parameters: {
      name: { type: 'string', description: '可选，敌人名字（中英文/绰号），不传则列出全部敌人。' },
    },
    output: output(),
    execute: guardTool('outlast_enemies', async (args) => {
      const store = getStore()
      const name = optionalString(args, 'name')
      if (!name) {
        if (store.enemies.length === 0) return out('敌人资料库还是空的，稍后再试。')
        return out(renderEnemyList(store.enemies))
      }
      const hit = findEnemy(name)
      if (!hit) return out(renderMiss(name, searchAll(name, 4)))
      return out(renderEnemyDetail(hit.entry))
    }),
  })

  const items = define({
    name: 'outlast_items',
    description:
      '查《逃生：试炼》道具与成长系统：消耗品（医疗、投掷物、电池…）、Rig 装备、处方/永久升级(Amps)、货币与进度。' +
      '当用户问「有什么道具」「Rig 选什么」「处方怎么点」「道具怎么用」「绷带/电池/瓶子在哪」「升级优先点什么」时调用。' +
      '不传参数返回分类总览；category 传分类名（消耗品/Rig/处方/货币…），name 传具体道具名。' + QQ_NOTE,
    parameters: {
      category: { type: 'string', description: '可选，分类关键词，如「消耗品」「Rig」「处方」「货币」。' },
      name: { type: 'string', description: '可选，具体道具名，中英文均可。' },
    },
    output: output(),
    execute: guardTool('outlast_items', async (args) => {
      const store = getStore()
      const name = optionalString(args, 'name')
      const category = optionalString(args, 'category')

      if (store.categories.length === 0) return out('道具资料库还是空的，稍后再试。')

      if (name) {
        const hits = searchAll(name, 10).filter((item) => item.kind === 'item')
        if (hits.length === 0) return out(renderMiss(name, searchAll(name, 4)))
        const best = hits[0]
        return out(renderItemDetail(best.entry, best.category))
      }

      if (category) {
        const matched = matchCategory(store.categories, category)
        if (matched) return out(renderItemCategory(matched))
        const hits = searchAll(category, 10).filter((item) => item.kind === 'item')
        if (hits.length > 0) {
          const byCategory = new Map()
          for (const hit of hits) {
            if (!hit.category) continue
            if (!byCategory.has(hit.category.id)) byCategory.set(hit.category.id, hit.category)
          }
          const only = [...byCategory.values()]
          if (only.length === 1) return out(renderItemCategory(only[0]))
          return out(renderItemDetail(hits[0].entry, hits[0].category))
        }
        return out(renderMiss(category, searchAll(category, 4)))
      }

      return out(renderItemsOverview(store.categories, store))
    }),
  })

  const mechanics = define({
    name: 'outlast_mechanics',
    description:
      '查《逃生：试炼》核心玩法与生存机制：体力/奔跑、躲藏点、噪音与感知、门板与陷阱、队友救援、评分与证据、难度规则等。' +
      '当用户问「怎么玩」「新手怎么上手」「怎么躲」「怎么不被发现」「机制是什么」「有什么技巧」时调用；' +
      'topic 可选，用关键词过滤某一机制。' + QQ_NOTE,
    parameters: {
      topic: { type: 'string', description: '可选关键词，如「噪音」「躲藏」「体力」「救援」「评分」「难度」。' },
    },
    output: output(),
    execute: guardTool('outlast_mechanics', async (args) => {
      const store = getStore()
      const topic = optionalString(args, 'topic')
      if (store.mechanics.length === 0) return out('机制资料库还是空的，稍后再试。')
      const sections = findMechanics(topic)
      if (sections.length === 0) return out(renderMiss(topic ?? '', []))
      return out(renderMechanics(sections))
    }),
  })

  const news = define({
    name: 'outlast_news',
    description:
      '实时抓取《逃生：试炼》Steam 官方最新公告（更新日志、活动、联动、DLC、平衡调整），失败时回退本地快照。' +
      '当用户问「最近有什么更新」「最新资讯」「新活动」「版本更新了什么」「有没有新内容」时调用。' +
      '输出带日期、中文摘要与原文链接；抓不到时会说明原因，不要自己编新闻。',
    parameters: {
      limit: { type: 'integer', description: '返回条数，1-10，默认 5。' },
    },
    output: output(),
    execute: guardTool('outlast_news', async (args, ctx) => {
      const limit = optionalInt(args, 'limit', 5, 1, 10)
      const result = await fetchLatestNews(limit, ctx?.signal, { fetchText: hostFetchText })
      return out(renderNews(result.items, result))
    }),
  })

  const card = define({
    name: 'outlast_card',
    description:
      '把攻略/敌人/资讯内容渲染成一张 1080 宽的深色图文卡片（PNG），适合在 QQ 群里发图而不是刷屏长文。' +
      '当用户说「来张图」「图文攻略」「做成图片」「卡片」时调用。' +
      'kind 选择内容类型：guide=关卡攻略（name 传关卡名），enemy=敌人档案（name 传敌人名），news=最新资讯，menu=功能菜单。' +
      '注意：调用成功后必须紧接着调用 qqbot_send_file 把返回的 PNG 路径发到当前 QQ 会话；如果本机无法渲染，会明确报错，此时改用文字回复。',
    parameters: {
      kind: {
        type: 'string',
        enum: ['guide', 'enemy', 'news', 'menu'],
        description: '卡片类型：guide / enemy / news / menu。',
      },
      name: { type: 'string', description: 'kind=guide 或 enemy 时的关卡/敌人名。' },
    },
    output: output(),
    execute: guardTool('outlast_card', async (args, ctx) => {
      const kind = optionalString(args, 'kind') ?? 'guide'
      const name = optionalString(args, 'name')
      const store = getStore()

      if (kind === 'guide') {
        if (!name) throw new Error('生成关卡图文卡需要 name（关卡名）')
        const hit = findTrial(name)
        if (!hit) throw new Error(`没有找到关卡「${name}」，请先用 outlast_trials 确认关卡名`)
        const trial = hit.entry
        const result = await renderCard(
          {
            badge: '关卡攻略 · TRIAL GUIDE',
            title: `${trial.nameZh}${trial.nameEn && trial.nameEn !== trial.nameZh ? ` / ${trial.nameEn}` : ''}`,
            subtitle: [
              trial.kind === 'mk-challenge' ? 'MK 挑战' : '主线试炼',
              trial.difficulty && `难度 ${trial.difficulty}`,
              trial.players && `${trial.players} 人`,
              trial.map,
            ].filter(Boolean).join(' · '),
            sections: [
              { heading: '目标流程', lines: trial.objectives.slice(0, 6).map((line) => `- ${line}`) },
              { heading: '通关步骤', lines: trial.walkthrough.slice(0, 7).map((line) => `- ${line}`) },
              { heading: '老手技巧', lines: trial.tips.slice(0, 4).map((line) => `- ${line}`) },
            ].filter((section) => section.lines.length > 0),
            footer: '数据来源：The Outlast Trials 官方公告与社区攻略整理 · 由逃生试炼查询助手生成',
          },
          { signal: ctx?.signal, withBanner: true },
        )
        return out(
          `🖼 已生成《${trial.nameZh}》图文攻略卡（${result.width}×${result.height}，${Math.round(result.bytes / 1024)} KB）\n` +
            `本地路径：${result.path}\n` +
            `请立刻调用 qqbot_send_file 把这个文件发到当前 QQ 会话，再补一句「还想看哪关的图？」。`,
        )
      }

      if (kind === 'enemy') {
        if (!name) throw new Error('生成敌人图文卡需要 name（敌人名）')
        const hit = findEnemy(name)
        if (!hit) throw new Error(`没有找到敌人「${name}」，请先用 outlast_enemies 确认名字`)
        const enemy = hit.entry
        const result = await renderCard(
          {
            badge: '敌人档案 · EX-POP FILE',
            title: enemy.nameZh,
            subtitle: [enemy.nameEn, enemy.map].filter(Boolean).join(' · '),
            sections: [
              { heading: '定位', lines: enemy.summary ? [enemy.summary] : [] },
              { heading: '行为模式', lines: enemy.behavior.slice(0, 5).map((line) => `- ${line}`) },
              { heading: '应对方法', lines: enemy.counters.slice(0, 5).map((line) => `- ${line}`) },
            ].filter((section) => section.lines.length > 0),
            footer: 'Murkoff 档案 · 由逃生试炼查询助手整理',
          },
          { signal: ctx?.signal, withBanner: true },
        )
        return out(
          `🖼 已生成《${enemy.nameZh}》敌人档案卡（${result.width}×${result.height}）\n` +
            `本地路径：${result.path}\n请立刻调用 qqbot_send_file 发送到当前 QQ 会话。`,
        )
      }

      if (kind === 'news') {
        const result = await fetchLatestNews(4, ctx?.signal)
        const cardResult = await renderCard(
          {
            badge: '最新资讯 · LATEST NEWS',
            title: '逃生：试炼 · 最新公告',
            subtitle: result.live ? 'Steam 官方新闻（实时）' : `本地快照 · ${result.updatedAt}`,
            sections: [
              {
                heading: '',
                lines: result.items.map((item) => `- ${item.titleZh}（${item.date.slice(0, 10)}）${item.summaryZh ? `：${item.summaryZh}` : ''}`),
              },
            ],
            footer: result.live ? '来源：Steam 新闻 · 由逃生试炼查询助手生成' : `实时抓取失败：${result.error}`,
          },
          { signal: ctx?.signal, withBanner: true },
        )
        return out(
          `🖼 已生成最新资讯卡（${cardResult.width}×${cardResult.height}）\n` +
            `本地路径：${cardResult.path}\n请立刻调用 qqbot_send_file 发送到当前 QQ 会话。`,
        )
      }

      // menu
      const counts = store.counts
      const cardResult = await renderCard(
        {
          badge: '查询助手 · COMMANDS',
          title: '逃生：试炼 查询助手',
          subtitle: '像聊天一样问我，也可以用下面的指令',
          sections: [
            {
              heading: '指令',
              lines: [
                '- 关卡 / 试炼列表：全部关卡与难度',
                '- 攻略 <关卡名>：分步通关攻略',
                '- 敌人 <名字>：图鉴、行为与应对',
                '- 道具 <关键词>：消耗品/Rig/处方/货币',
                '- 机制：核心玩法与生存技巧',
                '- 资讯：Steam 最新公告（实时）',
                '- 卡片 <主题>：生成这样的图文卡',
                '- 搜索 <关键词>：全库模糊搜索',
              ],
            },
            {
              heading: '示例',
              lines: [
                '- 警局怎么打',
                '- 鹅妈妈怎么躲',
                '- Rig 怎么选',
                '- 最近有什么更新',
              ],
            },
          ],
          footer: `资料库：${counts.trials} 关卡 · ${counts.enemies} 敌人 · ${counts.items} 条目 · ${counts.mechanics} 机制`,
        },
        { signal: ctx?.signal, withBanner: true },
      )
      return out(
        `🖼 已生成功能菜单卡（${cardResult.width}×${cardResult.height}）\n` +
          `本地路径：${cardResult.path}\n请立刻调用 qqbot_send_file 发送到当前 QQ 会话。`,
      )
    }),
  })

  return [help, search, trials, guide, enemies, items, mechanics, news, card]
}

/** Player-facing names for the item categories bundled in data/items.json. */
const CATEGORY_ALIASES = {
  consumables: ['消耗品', '道具', '用品', '药', '药水', '医疗', '电池', '投掷物', 'item', 'items', 'consumable'],
  rigs: ['装具', '装备', '技能', 'rig', 'rigs'],
  amps: ['处方', '强化剂', '永久升级', '升级', 'amp', 'amps', 'prescription', 'prescriptions'],
  currency: ['货币', '代币', '钱', '金币', '经验', '进度', 'currency', 'tokens'],
  mechanics: ['机制', '操作', '基础操作', 'mechanic', 'mechanics', 'controls'],
}

/** Resolve a loose category keyword (「装具」「Rig」「处方」) to one items.json category. */
function matchCategory(categories, category) {
  const query = String(category ?? '').toLowerCase().trim()
  if (!query) return undefined
  const compact = query.replace(/[\s()（）·\-_/]/g, '')
  let best
  let bestScore = 0
  for (const entry of categories) {
    const id = String(entry.id ?? '').toLowerCase()
    const nameZh = String(entry.nameZh ?? '')
    const nameKey = nameZh.replace(/[\s()（）·\-_/]/g, '').toLowerCase()
    const aliases = CATEGORY_ALIASES[id] ?? []
    let score = 0
    if (id === query || nameKey === compact) score = 100
    else if (id.includes(query) || query.includes(id)) score = Math.max(score, 70)
    else if (nameKey.includes(compact) || compact.includes(nameKey)) score = Math.max(score, 60)
    for (const alias of aliases) {
      const a = alias.toLowerCase()
      if (compact === a) score = Math.max(score, 90)
      else if (compact.includes(a) || a.includes(compact)) score = Math.max(score, 50)
    }
    if (score > bestScore) {
      best = entry
      bestScore = score
    }
  }
  return bestScore >= 50 ? best : undefined
}

/** Compact detail used when a search hit is unambiguous. */
function detailFor(result) {  if (result.kind === 'trial') return renderGuide(result.entry, { section: 'all' })
  if (result.kind === 'enemy') return renderEnemyDetail(result.entry)
  if (result.kind === 'item') return renderItemDetail(result.entry, result.category)
  if (result.kind === 'mechanic') return renderMechanics([result.entry])
  if (result.kind === 'news') {
    return `📰 ${result.entry.titleZh}\n${result.entry.summaryZh}\n🔗 ${result.entry.url}`
  }
  return ''
}
