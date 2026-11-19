// Files used to emulate imported runtime values in Nitro runtime
// Necessary if virtual values are used by e.g. utils
// Loose version of the types generated in module/runtime.ts
// (`readonly string[]` instead of the literal tuple)

declare module 'c8y-nitro/runtime' {
  import type { C8YRoles, C8YManifest } from 'c8y-nitro/types'

  export const c8yRoles: C8YRoles
  export const c8yTenantOptionKeys: readonly string[]

  export const c8yManifest: C8YManifest
}
