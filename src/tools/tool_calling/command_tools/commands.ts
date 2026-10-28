import type { CommandId } from './types.js'

export interface CommandDefinition {
  program: 'npm' | 'git'
  args: readonly string[]
}

const GIT_GLOBAL_ARGS = [
  '--no-pager',
  '-c', 'core.pager=',
  '-c', 'core.fsmonitor=false',
  '-c', 'diff.external=',
  '-c', 'color.ui=false'
] as const

export const COMMAND_DEFINITIONS: Record<CommandId, CommandDefinition> = {
  npm_test: { program: 'npm', args: ['test'] },
  npm_typecheck: { program: 'npm', args: ['run', 'typecheck'] },
  npm_build: { program: 'npm', args: ['run', 'build'] },
  git_status: {
    program: 'git',
    args: [
      ...GIT_GLOBAL_ARGS,
      'status', '--porcelain=v1', '--branch', '--', '.'
    ]
  },
  git_diff: {
    program: 'git',
    args: [
      ...GIT_GLOBAL_ARGS,
      'diff', '--no-color', '--no-ext-diff', '--no-textconv', '--', '.'
    ]
  }
}

export const COMMAND_IDS = Object.keys(COMMAND_DEFINITIONS) as CommandId[]
