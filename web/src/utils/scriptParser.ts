// ---------------------------------------------------------------------------
// Client-side script parser — §B.1 regexes (shared with server)
// ---------------------------------------------------------------------------

const BLOCK_HEADER = /^>>>\s+(?<title>.+?)\s+#(?<id>B\d+)\s*$/
const DIRECTIVE    = /^@(?<key>enter|exit|duration|visual):\s*(?<value>.*)$/

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ParsedBlock {
  id: string
  title: string
  line: number          // 1-based
  visualMode: 'animation' | 'image'
}

export interface ParseWarning {
  line: number
  message: string
}

export interface ParseResult {
  blocks: ParsedBlock[]
  warnings: ParseWarning[]
}

// ---------------------------------------------------------------------------
// parseScript
// ---------------------------------------------------------------------------

/**
 * Parse script.md content into blocks.
 * Does NOT read any build artifacts — visual/audio/rendered status
 * is not available here (that comes from the API).
 */
export function parseScript(scriptMd: string): ParseResult {
  const lines = scriptMd.split('\n')
  const warnings: ParseWarning[] = []
  const seenIds = new Map<string, number>()

  interface RawBlock {
    id: string
    title: string
    line: number
    visualMode: 'animation' | 'image'
  }

  const rawBlocks: RawBlock[] = []
  let current: RawBlock | null = null

  for (let i = 0; i < lines.length; i++) {
    const lineNum = i + 1
    const line = lines[i]

    const hm = BLOCK_HEADER.exec(line)
    if (hm) {
      if (current) rawBlocks.push(current)

      const id    = hm.groups!.id
      const title = hm.groups!.title

      if (seenIds.has(id)) {
        warnings.push({
          line: lineNum,
          message: `重复的块 ID: ${id}（首次出现在第 ${seenIds.get(id)} 行）`,
        })
      } else {
        seenIds.set(id, lineNum)
      }

      current = { id, title, line: lineNum, visualMode: 'animation' }
      continue
    }

    if (current) {
      const dm = DIRECTIVE.exec(line)
      if (dm && dm.groups!.key === 'visual') {
        const value = dm.groups!.value.trim()
        if (value === 'animation' || value === 'image') {
          current.visualMode = value
        } else {
          warnings.push({
            line: lineNum,
            message: `@visual 值非法: "${value}"，将降级为 animation`,
          })
          current.visualMode = 'animation'
        }
      }
    }
  }

  if (current) rawBlocks.push(current)

  return {
    blocks: rawBlocks.map(rb => ({
      id: rb.id,
      title: rb.title,
      line: rb.line,
      visualMode: rb.visualMode,
    })),
    warnings,
  }
}
