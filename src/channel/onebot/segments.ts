import type { OneBotMessageSegment } from './types.js'

export function textFromSegments(segments: OneBotMessageSegment[]): string {
  return segments.map((segment) => {
    if (segment.type !== 'text' || typeof segment.data?.text !== 'string') return ''
    return segment.data.text
  }).join('').trim()
}

export function textSegment(text: string): OneBotMessageSegment {
  return { type: 'text', data: { text } }
}

export function atSegment(userId: number): OneBotMessageSegment {
  return { type: 'at', data: { qq: String(userId) } }
}
