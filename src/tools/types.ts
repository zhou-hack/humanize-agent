import type { ToolDefinition } from './tool_calling/types.js'

export interface LoadedBuiltin {
  readonly tools: readonly ToolDefinition[]
  readonly system?: string
  close(): Promise<void>
}

export interface BuiltinWarningHandler {
  (message: string): void
}
