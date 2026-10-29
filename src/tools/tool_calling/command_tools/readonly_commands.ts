import { lstat, open, readFile, realpath } from 'node:fs/promises'
import path from 'node:path'
import { ToolError } from '../errors.js'
import type { Workspace } from '../file_tools/workspace.js'
import { lexReadonlyCommand } from './readonly_lexer.js'
import { assertNonSensitivePath, resolveReadonlyPath } from './readonly_paths.js'
import { resolveWindowsNodeAdapter } from './readonly_windows.js'
import type { ProcessResult } from './types.js'

export interface ReadonlyCommandOptions {
  workspace: Workspace
  trustedPath?: string
  platform?: NodeJS.Platform
  scanLimit?: number
  maxOutputBytes?: number
  allowOutsideWorkspace?: boolean
}

export type ResolvedReadonlyCommand =
  | { kind: 'process'; executable: string; args: readonly string[] }
  | { kind: 'adapter'; execute: () => Promise<ProcessResult> }

interface Context extends ReadonlyCommandOptions {
  platform: NodeJS.Platform
}

interface FlagSpec {
  value?: 'string' | 'integer'
  choices?: readonly string[]
}

interface ParsedArguments {
  options: Map<string, string | true>
  positionals: string[]
  literalOperands: string[]
}

const NO_FLAGS: Readonly<Record<string, FlagSpec>> = {}
const VERSION_COMMANDS = new Set([
  'node', 'npm', 'python', 'python3', 'pip', 'pip3', 'git', 'rg', 'jq'
])
const WINDOWS_ADAPTERS = new Set(['dir', 'cd', 'type', 'get-content', 'select-string'])

/**
 * Validates and preflights one read-only command. The caller supplies cwd,
 * trusted environment and timeout when executing the returned process spec.
 */
export async function resolveReadonlyCommand(
  command: string,
  options: ReadonlyCommandOptions
): Promise<ResolvedReadonlyCommand> {
  try {
    const argv = lexReadonlyCommand(command)
    const platform = options.platform ?? process.platform
    const name = normalizeCommandName(argv[0] as string, platform)
    const args = argv.slice(1)
    const context: Context = { ...options, platform }

    if (platform === 'win32' && WINDOWS_ADAPTERS.has(name)) {
      const adapter = await resolveWindowsNodeAdapter(name, args, options.workspace, {
        ...(options.scanLimit !== undefined ? { scanLimit: options.scanLimit } : {}),
        ...(options.maxOutputBytes !== undefined ? { maxOutputBytes: options.maxOutputBytes } : {}),
        ...(options.allowOutsideWorkspace !== undefined
          ? { allowOutsideWorkspace: options.allowOutsideWorkspace }
          : {})
      })
      if (adapter) return { kind: 'adapter', execute: adapter.execute }
    }

    if (VERSION_COMMANDS.has(name) && args.length === 1 && args[0] === '--version') {
      return native(name, args, context)
    }

    const validatedArgs = await validateNativeCommand(name, args, context)
    return native(name, validatedArgs, context)
  } catch (error) {
    throw normalizeReadonlyError(error)
  }
}

async function validateNativeCommand(
  name: string,
  args: readonly string[],
  context: Context
): Promise<readonly string[]> {
  if (name === 'git') return validateGit(args, context)

  switch (name) {
    case 'pwd':
    case 'hostname':
    case 'whoami':
    case 'arch':
    case 'env':
      expectNoArguments(args)
      return args
    case 'printenv': {
      const parsed = parseArguments(args, NO_FLAGS)
      for (const operand of allOperands(parsed)) assertEnvironmentName(operand)
      return args
    }
    case 'date':
      parseArguments(args, { '-u': {} })
      return args
    case 'uname':
      parseArguments(args, {
        '-a': {}, '-s': {}, '-n': {}, '-r': {}, '-v': {}, '-m': {},
        '-p': {}, '-i': {}, '-o': {}
      })
      return args
    case 'uptime': {
      const parsed = parseArguments(args, {
        '-p': {}, '--pretty': {}, '-s': {}, '--since': {}
      })
      if (allOperands(parsed).length !== 0) throw forbidden('uptime 不接受位置參數')
      return args
    }
    case 'ps': {
      const parsed = parseArguments(args, {
        '-A': {}, '-a': {}, '-d': {}, '-e': {}, '-f': {}, '-F': {}, '-l': {},
        '-j': {}, '-H': {}, '-x': {}, '-w': {}, '-L': {}, '--forest': {},
        '--no-headers': {}, '-p': { value: 'integer' }, '--pid': { value: 'integer' }
      })
      if (allOperands(parsed).length !== 0) throw forbidden('ps 不接受位置參數')
      return args
    }
    case 'df':
      await validatePaths(args, {
        '-h': {}, '--human-readable': {}, '-H': {}, '--si': {}, '-k': {}, '-m': {},
        '-P': {}, '--portability': {}, '-T': {}, '--print-type': {},
        '-i': {}, '--inodes': {}, '--total': {}
      }, context, { kind: 'either' })
      return args
    case 'which':
    case 'where': {
      const parsed = parseArguments(args, name === 'which' ? { '-a': {} } : NO_FLAGS)
      const operands = allOperands(parsed)
      if (operands.length === 0) throw forbidden(`${name} 至少需要一個命令名稱`)
      for (const operand of operands) {
        if (!/^[A-Za-z0-9._+-]+$/u.test(operand)) throw forbidden('僅能查詢命令名稱')
      }
      return args
    }
    case 'systeminfo':
      if (context.platform !== 'win32') throw forbidden('systeminfo 僅支援 Windows')
      expectNoArguments(args)
      return args
    case 'basename':
    case 'dirname': {
      const parsed = parseArguments(args, NO_FLAGS)
      if (allOperands(parsed).length !== 1) throw forbidden(`${name} 只接受一個字串參數`)
      return args
    }
    case 'realpath':
      await validatePaths(args, {
        '-e': {}, '--canonicalize-existing': {}
      }, context, { kind: 'either', minimum: 1 })
      return args
    case 'echo':
      validateEcho(args)
      return args
    case 'ls':
      await validatePaths(args, {
        '-l': {}, '-a': {}, '-1': {}, '-h': {}, '-R': {}, '-t': {}, '-S': {}
      }, context, { kind: 'either', recursive: hasFlag(args, '-R') })
      return args
    case 'cat':
      await validatePaths(args, { '-n': {}, '-b': {}, '-E': {} }, context, {
        kind: 'file', minimum: 1
      })
      return args
    case 'head':
      await validatePaths(args, {
        '-n': { value: 'integer' }, '-c': { value: 'integer' }, '-q': {}, '-v': {}
      }, context, { kind: 'file', minimum: 1 })
      return args
    case 'tail':
      await validatePaths(args, {
        '-n': { value: 'integer' }, '-c': { value: 'integer' }, '-q': {}, '-v': {}
      }, context, { kind: 'file', minimum: 1 })
      return args
    case 'wc':
      await validatePaths(args, {
        '-l': {}, '-w': {}, '-c': {}, '-m': {}, '-L': {}
      }, context, { kind: 'file', minimum: 1 })
      return args
    case 'stat':
    case 'file':
      await validatePaths(args, NO_FLAGS, context, { kind: 'either', minimum: 1 })
      return args
    case 'grep':
    case 'egrep':
      await validateGrep(args, context)
      return args
    case 'rg':
      await validateRg(args, context)
      return args
    case 'fd':
      await validateFd(args, context)
      return args
    case 'find':
      await validateFind(args, context)
      return args
    case 'du':
      await validateDu(args, context)
      return args
    case 'sort':
      await validatePaths(args, {
        '-r': {}, '-n': {}, '-u': {}, '-f': {}, '-k': { value: 'string' },
        '-t': { value: 'string' }, '-s': {}
      }, context, { kind: 'file', minimum: 1 })
      return args
    case 'uniq':
      await validatePaths(args, { '-i': {}, '-c': {}, '-d': {}, '-u': {} }, context, {
        kind: 'file', minimum: 1, maximum: 1
      })
      return args
    case 'cut':
      await validateCut(args, context)
      return args
    case 'column':
      await validatePaths(args, {
        '-t': {}, '--table': {}, '-s': { value: 'string' }, '--separator': { value: 'string' },
        '-o': { value: 'string' }, '--output-separator': { value: 'string' },
        '-N': { value: 'string' }, '--table-columns': { value: 'string' },
        '-c': { value: 'integer' }, '--output-width': { value: 'integer' },
        '-x': {}, '--fillrows': {}, '-d': {}, '--table-noheadings': {}
      }, context, { kind: 'file', minimum: 1 })
      return args
    case 'tr':
      throw forbidden('tr 需要 stdin；唯讀命令不提供管道或輸入，故不允許執行')
    case 'diff':
      await validatePaths(args, {
        '-u': {}, '-c': {}, '-w': {}, '-B': {}, '-b': {}, '-i': {}, '-q': {},
        '-s': {}, '-r': {}, '--brief': {}, '--strip-trailing-cr': {}
      }, context, { kind: 'either', minimum: 2, maximum: 2, recursive: true })
      return args
    case 'cmp':
      await validatePaths(args, {
        '-b': {}, '--print-bytes': {}, '-l': {}, '--verbose': {},
        '-q': {}, '--quiet': {}, '-s': {}, '--silent': {}, '--brief': {},
        '-n': { value: 'integer' }
      }, context, { kind: 'file', minimum: 2, maximum: 2 })
      return args
    case 'curl':
      return validateCurl(args)
    case 'jq':
      await validateJq(args, context)
      return args
    case 'npm':
      await validateNpm(args)
      return args
    case 'pip':
    case 'pip3':
      validatePip(args)
      return args
    case 'tree':
      if (context.platform !== 'win32') throw forbidden('原生 tree 僅支援 Windows')
      await validateTree(args, context)
      return args
    case 'findstr':
      if (context.platform !== 'win32') throw forbidden('findstr 僅支援 Windows')
      return validateFindstr(args, context)
    default:
      throw forbidden(`命令不在唯讀白名單：${name}`)
  }
}

async function validatePaths(
  args: readonly string[],
  flags: Readonly<Record<string, FlagSpec>>,
  context: Context,
  options: {
    kind: 'file' | 'directory' | 'either'
    minimum?: number
    maximum?: number
    recursive?: boolean
    defaultRoot?: boolean
  }
): Promise<ParsedArguments> {
  const parsed = parseArguments(args, flags)
  const operands = allOperands(parsed)
  const minimum = options.minimum ?? 0
  if (operands.length < minimum || (options.maximum !== undefined && operands.length > options.maximum)) {
    throw forbidden('命令的位置參數數量不符合唯讀形式')
  }
  if (operands.length === 0) {
    if (options.defaultRoot || options.recursive) await preflightRoot(context)
  } else {
    for (const operand of operands) await preflightPath(operand, options.kind, options.recursive ?? false, context)
  }
  return parsed
}

function validateEcho(args: readonly string[]): void {
  const literals = args[0] === '-n' ? args.slice(1) : args
  for (const literal of literals) {
    if (literal.startsWith('-') || literal.includes('\\')) {
      throw forbidden('echo 僅允許 -n 與不含跳脫解譯的字面輸出')
    }
  }
}

async function validateGrep(args: readonly string[], context: Context): Promise<void> {
  const parsed = parseArguments(args, {
    '-i': {}, '-v': {}, '-n': {}, '-H': {}, '-h': {}, '-l': {}, '-L': {},
    '-w': {}, '-x': {}, '-F': {}, '-E': {}, '-r': {}, '-c': {}, '-s': {},
    '-m': { value: 'integer' }, '-A': { value: 'integer' },
    '-B': { value: 'integer' }, '-C': { value: 'integer' },
    '-e': { value: 'string' }, '--include': { value: 'string' },
    '--exclude': { value: 'string' }
  })
  const operands = allOperands(parsed)
  const hasExpression = parsed.options.has('-e')
  const paths = hasExpression ? operands : operands.slice(1)
  if ((!hasExpression && operands.length < 2) || (hasExpression && paths.length === 0)) {
    throw forbidden('grep 需要搜尋模式及至少一個明確檔案或目錄')
  }
  const recursive = parsed.options.has('-r')
  for (const operand of paths) await preflightPath(operand, 'either', recursive, context)
}

async function validateRg(args: readonly string[], context: Context): Promise<void> {
  const parsed = parseArguments(args, {
    '-i': {}, '-n': {}, '-l': {}, '-F': {}, '-w': {}, '-x': {}, '-v': {},
    '--files': {}, '--hidden': {}, '--no-ignore': {}, '--with-filename': {},
    '--no-filename': {}, '-g': { value: 'string' }, '--glob': { value: 'string' },
    '-m': { value: 'integer' }, '--max-count': { value: 'integer' },
    '-A': { value: 'integer' }, '-B': { value: 'integer' }, '-C': { value: 'integer' },
    '-e': { value: 'string' }
  })
  const operands = allOperands(parsed)
  const filesOnly = parsed.options.has('--files')
  const hasExpression = parsed.options.has('-e')
  if (filesOnly && hasExpression) throw forbidden('rg --files 不能搭配 -e')
  const paths = filesOnly || hasExpression ? operands : operands.slice(1)
  if (!filesOnly && !hasExpression && operands.length === 0) throw forbidden('rg 需要搜尋模式')
  if (paths.length === 0) {
    await preflightRoot(context)
  } else {
    for (const operand of paths) await preflightPath(operand, 'either', true, context)
  }
}

async function validateFd(args: readonly string[], context: Context): Promise<void> {
  const parsed = parseArguments(args, {
    '-H': {}, '--hidden': {}, '-I': {}, '--no-ignore': {}, '--no-ignore-vcs': {},
    '-s': {}, '--case-sensitive': {}, '-i': {}, '--ignore-case': {},
    '-F': {}, '--fixed-strings': {}, '--regex': {}, '-g': {}, '--glob': {},
    '-p': {}, '--full-path': {}, '-l': {}, '--list-details': {},
    '-d': { value: 'integer' }, '--max-depth': { value: 'integer' },
    '--min-depth': { value: 'integer' }, '--max-results': { value: 'integer' },
    '-t': { value: 'string', choices: ['f', 'd'] },
    '--type': { value: 'string', choices: ['f', 'd'] },
    '-e': { value: 'string' }, '--extension': { value: 'string' },
    '-E': { value: 'string' }, '--exclude': { value: 'string' },
    '-0': {}, '--print0': {}, '--one-file-system': {}, '-q': {}, '--quiet': {}
  })
  const operands = allOperands(parsed)
  const paths = operands.length > 1 ? operands.slice(1) : []
  if (paths.length === 0) {
    await preflightRoot(context)
  } else {
    for (const operand of paths) await preflightPath(operand, 'either', true, context)
  }
}

async function validateFind(args: readonly string[], context: Context): Promise<void> {
  const paths: string[] = []
  let index = 0
  while (index < args.length && !(args[index] as string).startsWith('-')) {
    paths.push(args[index] as string)
    index += 1
  }
  if (paths.length === 0) paths.push('.')

  while (index < args.length) {
    const flag = args[index] as string
    if (flag === '-print') {
      index += 1
      continue
    }
    if (flag === '-maxdepth' || flag === '-mindepth') {
      assertInteger(requiredValue(args, ++index, flag))
    } else if (flag === '-name' || flag === '-iname') {
      requiredValue(args, ++index, flag)
    } else if (flag === '-type') {
      const type = requiredValue(args, ++index, flag)
      if (type !== 'f' && type !== 'd') throw forbidden('find -type 僅允許 f 或 d')
    } else {
      throw forbidden(`find 僅允許安全的名稱、類型與深度表達式：${flag}`)
    }
    index += 1
  }

  for (const operand of paths) await preflightPath(operand, 'either', true, context)
}

async function validateDu(args: readonly string[], context: Context): Promise<void> {
  await validatePaths(args, {
    '-h': {}, '-s': {}, '-a': {}, '-c': {}, '-x': {},
    '-d': { value: 'integer' }, '--max-depth': { value: 'integer' },
    '--exclude': { value: 'string' }
  }, context, { kind: 'either', recursive: true, defaultRoot: true })
}

async function validateCut(args: readonly string[], context: Context): Promise<void> {
  const parsed = await validatePaths(args, {
    '-d': { value: 'string' }, '-f': { value: 'string' }, '-c': { value: 'string' },
    '-b': { value: 'string' }, '-s': {}, '--complement': {}
  }, context, { kind: 'file', minimum: 1 })
  const selectors = ['-f', '-c', '-b'].filter((flag) => parsed.options.has(flag))
  if (selectors.length !== 1) throw forbidden('cut 必須且只能選擇 -f、-c 或 -b')
}

function validateCurl(args: readonly string[]): readonly string[] {
  const parsed = parseArguments(args, {
    '-s': {}, '--silent': {}, '-S': {}, '--show-error': {},
    '-f': {}, '--fail': {}, '-i': {}, '--include': {},
    '-I': {}, '--head': {}, '-L': {}, '--location': {},
    '-4': {}, '--ipv4': {}, '-6': {}, '--ipv6': {}, '--compressed': {},
    '-H': { value: 'string' }, '--header': { value: 'string' },
    '-A': { value: 'string' }, '--user-agent': { value: 'string' },
    '-x': { value: 'string' }, '--proxy': { value: 'string' },
    '--max-time': { value: 'integer' }, '--connect-timeout': { value: 'integer' },
    '--max-redirs': { value: 'integer' }
  }, true)
  const operands = allOperands(parsed)
  if (operands.length !== 1) throw forbidden('curl 必須且只能指定一個 HTTP(S) URL')
  assertHttpUrl(operands[0] as string, 'curl 目標')

  for (let index = 0; index < args.length; index += 1) {
    if ((args[index] === '-H' || args[index] === '--header') && args[index + 1]?.startsWith('@')) {
      throw forbidden('curl header 不得從檔案讀取')
    }
  }
  for (const flag of ['-x', '--proxy']) {
    const proxy = parsed.options.get(flag)
    if (typeof proxy === 'string') assertHttpUrl(proxy, 'curl proxy')
  }

  return [
    '-q', '--globoff', '--proto', '=http,https', '--proto-redir', '=http,https',
    ...args
  ]
}

function assertHttpUrl(value: string, label: string): void {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw forbidden(`${label} 不是有效 URL`)
  }
  if ((url.protocol !== 'http:' && url.protocol !== 'https:') || !url.hostname) {
    throw forbidden(`${label} 僅允許 HTTP(S)`)
  }
}

async function validateJq(args: readonly string[], context: Context): Promise<void> {
  const parsed = parseArguments(args, {
    '-r': {}, '-c': {}, '-M': {}, '-e': {}, '-s': {}, '--tab': {},
    '--indent': { value: 'integer' }
  })
  const operands = allOperands(parsed)
  if (operands.length < 2) throw forbidden('jq 需要 filter 及至少一個明確輸入檔案')
  if (/\b(?:import|include|module)\b/u.test(operands[0] as string)) {
    throw forbidden('jq filter 不得載入模組或額外檔案')
  }
  for (const operand of operands.slice(1)) await preflightPath(operand, 'file', false, context)
}

async function validateNpm(args: readonly string[]): Promise<void> {
  if (args[0] !== 'ls') throw forbidden('npm 僅允許 ls 或 --version')
  const parsed = parseArguments(args.slice(1), {
    '--depth': { value: 'integer' }, '--json': {}, '--all': {}, '--long': {}
  })
  if (allOperands(parsed).length !== 0) throw forbidden('npm ls 不接受額外位置參數')
}

function validatePip(args: readonly string[]): void {
  if (args[0] !== 'list') throw forbidden('pip 僅允許 list 或 --version')
  const parsed = parseArguments(args.slice(1), {
    '--format': { value: 'string', choices: ['columns', 'freeze', 'json'] },
    '--local': {}, '--user': {}, '--not-required': {}
  })
  if (allOperands(parsed).length !== 0) throw forbidden('pip list 不接受額外位置參數')
}

async function validateTree(args: readonly string[], context: Context): Promise<void> {
  const operands: string[] = []
  let literal = false
  for (const arg of args) {
    if (!literal && arg === '--') literal = true
    else if (!literal && ['/F', '/A'].includes(arg.toUpperCase())) continue
    else if (!literal && arg.startsWith('/')) throw forbidden(`tree 不允許旗標 ${arg}`)
    else operands.push(arg)
  }
  if (operands.length > 1) throw forbidden('tree 最多接受一個起始目錄')
  await preflightPath(operands[0] ?? '.', 'directory', true, context)
}

async function validateFindstr(args: readonly string[], context: Context): Promise<readonly string[]> {
  const operands: string[] = []
  let recursive = false
  let literal = false
  let hasLiteralFlag = false
  let hasPattern = false

  for (const arg of args) {
    const upper = arg.toUpperCase()
    if (!literal && arg === '--') {
      literal = true
    } else if (!literal && ['/I', '/N', '/M', '/L', '/S', '/X', '/B', '/E'].includes(upper)) {
      if (upper === '/S') recursive = true
      if (upper === '/L') hasLiteralFlag = true
    } else if (!literal && upper.startsWith('/C:')) {
      if (arg.length === 3) throw forbidden('findstr /C: 需要非空字面搜尋字串')
      hasPattern = true
    } else if (!literal && arg.startsWith('/')) {
      throw forbidden(`findstr 不允許旗標或間接輸入 ${arg}`)
    } else {
      operands.push(arg)
    }
  }

  let paths = operands
  if (!hasPattern && hasLiteralFlag && operands.length >= 2) {
    hasPattern = true
    paths = operands.slice(1)
  }
  if (!hasPattern || paths.length === 0) {
    throw forbidden('findstr 需要 /C:字面字串（或 /L 與模式）及明確路徑')
  }
  for (const operand of paths) {
    await preflightPath(operand, recursive ? 'either' : 'file', recursive, context)
  }
  return hasLiteralFlag ? args : ['/L', ...args]
}

async function validateGit(args: readonly string[], context: Context): Promise<readonly string[]> {
  const subcommand = args[0]
  if (!subcommand || subcommand.startsWith('-')) throw forbidden('Git 不允許全域旗標或隱式子命令')
  const rest = args.slice(1)
  let subcommandArgs: readonly string[]

  switch (subcommand) {
    case 'status':
      subcommandArgs = await validateGitStatus(rest, context)
      break
    case 'log':
      subcommandArgs = await validateGitRevisionCommand(rest, context, 'log')
      break
    case 'diff':
      subcommandArgs = await validateGitRevisionCommand(rest, context, 'diff')
      break
    case 'show':
      subcommandArgs = await validateGitRevisionCommand(rest, context, 'show')
      break
    case 'branch':
      subcommandArgs = validateGitBranch(rest)
      break
    case 'remote':
      if (rest.length !== 1 || (rest[0] !== '-v' && rest[0] !== '--verbose')) {
        throw forbidden('Git remote 僅允許 -v')
      }
      subcommandArgs = rest
      break
    case 'blame':
      subcommandArgs = await validateGitBlame(rest, context)
      break
    case 'ls-files':
      subcommandArgs = await validateGitLsFiles(rest, context)
      break
    default:
      throw forbidden(`Git 子命令不在唯讀白名單：${subcommand}`)
  }

  await assertPhysicalGitRepository(context.workspace)
  return [
    '--no-pager', '--no-optional-locks', '--literal-pathspecs', '--no-replace-objects',
    '-c', 'core.pager=', '-c', 'core.fsmonitor=false', '-c', 'diff.external=',
    '-c', 'log.showSignature=false', '-c', 'core.excludesFile=',
    '-c', 'core.attributesFile=', subcommand, ...subcommandArgs
  ]
}

async function validateGitStatus(args: readonly string[], context: Context): Promise<readonly string[]> {
  const parsed = parseArguments(args, {
    '--short': {}, '-s': {}, '--branch': {}, '-b': {}, '--porcelain': {},
    '--no-renames': {}, '--ignored': {}
  })
  for (const operand of allOperands(parsed)) await preflightPath(operand, 'either', false, context)
  return args
}

async function validateGitRevisionCommand(
  args: readonly string[],
  context: Context,
  kind: 'log' | 'diff' | 'show'
): Promise<readonly string[]> {
  const common: Record<string, FlagSpec> = {
    '--stat': {}, '--name-only': {}, '--name-status': {}, '-p': {}, '--patch': {},
    '--no-renames': {}
  }
  const specific: Record<string, FlagSpec> = kind === 'log'
    ? {
        '-n': { value: 'integer' }, '--max-count': { value: 'integer' },
        '--decorate': {}, '--graph': {}, '--date-order': {}, '--all': {}, '--follow': {},
        '--oneline': {}
      }
    : kind === 'diff'
      ? {
          '--cached': {}, '--staged': {}, '-w': {}, '-b': {}, '--ignore-all-space': {},
          '--ignore-space-change': {}, '-U': { value: 'integer' },
          '--unified': { value: 'integer' }
        }
      : { '--stat': {}, '--name-only': {}, '--name-status': {} }
  const parsed = parseArguments(args, { ...common, ...specific })
  for (const revision of parsed.positionals) {
    assertGitRevision(revision)
    assertNonSensitivePath(revision)
  }
  const follow = parsed.options.has('--follow')
  for (const operand of parsed.literalOperands) {
    await preflightPath(operand, follow ? 'file' : 'either', true, context)
  }
  if (follow && parsed.literalOperands.length !== 1) {
    throw forbidden('git log --follow 需要一個明確檔案')
  }

  const fixedDiffFlags = ['--no-ext-diff', '--no-textconv']
  return [...fixedDiffFlags, ...args]
}

function validateGitBranch(args: readonly string[]): readonly string[] {
  const parsed = parseArguments(args, {
    '--list': {}, '-a': {}, '--all': {}, '-r': {}, '--remotes': {},
    '-v': {}, '--verbose': {}, '--show-current': {}
  })
  if (allOperands(parsed).length !== 0) throw forbidden('Git branch 僅允許列表或顯示目前分支')
  return args
}

async function validateGitBlame(args: readonly string[], context: Context): Promise<readonly string[]> {
  const parsed = parseArguments(args, {
    '-l': {}, '-n': {}, '-w': {}, '--porcelain': {}, '--line-porcelain': {},
    '-L': { value: 'string' }
  })
  const operands = allOperands(parsed)
  if (operands.length !== 1) throw forbidden('Git blame 只接受一個明確工作區檔案')
  await preflightPath(operands[0] as string, 'file', false, context)
  return args
}

async function validateGitLsFiles(args: readonly string[], context: Context): Promise<readonly string[]> {
  const parsed = parseArguments(args, {
    '--cached': {}, '-c': {}, '--modified': {}, '-m': {}, '--deleted': {}, '-d': {},
    '--others': {}, '-o': {}, '--stage': {}, '-s': {}, '--directory': {}, '--full-name': {}
  })
  for (const operand of allOperands(parsed)) await preflightPath(operand, 'either', false, context)
  return args
}

function assertGitRevision(revision: string): void {
  if (
    !revision ||
    revision.includes(':') ||
    revision.startsWith('/') ||
    revision.split('/').some((segment) => segment === '..') ||
    !/^[A-Za-z0-9_./@~^{}-]+$/u.test(revision)
  ) {
    throw forbidden('Git revision 格式不在唯讀安全子集')
  }
}

async function assertPhysicalGitRepository(workspace: Workspace): Promise<void> {
  const gitPath = path.join(workspace.root, '.git')
  let stat
  try {
    stat = await lstat(gitPath)
  } catch (error) {
    if (nodeErrorCode(error) === 'ENOENT') {
      throw forbidden('工作區根目錄必須包含實體 .git 目錄')
    }
    throw error
  }
  if (stat.isSymbolicLink() || !stat.isDirectory()) {
    throw forbidden('工作區根目錄必須包含實體 .git 目錄')
  }
  const canonical = await realpath(gitPath)
  if (path.dirname(canonical) !== workspace.root) {
    throw forbidden('Git 目錄不得透過連結指向工作區外')
  }
  await assertGitConfigurationCannotExecute(canonical)
}

async function assertGitConfigurationCannotExecute(gitDirectory: string): Promise<void> {
  for (const name of ['config', 'config.worktree']) {
    const configPath = path.join(gitDirectory, name)
    let stat
    try {
      stat = await lstat(configPath)
    } catch (error) {
      if (nodeErrorCode(error) === 'ENOENT') continue
      throw error
    }
    if (stat.isSymbolicLink() || !stat.isFile()) {
      throw forbidden('Git config 必須是 .git 內的實體常規檔案')
    }
    const config = await readFile(configPath, 'utf8')
    if (/^\s*\[(?:filter|include|includeif)(?:\s[^\]]*)?\]/imu.test(config)) {
      throw forbidden('Git repo 不得設定外部 clean filter 或引入未預檢 config')
    }
  }
}

function parseArguments(
  args: readonly string[],
  flags: Readonly<Record<string, FlagSpec>>,
  allowInterspersed = false
): ParsedArguments {
  const options = new Map<string, string | true>()
  const positionals: string[] = []
  const literalOperands: string[] = []
  let literal = false

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index] as string
    if (!literal && arg === '--') {
      literal = true
      continue
    }
    if (literal) {
      literalOperands.push(arg)
      continue
    }
    if (arg.startsWith('-')) {
      if (!allowInterspersed && positionals.length > 0) {
        throw forbidden(`旗標必須位於位置參數之前：${arg}`)
      }
      const spec = flags[arg]
      if (!spec) throw forbidden(`未知或黏合旗標：${arg}`)
      if (!spec.value) {
        options.set(arg, true)
        continue
      }
      const value = requiredValue(args, ++index, arg)
      if (spec.value === 'integer') assertInteger(value)
      if (spec.choices && !spec.choices.includes(value)) {
        throw forbidden(`${arg} 的值不在允許集合`)
      }
      options.set(arg, value)
      continue
    }
    positionals.push(arg)
  }
  return { options, positionals, literalOperands }
}

function allOperands(parsed: ParsedArguments): string[] {
  return [...parsed.positionals, ...parsed.literalOperands]
}

async function preflightPath(
  operand: string,
  kind: 'file' | 'directory' | 'either',
  recursive: boolean,
  context: Context
): Promise<void> {
  await resolveReadonlyPath(context.workspace, operand, kind, {
    recursive,
    ...(context.allowOutsideWorkspace !== undefined
      ? { allowOutsideWorkspace: context.allowOutsideWorkspace }
      : {}),
    ...(context.scanLimit !== undefined ? { scanLimit: context.scanLimit } : {})
  })
}

async function preflightRoot(context: Context): Promise<void> {
  await preflightPath('.', 'directory', true, context)
}

async function native(
  name: string,
  args: readonly string[],
  context: Context
): Promise<ResolvedReadonlyCommand> {
  const executable = await resolveNativeExecutable(name, context)
  return { kind: 'process', executable, args }
}

async function resolveNativeExecutable(name: string, context: Context): Promise<string> {
  const directories = await trustedDirectories(context)
  for (const directory of directories) {
    const candidates = context.platform === 'win32'
      ? [path.join(directory, `${name}.exe`), path.join(directory, `${name}.com`)]
      : [path.join(directory, name)]

    for (const candidate of candidates) {
      let stat
      try {
        stat = await lstat(candidate)
      } catch (error) {
        if (nodeErrorCode(error) === 'ENOENT') continue
        throw error
      }
      if (stat.isSymbolicLink() || !stat.isFile()) continue
      if (context.platform !== 'win32' && (stat.mode & 0o111) === 0) continue
      const canonical = await realpath(candidate)
      if (isWithin(context.workspace.root, canonical)) throw forbidden('執行檔不得位於工作區')
      if ((name === 'npm' || name === 'pip' || name === 'pip3') && context.platform !== 'win32') {
        await rejectScriptWrapper(canonical)
      }
      return canonical
    }
  }
  throw new ToolError('not_found', `可信 PATH 中找不到原生執行檔：${name}`)
}

async function trustedDirectories(context: Context): Promise<string[]> {
  const directories: string[] = []
  const trustedPath = context.trustedPath ?? process.env.PATH ?? ''
  for (const entry of trustedPath.split(path.delimiter)) {
    if (!entry || !path.isAbsolute(entry)) continue
    let canonical: string
    try {
      canonical = await realpath(entry)
    } catch (error) {
      if (nodeErrorCode(error) === 'ENOENT') continue
      throw error
    }
    const stat = await lstat(canonical)
    if (!stat.isDirectory()) continue
    if (isWithin(context.workspace.root, canonical)) {
      throw forbidden('trustedPath 不能包含工作區目錄')
    }
    if (!directories.some((item) => samePath(item, canonical, context.platform))) {
      directories.push(canonical)
    }
  }
  return directories
}

async function rejectScriptWrapper(executable: string): Promise<void> {
  const handle = await open(executable, 'r')
  try {
    const buffer = Buffer.alloc(2)
    const { bytesRead } = await handle.read(buffer, 0, 2, 0)
    if (bytesRead === 2 && buffer.toString('ascii') === '#!') {
      throw forbidden('npm/pip 不得使用包裝腳本或解譯器入口')
    }
  } finally {
    await handle.close()
  }
}

function normalizeCommandName(command: string, platform: NodeJS.Platform): string {
  if (!command || /[\\/]/u.test(command) || path.posix.isAbsolute(command) || path.win32.isAbsolute(command)) {
    throw forbidden('命令必須是白名單名稱，不能指定執行檔路徑')
  }
  let name = platform === 'win32' ? command.toLowerCase() : command
  if (platform === 'win32') {
    if (/\.(?:cmd|bat|ps1|sh|py)$/u.test(name)) throw forbidden('不得執行包裝腳本或巢狀解譯器')
    name = name.replace(/\.(?:exe|com)$/u, '')
  }
  if (!/^[a-z0-9][a-z0-9.+_-]*$/u.test(name)) throw forbidden('命令名稱格式無效')
  return name
}

function expectNoArguments(args: readonly string[]): void {
  if (args.length !== 0) throw forbidden('此命令不接受參數或旗標')
}

function assertEnvironmentName(value: string): void {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/u.test(value)) throw forbidden('printenv 僅接受環境變數名稱')
}

function requiredValue(args: readonly string[], index: number, flag: string): string {
  const value = args[index]
  if (value === undefined) throw forbidden(`${flag} 缺少值`)
  return value
}

function assertInteger(value: string): void {
  if (!/^\d+$/u.test(value) || !Number.isSafeInteger(Number(value))) {
    throw forbidden('數值旗標必須是非負安全整數')
  }
}

function hasFlag(args: readonly string[], flag: string): boolean {
  const marker = args.indexOf('--')
  return args.slice(0, marker === -1 ? args.length : marker).includes(flag)
}

function isWithin(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate)
  return relative === '' || (
    relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative)
  )
}

function samePath(left: string, right: string, platform: NodeJS.Platform): boolean {
  return platform === 'win32' ? left.toLowerCase() === right.toLowerCase() : left === right
}

function nodeErrorCode(error: unknown): string | undefined {
  return typeof error === 'object' && error !== null && 'code' in error
    ? (error as NodeJS.ErrnoException).code
    : undefined
}

function normalizeReadonlyError(error: unknown): ToolError {
  if (error instanceof ToolError) return error
  const code = nodeErrorCode(error)
  if (code === 'ENOENT') return new ToolError('not_found', '命令或工作區路徑不存在')
  if (code === 'EACCES' || code === 'EPERM') return new ToolError('forbidden', '沒有權限存取命令或路徑')
  return new ToolError('internal', '唯讀命令解析或預檢失敗')
}

function forbidden(message: string): ToolError {
  return new ToolError('forbidden', message)
}
