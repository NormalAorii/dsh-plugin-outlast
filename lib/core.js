/**
 * dsh-plugin-outlast / core
 *
 * Tool-definition adapter (real `@deepseek-ai/dsh-tools` when resolvable,
 * compatible JSON-Schema fallback otherwise), HTTP helpers and text utilities.
 * No runtime dependencies.
 * @module dsh-plugin-outlast/core
 */

/** One model-facing text content block. */
export function text(value) {
  return { type: 'text', text: value }
}

/** Prefix any thrown value with the tool name exactly once. */
export function toolError(name, error) {
  const message = error instanceof Error ? error.message : String(error)
  if (message.startsWith(`${name}:`)) return error instanceof Error ? error : new Error(message)
  return new Error(`${name}: ${message}`)
}

/** Compile one value-schema node to the enforced raw JSON Schema subset. */
export function compileValue(spec) {
  if (!spec || typeof spec !== 'object') return {}
  if (Array.isArray(spec.oneOf)) {
    return { oneOf: spec.oneOf.map((branch) => compileValue(branch)), ...annotations(spec) }
  }
  const type = spec.type
  if (!type || type === 'json') return { ...annotations(spec) }
  if (type === 'object') {
    const properties = {}
    for (const [key, child] of Object.entries(spec.properties ?? {})) {
      properties[key] = compileValue(child)
    }
    const required = Array.isArray(spec.required) ? [...spec.required] : []
    return {
      type: 'object',
      properties,
      ...(required.length > 0 ? { required } : {}),
      additionalProperties: spec.additionalProperties ?? false,
      ...annotations(spec),
    }
  }
  if (type === 'array') {
    return {
      type: 'array',
      ...(spec.items ? { items: compileValue(spec.items) } : {}),
      ...annotations(spec),
    }
  }
  return {
    type,
    ...(Array.isArray(spec.enum) ? { enum: spec.enum } : {}),
    ...(spec.const !== undefined ? { const: spec.const } : {}),
    ...annotations(spec),
  }
}

function annotations(spec) {
  const result = {}
  if (spec.description) result.description = spec.description
  if (spec.title) result.title = spec.title
  if (spec.default !== undefined) result.default = spec.default
  return result
}

/**
 * Project one author value-schema node onto the `@deepseek-ai/dsh-tools`
 * value-schema DSL, which expresses object requiredness as per-property
 * `required: true` instead of an object-level `required` array.
 */
export function toDshToolsValueSpec(spec) {
  if (!spec || typeof spec !== 'object') return { type: 'json' }
  if (Array.isArray(spec.oneOf)) {
    return { oneOf: spec.oneOf.map((branch) => toDshToolsValueSpec(branch)), ...annotations(spec) }
  }
  const type = spec.type
  if (!type) return { type: 'json', ...annotations(spec) }
  if (type === 'object') {
    const required = new Set(Array.isArray(spec.required) ? spec.required : [])
    const properties = {}
    for (const [key, child] of Object.entries(spec.properties ?? {})) {
      const projected = toDshToolsValueSpec(child)
      if (required.has(key)) projected.required = true
      properties[key] = projected
    }
    return {
      type: 'object',
      properties,
      additionalProperties: spec.additionalProperties ?? false,
      ...annotations(spec),
    }
  }
  if (type === 'array') {
    return {
      type: 'array',
      ...(spec.items ? { items: toDshToolsValueSpec(spec.items) } : {}),
      ...annotations(spec),
    }
  }
  if (type === 'json') return { type: 'json', ...annotations(spec) }
  return {
    type,
    ...(Array.isArray(spec.enum) ? { enum: spec.enum } : {}),
    ...(spec.const !== undefined ? { const: spec.const } : {}),
    ...annotations(spec),
  }
}

/** Compile the compact parameter map into one closed object root. */
export function compileParameters(parameters) {
  const properties = {}
  const required = []
  for (const [key, spec] of Object.entries(parameters)) {
    properties[key] = compileValue(spec)
    if (spec.required === true) required.push(key)
  }
  return { type: 'object', properties, required, additionalProperties: false }
}

/** Build a `defineTool`-compatible factory for hosts without dsh-tools. */
export function createFallbackDefineTool() {
  return (spec) => ({
    name: spec.name,
    description: spec.description,
    parameters: compileParameters(spec.parameters),
    output: {
      schema: compileValue(spec.output.schema),
      render: spec.output.render,
    },
    ...(spec.timeoutMs !== undefined ? { timeoutMs: spec.timeoutMs } : {}),
    execute: spec.execute,
  })
}

/** Resolve `defineTool` from the host profile, or use the compatible fallback. */
export async function loadDefineTool() {
  try {
    const mod = await import('@deepseek-ai/dsh-tools')
    const defineTool = mod?.defineTool
    if (typeof defineTool === 'function') {
      return (spec) =>
        defineTool({
          ...spec,
          output: {
            ...spec.output,
            schema: toDshToolsValueSpec(spec.output.schema),
          },
        })
    }
  } catch {
    // Host does not expose dsh-tools to plugin resolution: raw JSON Schema.
  }
  return createFallbackDefineTool()
}

/** Wrap one tool body so every thrown error carries the exact tool name once. */
export function guardTool(name, body) {
  return async (args, ctx) => {
    try {
      return await body(args ?? {}, ctx)
    } catch (error) {
      throw toolError(name, error)
    }
  }
}

/** Read one required string argument. */
export function requireString(args, key, label) {
  const value = args?.[key]
  const trimmed = typeof value === 'string' ? value.trim() : ''
  if (trimmed.length === 0) throw new Error(`${label}不能为空`)
  return trimmed
}

/** Read one optional string argument. */
export function optionalString(args, key) {
  const value = args?.[key]
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : undefined
}

/** Read one optional positive integer argument. */
export function optionalInt(args, key, fallback, min, max) {
  const raw = args?.[key]
  const num = typeof raw === 'number' ? raw : Number.parseInt(String(raw ?? ''), 10)
  if (!Number.isFinite(num)) return fallback
  return Math.min(max ?? Number.MAX_SAFE_INTEGER, Math.max(min ?? 0, Math.trunc(num)))
}

const DEFAULT_TIMEOUT_MS = 12000
const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36 dsh-plugin-outlast'

/**
 * Perform one HTTP request with timeout, UA and unified error messages.
 * @param {string} url
 * @param {{headers?: Record<string,string>, timeoutMs?: number, signal?: AbortSignal, method?: string, body?: string}} [options]
 */
export async function request(url, options = {}) {
  const timeout = AbortSignal.timeout(options.timeoutMs ?? DEFAULT_TIMEOUT_MS)
  const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout
  let response
  try {
    response = await fetch(url, {
      method: options.method ?? 'GET',
      headers: {
        'user-agent': USER_AGENT,
        accept: 'application/json, text/html;q=0.9, */*;q=0.8',
        ...(options.headers ?? {}),
      },
      body: options.body,
      signal,
    })
  } catch (error) {
    if (options.signal?.aborted) throw new Error('请求已取消')
    const name = error instanceof Error ? error.name : ''
    if (name === 'TimeoutError') throw new Error('请求超时（外部接口响应过慢）')
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(`网络请求失败：${message}`)
  }
  if (!response.ok) {
    const detail = await response.text().catch(() => '')
    const cleaned = detail.replace(/\s+/g, ' ').trim().slice(0, 160)
    throw new Error(`HTTP ${response.status}${cleaned ? `：${cleaned}` : ''}`)
  }
  return response
}

/** Fetch and parse one JSON document. */
export async function requestJson(url, options = {}) {
  const response = await request(url, {
    ...options,
    headers: { accept: 'application/json', ...(options.headers ?? {}) },
  })
  const body = await response.text()
  try {
    return JSON.parse(body)
  } catch {
    throw new Error('外部接口返回的不是有效 JSON')
  }
}

/** Fetch one text document (HTML/XML/RSS). */
export async function requestText(url, options = {}) {
  const response = await request(url, options)
  return response.text()
}

/** Truncate a string to `max` characters, appending an ellipsis hint. */
export function clip(value, max) {
  const str = String(value ?? '')
  if (str.length <= max) return str
  return `${str.slice(0, Math.max(0, max - 1))}…`
}

/** Collapse whitespace runs (including newlines) into single spaces. */
export function oneLine(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim()
}

/** Format an ISO/epoch date as `YYYY-MM-DD` (Asia/Shanghai). */
export function formatDate(value) {
  if (value === undefined || value === null || value === '') return ''
  const date = typeof value === 'number' ? new Date(value * 1000) : new Date(value)
  if (Number.isNaN(date.getTime())) return oneLine(value)
  const parts = new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date)
  const pick = (type) => parts.find((part) => part.type === type)?.value ?? ''
  return `${pick('year')}-${pick('month')}-${pick('day')}`
}

/** Strip BBCode / HTML tags commonly present in Steam news bodies. */
export function stripMarkup(value) {
  return String(value ?? '')
    .replace(/\[\/?[a-z0-9*][^\]]*\]/gi, ' ')
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim()
}
