import { ToolError } from '../errors.js'

const UNQUOTED_META = new Set([
  '|', '&', ';', '<', '>', '(', ')', '`', '$', '%', '^', '\n', '\r',
  '*', '?', '[', ']', '{', '}', '~', '#', '!'
])
const ESCAPABLE = new Set([' ', '\\', '"', "'"])

/**
 * Lexes exactly one command without performing shell expansion. Quoted shell
 * metacharacters are data; unquoted metacharacters and substitutions are not.
 */
export function lexReadonlyCommand(command: string): string[] {
  const tokens: string[] = []
  let token = ''
  let tokenStarted = false
  let quote: 'single' | 'double' | undefined

  for (let index = 0; index < command.length; index += 1) {
    const character = command[index] as string

    if (/[\u0000-\u001f\u007f]/u.test(character)) {
      throw forbidden('命令包含控制字元或換行')
    }

    if (quote === 'single') {
      if (character === "'") {
        quote = undefined
      } else {
        token += character
      }
      continue
    }

    if (quote === 'double') {
      if (character === '"') {
        quote = undefined
        continue
      }
      if (character === '$' || character === '`' || character === '%') {
        throw forbidden('不允許變數展開或命令代換')
      }
      if (character === '\\') {
        const next = command[index + 1]
        if (next === '"' || next === '\\') {
          token += next
          index += 1
        } else {
          token += character
        }
        continue
      }
      token += character
      continue
    }

    if (character === ' ') {
      if (tokenStarted) {
        tokens.push(token)
        token = ''
        tokenStarted = false
      }
      continue
    }
    if (character === "'" || character === '"') {
      quote = character === "'" ? 'single' : 'double'
      tokenStarted = true
      continue
    }
    if (UNQUOTED_META.has(character)) {
      throw forbidden('不允許未引用的 shell 元字元、串接或代換')
    }
    if (character === '\\') {
      const next = command[index + 1]
      if (next !== undefined && ESCAPABLE.has(next)) {
        token += next
        tokenStarted = true
        index += 1
      } else {
        token += character
        tokenStarted = true
      }
      continue
    }

    token += character
    tokenStarted = true
  }

  if (quote) throw forbidden('命令包含未閉合引號')
  if (tokenStarted) tokens.push(token)
  if (tokens.length === 0) throw forbidden('命令不能為空')
  return tokens
}

function forbidden(message: string): ToolError {
  return new ToolError('forbidden', message)
}
