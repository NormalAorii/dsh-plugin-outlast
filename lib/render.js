/**
 * dsh-plugin-outlast / render
 *
 * QQ-friendly text rendering. QQ 官方机器人走 markdown 消息且有长度上限，
 * 所以这里输出纯文本 + 轻量符号：控制在 3500 字以内，长内容给出继续追问的提示。
 * @module dsh-plugin-outlast/render
 */

import { clip, formatDate, oneLine } from './core.js'

export const MAX_LENGTH = 3400
const RULE = '━━━━━━━━━━━━━━━━'

/** Final length guard used by every renderer. */
export function fit(value, budget = MAX_LENGTH, hint = '') {
  const str = String(value ?? '').trim()
  if (str.length <= budget) return str
  const suffix = hint ? `\n\n…${hint}` : '\n\n…（内容较长已截断）'
  return str.slice(0, Math.max(0, budget - suffix.length)) + suffix
}

function joinLines(lines) {
  return lines.filter((line) => line !== undefined && line !== null && String(line).trim() !== '').join('\n')
}

function bullets(items, marker = '•') {
  return items.map((item) => `${marker} ${item}`)
}

function numbered(items) {
  return items.map((item, index) => `${index + 1}. ${item}`)
}

/** 数据里若自带「步骤 3：」前缀，渲染时去掉，避免和自动编号重复。 */
function stripStepPrefix(item) {
  return String(item).replace(/^\s*(?:步骤|Step)\s*\d+\s*[:：.、]\s*/i, '')
}

function stat(label, value) {
  const v = oneLine(value)
  return v ? `${label}${v}` : ''
}

/** 数据可信度备注：低可信度条目主动标注，避免把社区说法当官方设定。 */
function confidenceNote(entry) {
  if (!entry?.confidence || entry.confidence === 'high') return ''
  if (entry.confidence === 'low') return '⚠️ 该条目的部分细节来自社区整理，可能与最新版本有出入。'
  return ''
}

function sourcesNote(entry) {
  const sources = (entry?.sources ?? []).slice(0, 3)
  if (sources.length === 0) return ''
  return `🔗 参考：${sources.join('  ')}`
}

export function renderHelp(store) {
  const counts = store.counts
  const lines = [
    '🎮 逃生：试炼 · 查询助手',
    RULE,
    `📚 当前资料库：${counts.trials} 个关卡（含 MK 挑战 ${counts.mkChallenges}）· ${counts.enemies} 名敌人 · ${counts.items} 条道具/升级 · ${counts.mechanics} 条机制`,
    '',
    '你可以直接用大白话问我，例如：',
    '「警局怎么打」「孤儿院攻略」「Leland Coyle 怎么躲」',
    '「有什么道具」「Rig 怎么选」「最近有什么更新」',
    '',
    '🧭 指令一览',
    '• 帮助｜菜单 —— 看这条说明',
    '• 关卡｜试炼列表 —— 全部关卡与难度',
    '• 攻略 <关卡名> —— 分步通关攻略（可加「步骤」「目标」「技巧」只看某段）',
    '• 敌人｜敌人 <名字> —— 敌人图鉴与应对',
    '• 道具 <关键词> —— 消耗品/Rig/处方/货币',
    '• 机制 —— 核心玩法与生存技巧',
    '• 资讯｜更新 —— 抓取 Steam 官方最新公告（实时）',
    '• 卡片 <主题> —— 生成一张图文攻略卡（PNG）',
    '• 搜索 <关键词> —— 全库模糊搜索',
    '',
    '💡 提示：支持中英文与社区叫法（警局 / Police Station / 法院 / 孤儿院…），说错名字我也会猜最接近的。',
  ]
  return fit(joinLines(lines))
}

export function renderTrialList(trials, { kind = 'all' } = {}) {
  const mainTrials = trials.filter((trial) => trial.kind !== 'mk-challenge')
  const mkChallenges = trials.filter((trial) => trial.kind === 'mk-challenge')
  const lines = ['🎬 逃生：试炼 · 关卡一览', RULE]

  if (kind !== 'mk-challenge' && mainTrials.length > 0) {
    lines.push(`【主线试炼】${mainTrials.length} 个`)
    mainTrials.forEach((trial, index) => {
      const meta = [trial.map, trial.difficulty && `难度 ${trial.difficulty}`, trial.players && `${trial.players} 人`]
        .filter(Boolean)
        .join(' · ')
      lines.push(`${index + 1}. ${trial.nameZh}${trial.nameEn && trial.nameEn !== trial.nameZh ? ` / ${trial.nameEn}` : ''}`)
      if (meta) lines.push(`   ${meta}`)
      if (trial.summary) lines.push(`   ${clip(trial.summary, 70)}`)
    })
    lines.push('')
  }

  if (kind !== 'trial' && mkChallenges.length > 0) {
    lines.push(`【MK 挑战】${mkChallenges.length} 个`)
    mkChallenges.forEach((trial, index) => {
      const meta = [trial.map, trial.difficulty].filter(Boolean).join(' · ')
      lines.push(`${index + 1}. ${trial.nameZh}${trial.nameEn && trial.nameEn !== trial.nameZh ? ` / ${trial.nameEn}` : ''}${meta ? `（${meta}）` : ''}`)
      if (trial.summary) lines.push(`   ${clip(trial.summary, 70)}`)
    })
    lines.push('')
  }

  lines.push('👉 回复「攻略 <关卡名>」看完整通关步骤，例如「攻略 警局」。')
  return fit(joinLines(lines))
}

export function renderGuide(trial, { section = 'all' } = {}) {
  const title = `${trial.nameZh}${trial.nameEn && trial.nameEn !== trial.nameZh ? ` / ${trial.nameEn}` : ''}`
  const lines = [`🎬 逃生：试炼 · 关卡攻略`, RULE, `📍 ${title}`]

  const meta = [
    trial.kind === 'mk-challenge' ? 'MK 挑战' : '主线试炼',
    stat('难度 ', trial.difficulty),
    stat('人数 ', trial.players),
    trial.durationMin ? `约 ${trial.durationMin} 分钟` : '',
    stat('地图 ', trial.map),
  ].filter(Boolean)
  if (meta.length > 0) lines.push(`🏷 ${meta.join(' · ')}`)

  if (trial.summary && section === 'all') lines.push('', `📖 概览：${trial.summary}`)

  if (section === 'all' || section === 'objectives') {
    if (trial.objectives.length > 0) {
      lines.push('', `🎯 目标流程（${trial.objectives.length} 步）`, ...numbered(trial.objectives.map(stripStepPrefix)))
    }
  }

  if (section === 'all' || section === 'walkthrough') {
    if (trial.walkthrough.length > 0) {
      lines.push('', '🧭 通关步骤', ...numbered(trial.walkthrough.map(stripStepPrefix)))
    }
  }

  if (section === 'all' || section === 'tips') {
    if (trial.tips.length > 0) {
      lines.push('', '💡 老手技巧', ...bullets(trial.tips))
    }
  }

  if (section === 'all') {
    if (trial.enemies.length > 0) lines.push('', `👹 主要敌人：${trial.enemies.join('、')}`)
    if (trial.rewards.length > 0) lines.push(`🎁 奖励/解锁：${trial.rewards.join('、')}`)
    const note = confidenceNote(trial)
    if (note) lines.push('', note)
    const sources = sourcesNote(trial)
    if (sources) lines.push(sources)
  }

  const hint = section === 'all' ? '要只看步骤：回复「攻略 ' + trial.nameZh + ' 步骤」' : ''
  return fit(joinLines(lines), MAX_LENGTH, hint)
}

export function renderEnemyList(enemies) {
  const lines = ['👹 逃生：试炼 · 敌人图鉴', RULE, `共收录 ${enemies.length} 名敌人/追猎者`, '']
  for (const enemy of enemies) {
    const tags = [enemy.category === 'main-ex-pop' ? '主要追猎者' : '', enemy.map].filter(Boolean).join(' · ')
    lines.push(`• ${enemy.nameZh}${enemy.nameEn && enemy.nameEn !== enemy.nameZh ? ` / ${enemy.nameEn}` : ''}${tags ? `（${tags}）` : ''}`)
    if (enemy.summary) lines.push(`  ${clip(enemy.summary, 80)}`)
  }
  lines.push('', '👉 回复「敌人 <名字>」看行为模式与反制方法，例如「敌人 鹅妈妈」。')
  return fit(joinLines(lines))
}

export function renderEnemyDetail(enemy) {
  const lines = [
    '👹 逃生：试炼 · 敌人档案',
    RULE,
    `📍 ${enemy.nameZh}${enemy.nameEn && enemy.nameEn !== enemy.nameZh ? ` / ${enemy.nameEn}` : ''}`,
  ]
  const meta = [
    enemy.category === 'main-ex-pop' ? '主要追猎者' : enemy.category === 'special' ? '特殊敌人' : '普通敌人',
    stat('出没 ', enemy.map),
  ].filter(Boolean)
  if (meta.length > 0) lines.push(`🏷 ${meta.join(' · ')}`)
  if (enemy.summary) lines.push('', `📖 ${enemy.summary}`)
  if (enemy.behavior.length > 0) lines.push('', '🏃 行为模式', ...bullets(enemy.behavior))
  if (enemy.detect.length > 0) lines.push('', '👁 感知方式', ...bullets(enemy.detect))
  if (enemy.counters.length > 0) lines.push('', '🛡 应对方法', ...bullets(enemy.counters))
  if (enemy.weakness.length > 0) lines.push('', '🎯 弱点', ...bullets(enemy.weakness))
  if (enemy.lore) lines.push('', `📜 背景：${clip(enemy.lore, 260)}`)
  const note = confidenceNote(enemy)
  if (note) lines.push('', note)
  const sources = sourcesNote(enemy)
  if (sources) lines.push(sources)
  return fit(joinLines(lines))
}

export function renderItemsOverview(categories, store) {
  const lines = ['🎒 逃生：试炼 · 道具与升级', RULE]
  for (const category of categories) {
    lines.push(`【${category.nameZh}】${category.items.length} 条`)
    lines.push(...bullets(category.items.slice(0, 6).map((item) => item.nameZh)))
    if (category.items.length > 6) lines.push(`  …等 ${category.items.length} 条`)
    lines.push('')
  }
  lines.push('👉 回复「道具 <关键词>」看详情，例如「道具 Rig」「道具 处方」。')
  return fit(joinLines(lines))
}

export function renderItemCategory(category) {
  const lines = [`🎒 ${category.nameZh}（${category.items.length} 条）`, RULE]
  for (const item of category.items) {
    lines.push(`• ${item.nameZh}${item.nameEn && item.nameEn !== item.nameZh ? ` / ${item.nameEn}` : ''}`)
    if (item.use) lines.push(`  用途：${clip(item.use, 120)}`)
    if (item.tips.length > 0) lines.push(`  技巧：${clip(item.tips.join('；'), 120)}`)
  }
  lines.push('', '👉 回复「道具 <名字>」看单条详情。')
  return fit(joinLines(lines))
}

export function renderItemDetail(item, category) {
  const lines = [
    `🎒 ${category ? `${category.nameZh} · ` : ''}${item.nameZh}${item.nameEn && item.nameEn !== item.nameZh ? ` / ${item.nameEn}` : ''}`,
    RULE,
  ]
  if (item.use) lines.push(`📖 用途：${item.use}`)
  if (item.howToGet) lines.push(`📦 获取：${item.howToGet}`)
  if (item.tips.length > 0) lines.push('', '💡 使用技巧', ...bullets(item.tips))
  const sources = sourcesNote(item)
  if (sources) lines.push('', sources)
  return fit(joinLines(lines))
}

export function renderMechanics(sections) {
  const lines = ['🧠 逃生：试炼 · 核心机制与生存技巧', RULE]
  for (const section of sections) {
    lines.push(`【${section.nameZh}】`)
    if (section.summary) lines.push(`  ${section.summary}`)
    if (section.points.length > 0) lines.push(...bullets(section.points, '  ·'))
    lines.push('')
  }
  return fit(joinLines(lines))
}

export function renderNews(items, { live = false, updatedAt = '', error = '', via = '' } = {}) {
  const lines = ['📰 逃生：试炼 · 最新资讯', RULE]
  if (live) {
    const tag = via && via !== 'Node fetch' && via !== 'Node fetch（RSS）' ? ` · ${via}` : ''
    lines.push(`🛰 来源：Steam 官方新闻（实时抓取${tag}）`)
  } else {
    lines.push(`📦 来源：本地快照${updatedAt ? `（更新于 ${updatedAt}）` : ''}`)
    if (error) lines.push(`⚠️ 实时抓取失败：${clip(error, 90)}`)
  }
  lines.push('')
  items.forEach((item, index) => {
    const date = formatDate(item.date)
    lines.push(`${index + 1}. ${date ? `【${date}】` : ''}${clip(item.titleZh || item.titleEn || '（无标题）', 90)}`)
    if (item.titleZh && item.titleEn && item.titleZh !== item.titleEn) lines.push(`   原题：${clip(item.titleEn, 80)}`)
    if (item.summaryZh) lines.push(`   ${clip(item.summaryZh, 180)}`)
    if (item.url) lines.push(`   🔗 ${item.url}`)
  })
  if (items.length === 0) lines.push('暂时没有抓到新公告，稍后再试。')
  lines.push('', '👉 回复「资讯」可再次抓取；官方公告多为英文/机翻，摘要已做中文整理。')
  return fit(joinLines(lines), MAX_LENGTH, '完整公告请点链接查看')
}

export function renderSearchResults(results, query) {
  const lines = [`🔎 搜索「${query}」· 命中 ${results.length} 条`, RULE]
  results.forEach((result, index) => {
    const entry = result.entry
    const title = entry.nameZh || entry.titleZh || entry.nameEn || entry.id
    const extra = entry.nameEn && entry.nameEn !== entry.nameZh ? ` / ${entry.nameEn}` : ''
    lines.push(`${index + 1}. [${result.kindZh}] ${title}${extra}`)
    const summary = entry.summary || entry.use || entry.titleEn || ''
    if (summary) lines.push(`   ${clip(summary, 80)}`)
    const hint = kindHint(result.kind, entry)
    if (hint) lines.push(`   ${hint}`)
  })
  lines.push('', '👉 回复「攻略/敌人/道具 + 名字」可看详情。')
  return fit(joinLines(lines))
}

function kindHint(kind, entry) {
  if (kind === 'trial') return `看攻略：攻略 ${entry.nameZh}`
  if (kind === 'program') return '看计划结构：试炼列表（kind=program）'
  if (kind === 'enemy') return `看档案：敌人 ${entry.nameZh}`
  if (kind === 'item') return `看详情：道具 ${entry.nameZh}`
  if (kind === 'mechanic') return '看机制：回复「机制」'
  if (kind === 'news') return entry.url ? `🔗 ${entry.url}` : ''
  return ''
}

export function renderMiss(query, suggestions = []) {
  const lines = [`🤔 没查到「${query}」`, RULE]
  if (suggestions.length > 0) {
    lines.push('你是不是想问：')
    lines.push(...bullets(suggestions.map((item) => item.entry.nameZh || item.entry.titleZh)))
    lines.push('')
  }
  lines.push('可以试试：')
  lines.push('• 「关卡」看全部关卡名')
  lines.push('• 「敌人」看全部敌人')
  lines.push('• 「道具」看道具分类')
  lines.push('• 「帮助」看全部指令')
  return fit(joinLines(lines))
}

export function renderPrograms(programs, trials) {
  const lines = ['🗂 逃生：试炼 · 关卡进度结构', RULE]
  if (programs.length === 0) {
    lines.push('暂无程序（Program）数据。')
  }
  for (const program of programs) {
    lines.push(`【${program.nameZh || program.nameEn}】${program.unlock ? ` ${program.unlock}` : ''}`)
    if (program.desc) lines.push(`  ${program.desc}`)
    lines.push('')
  }
  lines.push(`当前资料库共 ${trials.length} 个关卡。回复「关卡」查看列表。`)
  return fit(joinLines(lines))
}
