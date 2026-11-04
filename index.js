/**
 * dsh-plugin-outlast — Cordis plugin entry.
 *
 * 为《逃生：试炼》(The Outlast Trials) 提供 9 个 QQ 场景查询工具：
 * 菜单、全库搜索、关卡列表、单关攻略、敌人图鉴、道具/升级、核心机制、
 * 实时资讯（Steam）、图文卡片（PNG）。
 * @module dsh-plugin-outlast
 */

import { loadDefineTool } from './lib/core.js'
import { createTools } from './lib/tools.js'
import { getStore } from './lib/store.js'

/** Cordis plugin name. */
export const name = 'dsh-plugin-outlast'

/** This plugin only requires the tool registry. */
export const inject = ['tools']

/** Every tool name registered by this plugin, in registration order. */
export const TOOL_NAMES = Object.freeze([
  'outlast_help',
  'outlast_search',
  'outlast_trials',
  'outlast_guide',
  'outlast_enemies',
  'outlast_items',
  'outlast_mechanics',
  'outlast_news',
  'outlast_card',
])

/**
 * Short model-facing hint. Kept to a couple of lines on purpose: it is injected
 * for every agent of this profile, not only QQ sessions.
 */
const SYSTEM_HINT = [
  '《逃生：试炼》(The Outlast Trials) 查询：用户问到该游戏的关卡、攻略、敌人、道具/升级、机制或最新公告时，',
  '先调用 outlast_guide / outlast_enemies / outlast_items / outlast_mechanics / outlast_news / outlast_search',
  '（拿不准分类就用 outlast_search），不要凭记忆编造关卡步骤或版本内容；',
  '用户要「图 / 图文 / 卡片」时用 outlast_card 生成 PNG，成功后调用 qqbot_send_file 发到当前 QQ 会话。',
].join('')

/** Register the optional system-prompt hint without failing plugin startup. */
function registerHint(ctx) {
  try {
    const service =
      typeof ctx.get === 'function' ? ctx.get('systemPrompt') : ctx.systemPrompt
    if (!service || typeof service.section !== 'function') return
    service.section({
      name: 'dsh-plugin-outlast',
      order: 900,
      text: SYSTEM_HINT,
    })
  } catch (error) {
    ctx.logger?.warn?.(`[dsh-plugin-outlast] 注册系统提示失败：${error instanceof Error ? error.message : String(error)}`)
  }
}

/** Cordis entry point: register every Outlast tool on the tool registry. */
export async function apply(ctx) {
  const store = getStore()
  for (const diagnostic of store.diagnostics) {
    ctx.logger?.warn?.(`[dsh-plugin-outlast] ${diagnostic}`)
  }

  const define = await loadDefineTool()
  const web = typeof ctx.get === 'function' ? ctx.get('web') : ctx.web
  for (const tool of createTools(define, { web })) {
    ctx.tools.register(tool)
  }

  registerHint(ctx)
}
