// Files used to emulate imported runtime values in Nitro runtime
// Necessary if virtual values are used by e.g. utils
// Should match the generated types in module/runtime.ts

// Type declaration for Nitro's internal virtual tasks module.
// This virtual module is injected by Nitro's bundler at build time and maps task
// names to their lazy-import resolver functions. Importing it directly (instead
// of going through runTask()) lets us call handlers without Nitro's name-only
// deduplication lock, enabling the same task name to run concurrently with
// different payloads. See: https://github.com/nitrojs/nitro/issues/3448
declare module '#nitro/virtual/tasks' {
  import type { Task } from 'nitro/types'

  interface VirtualTaskDef {
    meta: { description?: string | undefined }
    resolve?: () => Promise<Task>
  }

  export const scheduledTasks: false | Array<{ cron: string, tasks: string[] }>
  export const tasks: Record<string, VirtualTaskDef>
}

declare module 'c8y-nitro/runtime' {
  import type { C8YRoles, C8YManifest } from 'c8y-nitro/types'

  export const c8yRoles: C8YRoles
  export const c8yTenantOptionKeys: readonly string[]

  export const c8yManifest: C8YManifest
}
