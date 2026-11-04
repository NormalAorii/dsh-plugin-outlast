/**
 * dsh-plugin-outlast / self check
 *
 * 不需要 DSH 宿主：直接加载插件内部的工具实现并逐个调用，
 * 检查数据完整性、工具输出长度、图文卡片渲染与资讯抓取。
 *   node scripts/verify.js
 */

import { createFallbackDefineTool } from '../lib/core.js'
import { createTools } from '../lib/tools.js'
import { getStore } from '../lib/store.js'

const define = createFallbackDefineTool()
const tools = createTools(define)
const byName = new Map(tools.map((tool) => [tool.name, tool]))

let failures = 0
let checks = 0

function ok(label, condition, detail = '') {
  checks += 1
  if (condition) {
    console.log(`  ✓ ${label}${detail ? ` — ${detail}` : ''}`)
  } else {
    failures += 1
    console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`)
  }
}

async function call(name, args = {}) {
  const tool = byName.get(name)
  if (!tool) throw new Error(`未注册工具 ${name}`)
  const controller = new AbortController()
  const value = await tool.execute(args, { signal: controller.signal })
  const blocks = tool.output.render(args, value)
  return blocks.map((block) => block.text).join('\n')
}

const store = getStore()

console.log('\n== 数据 ==')
ok('trials 载入', store.trials.length > 0, `${store.trials.length} 个（MK ${store.counts.mkChallenges}）`)
ok('enemies 载入', store.enemies.length > 0, `${store.enemies.length} 名`)
ok('items 载入', store.counts.items > 0, `${store.counts.items} 条 / ${store.categories.length} 类`)
ok('mechanics 载入', store.counts.mechanics > 0, `${store.counts.mechanics} 条`)
ok('news 快照载入', store.news.snapshot.length > 0, `${store.news.snapshot.length} 条`)
ok('没有解析错误', store.diagnostics.length === 0, store.diagnostics.join('；'))
ok('所有条目有中文名', [...store.trials, ...store.enemies].every((entry) => entry.nameZh), '')
const sourced = [...store.trials, ...store.enemies].filter((entry) => entry.sources.length > 0).length
ok('条目带来源链接', sourced > 0, `${sourced}/${store.trials.length + store.enemies.length}`)

console.log('\n== 工具 ==')
ok('工具数量 = 9', tools.length === 9, tools.map((tool) => tool.name).join(', '))
for (const tool of tools) {
  ok(`${tool.name} 描述非空`, typeof tool.description === 'string' && tool.description.length > 20, '')
  ok(`${tool.name} 参数 schema 合法`, tool.parameters?.type === 'object' && !!tool.parameters.properties, '')
}

const samples = [
  ['outlast_help', {}],
  ['outlast_search', { query: '警局' }],
  ['outlast_trials', {}],
  ['outlast_trials', { kind: 'mk' }],
  ['outlast_guide', { name: store.trials[0]?.nameZh ?? '警局' }],
  ['outlast_enemies', {}],
  ['outlast_items', {}],
  ['outlast_mechanics', {}],
]

console.log('\n== 输出 ==')
for (const [name, args] of samples) {
  try {
    const reply = await call(name, args)
    ok(`${name} ${JSON.stringify(args)}`, reply.length > 20, `${reply.length} 字`)
    if (reply.length > 3400) {
      failures += 1
      checks += 1
      console.log(`  ✗ ${name} 超出 QQ 长度限制：${reply.length} 字`)
    }
    const preview = reply.split('\n').slice(0, 3).join(' / ')
    console.log(`    ↳ ${preview.slice(0, 110)}`)
  } catch (error) {
    failures += 1
    checks += 1
    console.log(`  ✗ ${name} 抛错：${error instanceof Error ? error.message : String(error)}`)
  }
}

console.log('\n== 模糊匹配 ==')
const FUZZY = [
  ['警局', '杀死告密者'],
  ['法院', '法院'],
  ['孤儿院', '孤儿'],
  ['游乐园', '游乐园'],
  ['码头', '在药物中下毒'],
  ['鹅妈妈', '鹅莓妈妈'],
  ['Rig', '装具'],
  ['注射器', '注射器'],
  ['电击', '电击'],
]
for (const [query, expected] of FUZZY) {
  try {
    const reply = await call('outlast_search', { query })
    ok(`搜索「${query}」命中${expected}`, reply.includes(expected), reply.split('\n')[0])
  } catch (error) {
    failures += 1
    checks += 1
    console.log(`  ✗ 搜索「${query}」抛错：${error instanceof Error ? error.message : String(error)}`)
  }
}

console.log('\n== 实时资讯 ==')
try {
  const reply = await call('outlast_news', { limit: 5 })
  ok('outlast_news 返回内容', reply.length > 30, `${reply.length} 字`)
  const head = reply.split('\n').slice(0, 4).join(' / ')
  console.log(`    ↳ ${head.slice(0, 160)}`)
} catch (error) {
  failures += 1
  checks += 1
  console.log(`  ✗ outlast_news 抛错：${error instanceof Error ? error.message : String(error)}`)
}

console.log('\n== 图文卡片 ==')
try {
  const trial = store.trials.find((entry) => entry.kind !== 'mk-challenge') ?? store.trials[0]
  const reply = await call('outlast_card', { kind: 'guide', name: trial?.nameZh })
  const match = reply.match(/本地路径：(.+\.png)/)
  ok('outlast_card 生成 PNG', /已生成/.test(reply) && !!match, match?.[1] ?? reply.slice(0, 120))
} catch (error) {
  failures += 1
  checks += 1
  console.log(`  ✗ outlast_card 抛错：${error instanceof Error ? error.message : String(error)}`)
}

console.log(`\n结果：${checks - failures}/${checks} 通过${failures ? `，${failures} 项失败` : ''}`)
process.exitCode = failures === 0 ? 0 : 1
