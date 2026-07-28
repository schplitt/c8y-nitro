import type { Nitro } from 'nitro/types'
import type { C8YManifest } from '../types/manifest'
import type { ManifestCacheTarget } from './manifestCache'
import { createC8yManifest } from './manifest'
import {
  createBasicAuthHeader,
  createMicroservice,
  findMicroserviceByName,
  getBootstrapCredentials,
  subscribeToApplication,
  updateMicroservice,
} from '../cli/utils/c8y-api'
import type { C8yBootstrapCredentials } from '../cli/utils/c8y-api'
import { writeBootstrapCredentials } from '../cli/utils/env-file'
import { hashManifest, readManifestCache, writeManifestCache } from './manifestCache'
import process from 'node:process'

const BOOTSTRAP_ENV_VARS = ['C8Y_BOOTSTRAP_TENANT', 'C8Y_BOOTSTRAP_USER', 'C8Y_BOOTSTRAP_PASSWORD'] as const
const DEV_ENV_VARS = ['C8Y_BASEURL', 'C8Y_DEVELOPMENT_TENANT', 'C8Y_DEVELOPMENT_USER', 'C8Y_DEVELOPMENT_PASSWORD'] as const

/**
 * Minimal logger contract for {@link syncBootstrappedMicroservice}. Satisfied by
 * both `nitro.logger` and the CLI's `consola` instance.
 */
export interface BootstrapSyncLogger {
  debug: (message: string) => void
  success: (message: string) => void
  warn: (message: string) => void
}

/**
 * Reads bootstrap credentials from an env object (e.g. a loaded `.env` file or
 * `process.env`). Returns `undefined` unless all three variables are present.
 * @param env - Environment variables object
 */
export function readBootstrapCredentialsFromEnv(
  env: Record<string, string | undefined>,
): C8yBootstrapCredentials | undefined {
  const tenant = env.C8Y_BOOTSTRAP_TENANT
  const name = env.C8Y_BOOTSTRAP_USER
  const password = env.C8Y_BOOTSTRAP_PASSWORD

  if (!tenant || !name || !password) {
    return undefined
  }

  return { tenant, name, password }
}

export interface SyncBootstrappedMicroserviceOptions {
  /**
   * Project root directory (containing `node_modules` and the env files).
   */
  rootDir: string
  /**
   * Cumulocity base URL without trailing slash.
   */
  baseUrl: string
  /**
   * The development tenant id.
   */
  developmentTenant: string
  /**
   * Basic Auth header of the development user.
   */
  authHeader: string
  /**
   * The locally generated manifest to sync against the tenant.
   */
  manifest: C8YManifest
  logger: BootstrapSyncLogger
  /**
   * Env vars used to detect already-present bootstrap credentials.
   * Defaults to `process.env` (the CLI passes its loaded `.env` instead).
   */
  env?: Record<string, string | undefined>
}

/**
 * Verifies the microservice on the development tenant and keeps it in sync with
 * the local manifest, bootstrapping (or re-bootstrapping) when needed.
 *
 * Unlike a purely env-var-based check, this always verifies against the tenant,
 * so it also handles:
 * - the manifest changing between runs (auto-updates a placeholder), and
 * - the application being deleted on the tenant while stale bootstrap env vars
 *   still linger locally (re-creates it).
 *
 * A previously *deployed* microservice (one with an active version) is never
 * overwritten automatically - we only warn about the drift.
 *
 * @param options - See {@link SyncBootstrappedMicroserviceOptions}
 * @returns The bootstrap credentials for the microservice (freshly fetched when
 * they were refreshed, otherwise the ones already present in `env`)
 */
export async function syncBootstrappedMicroservice(
  options: SyncBootstrappedMicroserviceOptions,
): Promise<C8yBootstrapCredentials | undefined> {
  const { rootDir, baseUrl, developmentTenant, authHeader, manifest, logger } = options
  const env = options.env ?? process.env

  // Derive the identity/hash used for change detection.
  const target: ManifestCacheTarget = { baseUrl, developmentTenant, name: manifest.name }
  const currentHash = hashManifest(manifest, target)

  // Always verify against the tenant - this catches remote deletion even when
  // bootstrap env vars are still present locally.
  const existingApp = await findMicroserviceByName(baseUrl, manifest.name, authHeader)

  if (!existingApp) {
    // Either never bootstrapped, or the application was removed on the tenant
    // while stale bootstrap env vars linger. Either way, (re-)bootstrap.
    const createdApp = await createMicroservice(baseUrl, manifest, authHeader)
    logger.debug(`Microservice "${manifest.name}" created (ID: ${createdApp.id})`)
    const credentials = await finalizeBootstrap({
      rootDir,
      logger,
      baseUrl,
      developmentTenant,
      appId: createdApp.id,
      authHeader,
      target,
      manifestHash: currentHash,
      // Freshly created: always (re)write credentials so stale env vars are replaced.
      forceCredentials: true,
    })
    logger.success(`Microservice "${manifest.name}" created on the development tenant.`)
    return credentials
  }

  const appId = existingApp.id
  const isRealService = Boolean(existingApp.activeVersionId)
  const cache = await readManifestCache(rootDir)
  const changed = !cache || cache.manifestHash !== currentHash || cache.appId !== appId

  if (changed) {
    if (isRealService) {
      // A real microservice image is deployed - never silently overwrite it.
      logger.warn(
        `Local manifest for "${manifest.name}" differs from the deployed microservice on the development tenant. `
        + `The running service was left untouched. Redeploy or run \`npx c8y-nitro bootstrap\` to update it explicitly.`,
      )
    } else {
      // Placeholder application - safe to overwrite with the new manifest.
      await updateMicroservice(baseUrl, appId, manifest, authHeader)
      logger.success(`Updated microservice "${manifest.name}" with changed manifest.`)
    }
  }

  // Ensure we hold valid bootstrap credentials for this application. Refresh
  // them when they're missing locally or when the application ID changed
  // (e.g. it was recreated since we last cached).
  const hasBootstrapCreds = BOOTSTRAP_ENV_VARS.every((v) => env[v])
  const appChanged = cache?.appId !== appId
  const refreshedCredentials = await finalizeBootstrap({
    rootDir,
    logger,
    baseUrl,
    developmentTenant,
    appId,
    authHeader,
    target,
    manifestHash: currentHash,
    forceCredentials: !hasBootstrapCreds || appChanged,
  })

  return refreshedCredentials ?? readBootstrapCredentialsFromEnv(env)
}

/**
 * Verifies the microservice on the development tenant during dev startup.
 * Runs silently unless a bootstrap/sync was performed or an error occurs.
 * @param nitro - Nitro instance
 */
export async function autoBootstrap(nitro: Nitro): Promise<void> {
  try {
    // Without development credentials we can neither verify nor create anything.
    // The dev plugin already informs the user about missing credentials.
    const missingDevVars = DEV_ENV_VARS.filter((v) => !process.env[v])
    if (missingDevVars.length > 0) {
      return
    }

    const baseUrl = process.env.C8Y_BASEURL!.endsWith('/')
      ? process.env.C8Y_BASEURL!.slice(0, -1)
      : process.env.C8Y_BASEURL!

    const authHeader = createBasicAuthHeader(
      process.env.C8Y_DEVELOPMENT_TENANT!,
      process.env.C8Y_DEVELOPMENT_USER!,
      process.env.C8Y_DEVELOPMENT_PASSWORD!,
    )

    const manifest = await createC8yManifest(nitro.options.rootDir, nitro.options, nitro.logger)

    await syncBootstrappedMicroservice({
      rootDir: nitro.options.rootDir,
      baseUrl,
      developmentTenant: process.env.C8Y_DEVELOPMENT_TENANT!,
      authHeader,
      manifest,
      logger: nitro.logger,
    })
  } catch (error) {
    // Just warn if something fails, don't crash.
    nitro.logger.warn('Auto-bootstrap failed:', error instanceof Error ? error.message : String(error))
  }
}

interface FinalizeBootstrapOptions {
  rootDir: string
  logger: BootstrapSyncLogger
  baseUrl: string
  developmentTenant: string
  appId: string
  authHeader: string
  target: ManifestCacheTarget
  manifestHash: string
  /**
   * When true, (re)fetch bootstrap credentials and write them to the env file.
   */
  forceCredentials: boolean
}

/**
 * Subscribe the tenant, optionally (re)write bootstrap credentials, and persist
 * the synced state to the local cache.
 * @param opts - Bootstrap finalization inputs
 * @returns The freshly fetched credentials when `forceCredentials` was set
 */
async function finalizeBootstrap(opts: FinalizeBootstrapOptions): Promise<C8yBootstrapCredentials | undefined> {
  // Subscribe tenant to application (409 if already subscribed is handled).
  await subscribeToApplication(opts.baseUrl, opts.developmentTenant, opts.appId, opts.authHeader)

  let credentials: C8yBootstrapCredentials | undefined

  if (opts.forceCredentials) {
    credentials = await getBootstrapCredentials(opts.baseUrl, opts.appId, opts.authHeader)

    const envFileName = await writeBootstrapCredentials(opts.rootDir, {
      C8Y_BOOTSTRAP_TENANT: credentials.tenant,
      C8Y_BOOTSTRAP_USER: credentials.name,
      C8Y_BOOTSTRAP_PASSWORD: credentials.password,
    })

    // Set in process.env so runtime validation picks them up immediately.
    process.env.C8Y_BOOTSTRAP_TENANT = credentials.tenant
    process.env.C8Y_BOOTSTRAP_USER = credentials.name
    process.env.C8Y_BOOTSTRAP_PASSWORD = credentials.password

    opts.logger.debug(`Bootstrap credentials written to ${envFileName}`)
  }

  await writeManifestCache(opts.rootDir, {
    manifestHash: opts.manifestHash,
    target: opts.target,
    appId: opts.appId,
  })

  return credentials
}
