import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { ToolError } from '../errors.js'
import type { Workspace } from '../file_tools/workspace.js'
import type { ProcessResult } from './types.js'
import {
  assertNonSensitivePath,
  resolveReadonlyPath,
  type ReadonlyWorkspaceEntry
} from './readonly_paths.js'

const DEFAULT_ADAPTER_OUTPUT_BYTES = 64 * 1024

export interface WindowsAdapterOptions {
  scanLimit?: number
  maxOutputBytes?: number
  allowOutsideWorkspace?: boolean
}

export interface ReadonlyNodeAdapter {
  execute: () => Promise<ProcessResult>
}

export async function resolveWindowsNodeAdapter(
  name: string,
  args: readonly string[],
  workspace: Workspace,
  options: WindowsAdapterOptions = {}
): Promise<ReadonlyNodeAdapter | undefined> {
  const maximum = options.maxOutputBytes ?? DEFAULT_ADAPTER_OUTPUT_BYTES
  if (!Number.isSafeInteger(maximum) || maximum <= 0) {
    throw new TypeError('maxOutputBytes 必須是正整數')
  }

  switch (name) {
    case 'dir':
      return createDirAdapter(args, workspace, options.scanLimit, maximum, options.allowOutsideWorkspace)
    case 'cd':
      if (args.length !== 0) throw forbidden('cd 僅允許無參數顯示目前目錄')
      return { execute: async () => output(`${workspace.root}\n`, maximum) }
    case 'type':
      return createTypeAdapter(args, workspace, maximum, options.allowOutsideWorkspace)
    case 'get-content':
      return createGetContentAdapter(args, workspace, maximum, options.allowOutsideWorkspace)
    case 'select-string':
      return createSelectStringAdapter(args, workspace, maximum, options.allowOutsideWorkspace)
    default:
      return undefined
  }
}

async function createDirAdapter(
  args: readonly string[],
  workspace: Workspace,
  scanLimit: number | undefined,
  maximum: number,
  allowOutsideWorkspace?: boolean
): Promise<ReadonlyNodeAdapter> {
  let bare = false
  let recursive = false
  let directoriesOnly = false
  const operands: string[] = []
  let literal = false

  for (const arg of args) {
    if (!literal && arg === '--') {
      literal = true
    } else if (!literal && arg.toUpperCase() === '/B') {
      bare = true
    } else if (!literal && arg.toUpperCase() === '/S') {
      recursive = true
    } else if (!literal && arg.toUpperCase() === '/AD') {
      directoriesOnly = true
    } else if (!literal && arg.startsWith('/')) {
      throw forbidden(`dir 不允許旗標 ${arg}`)
    } else {
      operands.push(arg)
    }
  }
  if (operands.length > 1) throw forbidden('dir 最多接受一個路徑')

  const target = await resolveReadonlyPath(
    workspace,
    operands[0] ?? '.',
    'either',
    {
      recursive,
      ...(allowOutsideWorkspace !== undefined ? { allowOutsideWorkspace } : {}),
      ...(scanLimit !== undefined ? { scanLimit } : {})
    }
  )

  return {
    execute: () => runAdapter(async () => {
      const lines = target.type === 'file'
        ? directoriesOnly ? [] : [path.basename(target.absolutePath)]
        : await listDirectory(
            target,
            recursive,
            bare,
            directoriesOnly,
            !recursive && path.isAbsolute(target.relativePath)
          )
      return output(lines.length > 0 ? `${lines.join('\n')}\n` : '', maximum)
    })
  }
}

async function createTypeAdapter(
  args: readonly string[],
  workspace: Workspace,
  maximum: number,
  allowOutsideWorkspace?: boolean
): Promise<ReadonlyNodeAdapter> {
  const operands = withoutLiteralMarker(args)
  if (operands.length === 0) throw forbidden('type 至少需要一個檔案')
  if (operands.some((arg) => arg.startsWith('/'))) throw forbidden('type 不允許旗標')
  const files = await resolveFiles(workspace, operands, allowOutsideWorkspace)
  return {
    execute: () => runAdapter(async () => {
      const contents = await Promise.all(files.map((file) => readFile(file.absolutePath, 'utf8')))
      return output(contents.join(''), maximum)
    })
  }
}

async function createGetContentAdapter(
  args: readonly string[],
  workspace: Workspace,
  maximum: number,
  allowOutsideWorkspace?: boolean
): Promise<ReadonlyNodeAdapter> {
  const parsed = parseWindowsOptions(args, new Set([
    '-path', '-literalpath', '-encoding', '-totalcount', '-tail'
  ]))
  let pathOption: string | undefined
  let totalCount: number | undefined
  let tail: number | undefined
  let raw = false

  for (let index = 0; index < parsed.options.length; index += 1) {
    const option = parsed.options[index] as string
    switch (option.toLowerCase()) {
      case '-path':
      case '-literalpath': {
        if (pathOption !== undefined) throw forbidden('Get-Content 只能指定一個路徑旗標')
        pathOption = requiredValue(parsed.options, ++index, option)
        break
      }
      case '-encoding':
        if (requiredValue(parsed.options, ++index, option).toLowerCase() !== 'utf8') {
          throw forbidden('Get-Content 僅支援 UTF8')
        }
        break
      case '-totalcount':
        totalCount = positiveInteger(requiredValue(parsed.options, ++index, option))
        break
      case '-tail':
        tail = positiveInteger(requiredValue(parsed.options, ++index, option))
        break
      case '-raw':
        raw = true
        break
      default:
        throw forbidden(`Get-Content 不允許旗標 ${option}`)
    }
  }
  if (totalCount !== undefined && tail !== undefined) {
    throw forbidden('Get-Content 的 -TotalCount 與 -Tail 不能並用')
  }
  if (raw && (totalCount !== undefined || tail !== undefined)) {
    throw forbidden('Get-Content -Raw 不能搭配行範圍旗標')
  }

  const operands = pathOption === undefined ? parsed.operands : [pathOption, ...parsed.operands]
  if (operands.length === 0) throw forbidden('Get-Content 至少需要一個檔案')
  const files = await resolveFiles(workspace, operands, allowOutsideWorkspace)

  return {
    execute: () => runAdapter(async () => {
      const contents: string[] = []
      for (const file of files) {
        let content = await readFile(file.absolutePath, 'utf8')
        if (!raw && totalCount !== undefined) content = selectLines(content, 0, totalCount)
        if (!raw && tail !== undefined) {
          const lines = splitLines(content)
          content = selectLines(content, Math.max(0, lines.length - tail), lines.length)
        }
        contents.push(content)
      }
      return output(contents.join(''), maximum)
    })
  }
}

async function createSelectStringAdapter(
  args: readonly string[],
  workspace: Workspace,
  maximum: number,
  allowOutsideWorkspace?: boolean
): Promise<ReadonlyNodeAdapter> {
  const parsed = parseWindowsOptions(args, new Set([
    '-path', '-literalpath', '-pattern', '-encoding'
  ]))
  let pattern: string | undefined
  let pathOption: string | undefined
  let caseSensitive = false

  for (let index = 0; index < parsed.options.length; index += 1) {
    const option = parsed.options[index] as string
    switch (option.toLowerCase()) {
      case '-path':
      case '-literalpath':
        if (pathOption !== undefined) throw forbidden('Select-String 只能指定一個路徑旗標')
        pathOption = requiredValue(parsed.options, ++index, option)
        break
      case '-pattern':
        if (pattern !== undefined) throw forbidden('Select-String 只能指定一個 -Pattern')
        pattern = requiredValue(parsed.options, ++index, option)
        break
      case '-encoding':
        if (requiredValue(parsed.options, ++index, option).toLowerCase() !== 'utf8') {
          throw forbidden('Select-String 僅支援 UTF8')
        }
        break
      case '-simplematch':
        break
      case '-casesensitive':
        caseSensitive = true
        break
      default:
        throw forbidden(`Select-String 不允許旗標 ${option}`)
    }
  }
  if (pattern === undefined || pattern.length === 0) {
    throw forbidden('Select-String 需要非空的 -Pattern 字面字串')
  }

  const operands = pathOption === undefined ? parsed.operands : [pathOption, ...parsed.operands]
  if (operands.length === 0) throw forbidden('Select-String 至少需要一個檔案')
  const files = await resolveFiles(workspace, operands, allowOutsideWorkspace)
  const needle = caseSensitive ? pattern : pattern.toLowerCase()

  return {
    execute: () => runAdapter(async () => {
      const matches: string[] = []
      for (const file of files) {
        const content = await readFile(file.absolutePath, 'utf8')
        const lines = splitLines(content)
        for (const [index, line] of lines.entries()) {
          const haystack = caseSensitive ? line : line.toLowerCase()
          if (haystack.includes(needle)) matches.push(`${file.relativePath}:${index + 1}:${line}`)
        }
      }
      return output(matches.length > 0 ? `${matches.join('\n')}\n` : '', maximum)
    })
  }
}

function parseWindowsOptions(
  args: readonly string[],
  valueFlags: ReadonlySet<string>
): { options: string[]; operands: string[] } {
  const options: string[] = []
  const operands: string[] = []
  let literal = false

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index] as string
    if (!literal && arg === '--') {
      literal = true
    } else if (!literal && arg.startsWith('-')) {
      options.push(arg)
      if (valueFlags.has(arg.toLowerCase())) {
        const value = args[index + 1]
        if (value === undefined) throw forbidden(`${arg} 缺少值`)
        options.push(value)
        index += 1
      }
    } else {
      operands.push(arg)
    }
  }
  return { options, operands }
}

function withoutLiteralMarker(args: readonly string[]): string[] {
  const marker = args.indexOf('--')
  return marker === -1 ? [...args] : args.filter((arg) => arg !== '--')
}

async function resolveFiles(
  workspace: Workspace,
  operands: readonly string[],
  allowOutsideWorkspace?: boolean
): Promise<ReadonlyWorkspaceEntry[]> {
  const files: ReadonlyWorkspaceEntry[] = []
  for (const operand of operands) {
    files.push(await resolveReadonlyPath(workspace, operand, 'file', {
      ...(allowOutsideWorkspace !== undefined ? { allowOutsideWorkspace } : {})
    }))
  }
  return files
}

async function listDirectory(
  target: ReadonlyWorkspaceEntry,
  recursive: boolean,
  bare: boolean,
  directoriesOnly: boolean,
  skipUnsafeChildren: boolean
): Promise<string[]> {
  const lines: string[] = []
  const queue = [target]

  while (queue.length > 0) {
    const directory = queue.shift() as ReadonlyWorkspaceEntry
    const children = await readdir(directory.absolutePath, { withFileTypes: true })
    children.sort((left, right) => left.name.localeCompare(right.name))

    for (const child of children) {
      const relativePath = directory.relativePath === '.'
        ? child.name
        : `${directory.relativePath}/${child.name}`
      try {
        assertNonSensitivePath(relativePath)
      } catch (error) {
        if (skipUnsafeChildren && error instanceof ToolError && error.code === 'sensitive') continue
        throw error
      }
      if (child.isSymbolicLink()) {
        if (skipUnsafeChildren) continue
        throw forbidden('目錄內容不得包含符號連結或 junction')
      }
      const displayPath = recursive ? relativePath : child.name
      if (!directoriesOnly || child.isDirectory()) {
        lines.push(bare ? displayPath : `${child.isDirectory() ? '<DIR> ' : ''}${displayPath}`)
      }
      if (recursive && child.isDirectory()) {
        queue.push({
          absolutePath: path.join(directory.absolutePath, child.name),
          relativePath,
          size: 0,
          mode: 0,
          type: 'directory'
        })
      }
    }
  }
  return lines
}

function splitLines(content: string): string[] {
  const lines = content.split(/\r\n|\n|\r/u)
  if (lines.at(-1) === '') lines.pop()
  return lines
}

function selectLines(content: string, start: number, end: number): string {
  const lines = splitLines(content).slice(start, end)
  return lines.length > 0 ? `${lines.join('\n')}\n` : ''
}

function requiredValue(args: readonly string[], index: number, option: string): string {
  const value = args[index]
  if (value === undefined) throw forbidden(`${option} 缺少值`)
  return value
}

function positiveInteger(value: string): number {
  if (!/^\d+$/u.test(value) || Number(value) <= 0 || !Number.isSafeInteger(Number(value))) {
    throw forbidden('數值旗標必須是正整數')
  }
  return Number(value)
}

async function runAdapter(run: () => Promise<ProcessResult>): Promise<ProcessResult> {
  try {
    return await run()
  } catch {
    return {
      exitCode: 1,
      signal: null,
      timedOut: false,
      truncated: false,
      stdout: '',
      stderr: 'Windows 唯讀 adapter 執行失敗\n'
    }
  }
}

function output(stdout: string, maximum: number): ProcessResult {
  const buffer = Buffer.from(stdout, 'utf8')
  const retained = buffer.subarray(0, maximum)
  return {
    exitCode: 0,
    signal: null,
    timedOut: false,
    truncated: buffer.length > maximum,
    stdout: retained.toString('utf8'),
    stderr: ''
  }
}

function forbidden(message: string): ToolError {
  return new ToolError('forbidden', message)
}
