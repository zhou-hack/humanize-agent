export const DEFAULT_CHUNK_SIZE = 1200
export const DEFAULT_CHUNK_OVERLAP = 200

export interface ChunkOptions {
  size?: number
  overlap?: number
}

export function splitKnowledgeText(text: string, options: ChunkOptions = {}): string[] {
  const size = options.size ?? DEFAULT_CHUNK_SIZE
  const overlap = options.overlap ?? DEFAULT_CHUNK_OVERLAP
  if (!Number.isInteger(size) || size <= 0 || !Number.isInteger(overlap) || overlap < 0 || overlap >= size) {
    throw new RangeError('切片 size 必须为正整数，overlap 必须不小于 0 且小于 size')
  }

  const normalized = text.replaceAll('\r\n', '\n').trim()
  if (!normalized) return []
  const characters = Array.from(normalized)
  if (characters.length <= size) return [normalized]

  const chunks: string[] = []
  let start = 0
  while (start < characters.length) {
    const hardEnd = Math.min(start + size, characters.length)
    const end = hardEnd === characters.length
      ? hardEnd
      : findBoundary(characters, start, hardEnd)
    const content = characters.slice(start, end).join('').trim()
    if (content) chunks.push(content)
    if (end === characters.length) break

    let next = Math.max(start + 1, end - overlap)
    while (next < end && /\s/.test(characters[next] as string)) next += 1
    start = next
  }
  return chunks
}

function findBoundary(characters: string[], start: number, hardEnd: number): number {
  const minimum = start + Math.floor((hardEnd - start) / 2)
  for (let index = hardEnd - 1; index > minimum; index -= 1) {
    if (characters[index] === '\n' && characters[index - 1] === '\n') return index + 1
  }
  for (let index = hardEnd - 1; index >= minimum; index -= 1) {
    if (/[。！？!?；;]/.test(characters[index] as string)) return index + 1
  }
  for (let index = hardEnd - 1; index >= minimum; index -= 1) {
    if (characters[index] === '\n') return index + 1
  }
  for (let index = hardEnd - 1; index >= minimum; index -= 1) {
    if (characters[index] === '.' && /\s/.test(characters[index + 1] as string)) return index + 1
  }
  return hardEnd
}
