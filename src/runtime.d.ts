// Type declarations for the virtual c8y-nitro/runtime module
// This module is generated at runtime by the c8y-nitro module

declare module 'c8y-nitro/runtime' {
  import type { C8YRoles } from 'c8y-nitro/types'

  // Internal runtime config - not exported to prevent external access/modification
  interface C8yRuntimeConfig {
    cache: {
      credentialsTTL: number
    }
  }

  export const c8yRoles: C8YRoles
  export const c8yConfig: C8yRuntimeConfig
}
