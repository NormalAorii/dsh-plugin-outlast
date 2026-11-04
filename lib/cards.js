/**
 * dsh-plugin-outlast / cards
 *
 * 生成图文攻略卡（PNG）：Node 侧负责排版（CJK 感知换行、配色、分区），
 * 再用 Windows PowerShell + System.Drawing 把绘制指令落成图片。
 * 图片路径返回给模型，由 qqbot_send_file 发到 QQ。
 * @module dsh-plugin-outlast/cards
 */

import { mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync, statSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'

/**
 * Read the PowerShell error log, if any. The sandbox forbids piped child
 * processes, so stderr is redirected into a side file instead of captured.
 */
function readLog(file) {
  try {
    const text = readFileSync(file, 'utf8').trim()
    return text.slice(0, 400)
  } catch {
    return ''
  }
}

const WIDTH = 1080
const PAD = 68
const CONTENT_WIDTH = WIDTH - PAD * 2
const BG = '#0b0b0d'
const ACCENT = '#c1121f'
const TEXT = '#f2f3f5'
const DIM = '#9ba1a8'
const SOFT = '#d8dbe0'

const FONT_REGULAR = 30
const FONT_SMALL = 24
const FONT_HEADING = 34
const FONT_TITLE = 56
const FONT_SUBTITLE = 30
const FONT_BADGE = 24
const FONT_FOOTER = 21

/** Rough advance width of one character for the YaHei UI family. */
function charWidth(ch, size) {
  const code = ch.codePointAt(0) ?? 0
  if (code === 9) return size * 1.6
  if (code < 0x80) {
    if (ch === ' ') return size * 0.32
    if (/[ilj.,:;'!|]/.test(ch)) return size * 0.34
    if (/[A-Z0-9]/.test(ch)) return size * 0.65
    return size * 0.56
  }
  if (/[\u3000-\u303f\uff00-\uffef\u2014\u2026]/.test(ch)) return size * 0.95
  return size * 1.0
}

function measure(text, size) {
  let width = 0
  for (const ch of String(text)) width += charWidth(ch, size)
  return width
}

/** Wrap one paragraph to the content width, preferring latin word boundaries. */
function wrap(text, size, maxWidth = CONTENT_WIDTH) {
  const lines = []
  for (const paragraph of String(text ?? '').split('\n')) {
    const source = paragraph.trim()
    if (!source) {
      lines.push('')
      continue
    }
    let line = ''
    let lineWidth = 0
    let lastBreak = -1
    for (const ch of source) {
      const w = charWidth(ch, size)
      if (lineWidth + w > maxWidth && line.length > 0) {
        if (lastBreak > 0 && line.length - lastBreak > 2 && /[A-Za-z0-9]/.test(line[lastBreak] ?? '')) {
          const head = line.slice(0, lastBreak).trimEnd()
          const tail = line.slice(lastBreak + 1).trimStart()
          lines.push(head)
          line = tail
          lineWidth = measure(line, size)
        } else {
          lines.push(line)
          line = ''
          lineWidth = 0
        }
        lastBreak = -1
      }
      if (/\s/.test(ch)) lastBreak = line.length
      line += ch
      lineWidth += w
    }
    if (line.trim()) lines.push(line.trimEnd())
  }
  return lines
}

function hexAlpha(hex) {
  return hex
}

/**
 * Build the draw-op list plus canvas height for one card.
 * @param {{badge?: string, title: string, subtitle?: string, sections?: Array<{heading?: string, lines?: string[]}>, footer?: string, banner?: string}} card
 */
export function buildCardOps(card) {
  /** @type {Array<Record<string, unknown>>} */
  const ops = []
  let y = 0

  if (card.banner) {
    ops.push({ type: 'image', path: card.banner, x: 0, y: 0, w: WIDTH, h: 250, srcX: 0, srcY: 0, srcW: 460, srcH: 215 })
    ops.push({ type: 'rect', x: 0, y: 0, w: WIDTH, h: 250, color: '#00000066' })
    ops.push({ type: 'rect', x: 0, y: 246, w: WIDTH, h: 4, color: ACCENT })
    y = 300
  } else {
    ops.push({ type: 'rect', x: 0, y: 0, w: WIDTH, h: 10, color: ACCENT })
    y = 74
  }

  if (card.badge) {
    ops.push({ type: 'text', x: PAD, y, size: FONT_BADGE, bold: true, color: ACCENT, text: card.badge.toUpperCase() })
    y += FONT_BADGE + 18
  }

  const titleLines = wrap(card.title, FONT_TITLE)
  for (const line of titleLines) {
    ops.push({ type: 'text', x: PAD, y, size: FONT_TITLE, bold: true, color: TEXT, text: line })
    y += FONT_TITLE + 18
  }
  y += 6

  if (card.subtitle) {
    for (const line of wrap(card.subtitle, FONT_SUBTITLE)) {
      ops.push({ type: 'text', x: PAD, y, size: FONT_SUBTITLE, bold: false, color: DIM, text: line })
      y += FONT_SUBTITLE + 14
    }
  }

  y += 18
  ops.push({ type: 'rect', x: PAD, y, w: CONTENT_WIDTH, h: 2, color: '#2a2c31' })
  y += 30

  for (const section of card.sections ?? []) {
    if (section.heading) {
      ops.push({ type: 'rect', x: PAD, y: y + 6, w: 8, h: FONT_HEADING + 2, color: ACCENT })
      ops.push({ type: 'text', x: PAD + 24, y, size: FONT_HEADING, bold: true, color: ACCENT, text: section.heading })
      y += FONT_HEADING + 20
    }
    for (const rawLine of section.lines ?? []) {
      const isBullet = /^[-•·]\s+/.test(rawLine)
      const body = isBullet ? rawLine.replace(/^[-•·]\s+/, '') : rawLine
      const size = isBullet ? FONT_REGULAR : FONT_SMALL
      const lines = wrap(body, size)
      lines.forEach((line, index) => {
        if (isBullet && index === 0) {
          ops.push({ type: 'rect', x: PAD + 8, y: y + size * 0.42, w: 9, h: 9, color: ACCENT })
          ops.push({ type: 'text', x: PAD + 32, y, size, bold: false, color: SOFT, text: line })
        } else {
          ops.push({ type: 'text', x: PAD + (isBullet ? 32 : 0), y, size, bold: false, color: isBullet ? SOFT : DIM, text: line })
        }
        y += size + 14
      })
      y += isBullet ? 6 : 4
    }
    y += 22
  }

  if (card.footer) {
    y += 8
    ops.push({ type: 'rect', x: PAD, y, w: CONTENT_WIDTH, h: 1, color: '#2a2c31' })
    y += 24
    for (const line of wrap(card.footer, FONT_FOOTER)) {
      ops.push({ type: 'text', x: PAD, y, size: FONT_FOOTER, bold: false, color: DIM, text: line })
      y += FONT_FOOTER + 8
    }
  }

  const height = Math.max(720, Math.round(y + PAD))
  // Painted first so it never covers the banner or any computed content.
  ops.unshift({ type: 'rect', x: 0, y: 0, w: WIDTH, h: height, color: BG })
  return { width: WIDTH, height, ops, background: hexAlpha(BG) }
}

const PS_SCRIPT = [
  'param([string]$SpecPath, [string]$OutPath)',
  '$ErrorActionPreference = "Stop"',
  '$LogPath = "$OutPath.log"',
  'try {',
  'Add-Type -AssemblyName System.Drawing',
  '$spec = Get-Content -Raw -Encoding UTF8 $SpecPath | ConvertFrom-Json',
  '$w = [int]$spec.width',
  '$h = [int]$spec.height',
  '$bmp = New-Object System.Drawing.Bitmap($w, $h)',
  '$g = [System.Drawing.Graphics]::FromImage($bmp)',
  '$g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias',
  '$g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit',
  '$g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic',
  '$families = @((New-Object System.Drawing.Text.InstalledFontCollection).Families | ForEach-Object { $_.Name })',
  '$family = "Microsoft YaHei UI"',
  'if ($families -notcontains $family) { if ($families -contains "Microsoft YaHei") { $family = "Microsoft YaHei" } elseif ($families -contains "SimHei") { $family = "SimHei" } else { $family = "Arial" } }',
  'function ConvertTo-Color([string]$hex) {',
  '  $c = $hex.TrimStart("#")',
  '  $a = 255',
  '  if ($c.Length -eq 8) { $a = [Convert]::ToInt32($c.Substring(0,2),16); $c = $c.Substring(2) }',
  '  $r = [Convert]::ToInt32($c.Substring(0,2),16)',
  '  $gg = [Convert]::ToInt32($c.Substring(2,2),16)',
  '  $b = [Convert]::ToInt32($c.Substring(4,2),16)',
  '  return [System.Drawing.Color]::FromArgb($a, $r, $gg, $b)',
  '}',
  'foreach ($op in $spec.ops) {',
  '  if ($op.type -eq "rect") {',
  '    $brush = New-Object System.Drawing.SolidBrush((ConvertTo-Color $op.color))',
  '    $g.FillRectangle($brush, [float]$op.x, [float]$op.y, [float]$op.w, [float]$op.h)',
  '    $brush.Dispose()',
  '  } elseif ($op.type -eq "text") {',
  '    $style = [System.Drawing.FontStyle]::Regular',
  '    if ($op.bold) { $style = [System.Drawing.FontStyle]::Bold }',
  '    $font = New-Object System.Drawing.Font($family, [float]$op.size, $style, [System.Drawing.GraphicsUnit]::Pixel)',
  '    $brush = New-Object System.Drawing.SolidBrush((ConvertTo-Color $op.color))',
  '    $g.DrawString([string]$op.text, $font, $brush, [float]$op.x, [float]$op.y)',
  '    $font.Dispose()',
  '    $brush.Dispose()',
  '  } elseif ($op.type -eq "image") {',
  '    if (Test-Path $op.path) {',
  '      $img = [System.Drawing.Image]::FromFile($op.path)',
  '      $dest = New-Object System.Drawing.RectangleF([float]$op.x, [float]$op.y, [float]$op.w, [float]$op.h)',
  '      $src = New-Object System.Drawing.RectangleF([float]$op.srcX, [float]$op.srcY, [float]$op.srcW, [float]$op.srcH)',
  '      $g.DrawImage($img, $dest, $src, [System.Drawing.GraphicsUnit]::Pixel)',
  '      $img.Dispose()',
  '    }',
  '  }',
  '}',
  '$g.Dispose()',
  '$bmp.Save($OutPath, [System.Drawing.Imaging.ImageFormat]::Png)',
  '$bmp.Dispose()',
  '} catch {',
  '  Set-Content -Path $LogPath -Value ($_.Exception.Message + " / " + $_.ScriptStackTrace) -Encoding UTF8',
  '  exit 1',
  '}',
  'if (Test-Path $LogPath) { Remove-Item $LogPath -Force }',
].join('\n')

function workDir() {
  const dir = path.join(tmpdir(), 'dsh-outlast-cards')
  mkdirSync(dir, { recursive: true })
  return dir
}

function prune(dir, keep = 24) {
  try {
    const files = readdirSync(dir)
      .filter((name) => name.endsWith('.png'))
      .map((name) => path.join(dir, name))
      .map((file) => ({ file, mtime: statSync(file).mtimeMs }))
      .sort((a, b) => b.mtime - a.mtime)
    for (const stale of files.slice(keep)) rmSync(stale.file, { force: true })
  } catch {
    /* best effort */
  }
}

/** Download the Steam header art once; returns a local path or undefined. */
export async function ensureBanner(signal) {
  const dir = workDir()
  const file = path.join(dir, 'steam-header-1304930.jpg')
  if (existsSync(file) && statSync(file).size > 1024) return file
  try {
    const response = await fetch(
      'https://cdn.cloudflare.steamstatic.com/steam/apps/1304930/header.jpg',
      { signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(9000)]) : AbortSignal.timeout(9000) },
    )
    if (!response.ok) return undefined
    const buffer = Buffer.from(await response.arrayBuffer())
    if (buffer.length < 1024) return undefined
    writeFileSync(file, buffer)
    return file
  } catch {
    return undefined
  }
}

/**
 * Render one card PNG.
 * @param {object} card
 * @param {{signal?: AbortSignal, withBanner?: boolean}} [options]
 * @returns {Promise<{path: string, width: number, height: number, bytes: number}>}
 */
export async function renderCard(card, options = {}) {
  const dir = workDir()
  if (options.withBanner) {
    const banner = await ensureBanner(options.signal)
    if (banner) card = { ...card, banner }
  }

  const spec = buildCardOps(card)
  const stamp = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`
  const specPath = path.join(dir, `card-${stamp}.json`)
  const outPath = path.join(dir, `outlast-${stamp}.png`)
  const scriptPath = path.join(dir, 'render-card.ps1')

  writeFileSync(specPath, JSON.stringify(spec), 'utf8')
  writeFileSync(scriptPath, PS_SCRIPT, 'utf8')

  const candidates = ['powershell.exe', 'pwsh.exe']
  const logPath = `${outPath}.log`
  let lastError
  for (const exe of candidates) {
    try {
      const args = ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', scriptPath, specPath, outPath]
      // The host sandbox forbids piped child processes (spawn EPERM), so run the
      // painter detached from stdio and read its diagnostics from a side file.
      const result = spawnSync(exe, args, { timeout: 90000, windowsHide: true, stdio: 'ignore' })
      if (result.error) {
        lastError = result.error
        continue
      }
      if (existsSync(outPath) && statSync(outPath).size > 2048) {
        rmSync(logPath, { force: true })
        prune(dir)
        return {
          path: outPath,
          width: spec.width,
          height: spec.height,
          bytes: statSync(outPath).size,
        }
      }
      lastError = new Error(
        readLog(logPath) ||
          (typeof result.status === 'number' && result.status !== 0
            ? `PowerShell 退出码 ${result.status}`
            : '图片已生成但文件为空'),
      )
    } catch (error) {
      lastError = error
    }
  }
  throw new Error(
    `图文卡片渲染失败（需要 Windows PowerShell + System.Drawing）：${
      lastError instanceof Error ? lastError.message : String(lastError)
    }`,
  )
}
