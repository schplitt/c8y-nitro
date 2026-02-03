// Files used to emulate imported runtime values in Nitro runtime
// Necessary if virtual values are used by e.g. utils
// Should match the generated types in module/runtime.ts

declare module 'c8y-nitro/runtime' {
  import type { C8YRoles } from 'c8y-nitro/types'

  export const c8yRoles: C8YRoles
  export const c8yTenantOptionKeys: readonly string[]
}
