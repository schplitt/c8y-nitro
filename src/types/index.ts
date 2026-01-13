import type { C8YAPIClientOptions } from './apiClient'
import type { C8YManifestOptions } from './manifest'
import type { C8YZipOptions } from './zip'

export type * from './zip'
export type { C8YManifestOptions } from './manifest'
export * from './apiClient'
export * from './roles'

export interface C8yNitroModuleOptions {
  manifest?: C8YManifestOptions
  apiClient?: C8YAPIClientOptions
  zip?: C8YZipOptions
}
