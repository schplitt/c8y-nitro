import type { Nitro } from 'nitro/types'
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
import { writeBootstrapCredentials } from '../cli/utils/env-file'
import { hashManifest, readManifestCache, writeManifestCache } from './manifestCache'
import process from 'node:process'

const BOOTSTRAP_ENV_VARS = ['C8Y_BOOTSTRAP_TENANT', 'C8Y_BOOTSTRAP_USER', 'C8Y_BOOTSTRAP_PASSWORD'] as const
const DEV_ENV_VARS = ['C8Y_BASEURL', 'C8Y_DEVELOPMENT_TENANT', 'C8Y_DEVELOPMENT_USER', 'C8Y_DEVELOPMENT_PASSWORD'] as const

/**
 * Verifies the microservice on the development tenant and keeps it in sync with
 * the local manifest, bootstrapping (or re-bootstrapping) when needed.
 *
 * Unlike a purely env-var-based check, this always verifies against the tenant
 * when development credentials are available, so it also handles:
 * - the manifest changing between dev restarts (auto-updates a placeholder), and
 * - the application being deleted on the tenant while stale bootstrap env vars
 *   still linger locally (re-creates it).
 *
 * A previously *deployed* microservice (one with an active version) is never
 * overwritten automatically - we only warn about the drift.
 *
 * Runs silently unless a bootstrap/sync was performed or an error occurs.
 * @param nitro - Nitro instance
 */
export async function autoBootstrap(nitro: Nitro): Promise<void> {
  try {
    const rootDir = nitro.options.rootDir

    // Without development credentials we can neither verify nor create anything.
    // The dev plugin already informs the user about missing credentials.
    const missingDevVars = DEV_ENV_VARS.filter((v) => !process.env[v])
    if (missingDevVars.length > 0) {
      return
    }

    const baseUrl = process.env.C8Y_BASEURL!.endsWith('/')
      ? process.env.C8Y_BASEURL!.slice(0, -1)
      : process.env.C8Y_BASEURL!
    const developmentTenant = process.env.C8Y_DEVELOPMENT_TENANT!

    const authHeader = createBasicAuthHeader(
      developmentTenant,
      process.env.C8Y_DEVELOPMENT_USER!,
      process.env.C8Y_DEVELOPMENT_PASSWORD!,
    )

    // Build manifest and derive the identity/hash used for change detection.
    const manifest = await createC8yManifest(rootDir, nitro.options, nitro.logger)
    const target: ManifestCacheTarget = { baseUrl, developmentTenant, name: manifest.name }
    const currentHash = hashManifest(manifest, target)

    // Always verify against the tenant - this catches remote deletion even when
    // bootstrap env vars are still present locally.
    const existingApp = await findMicroserviceByName(baseUrl, manifest.name, authHeader)

    if (!existingApp) {
      // Either never bootstrapped, or the application was removed on the tenant
      // while stale bootstrap env vars linger. Either way, (re-)bootstrap.
      const createdApp = await createMicroservice(baseUrl, manifest, authHeader)
      nitro.logger.debug(`Microservice "${manifest.name}" created (ID: ${createdApp.id})`)
      await finalizeBootstrap(nitro, {
        baseUrl,
        developmentTenant,
        appId: createdApp.id,
        authHeader,
        target,
        manifestHash: currentHash,
        // Freshly created: always (re)write credentials so stale env vars are replaced.
        forceCredentials: true,
      })
      nitro.logger.success(`Auto-bootstrap complete! Microservice "${manifest.name}" created on tenant.`)
      return
    }

    const appId = existingApp.id
    const isRealService = Boolean(existingApp.activeVersionId)
    const cache = await readManifestCache(rootDir)
    const changed = !cache || cache.manifestHash !== currentHash || cache.appId !== appId

    if (changed) {
      if (isRealService) {
        // A real microservice image is deployed - never silently overwrite it.
        nitro.logger.warn(
          `Local manifest for "${manifest.name}" differs from the deployed microservice on the development tenant. `
          + `The running service was left untouched. Redeploy or run \`npx c8y-nitro bootstrap\` to update it explicitly.`,
        )
      } else {
        // Placeholder application - safe to overwrite with the new manifest.
        await updateMicroservice(baseUrl, appId, manifest, authHeader)
        nitro.logger.success(`Auto-bootstrap: updated microservice "${manifest.name}" with changed manifest.`)
      }
    }

    // Ensure we hold valid bootstrap credentials for this application. Refresh
    // them when they're missing locally or when the application ID changed
    // (e.g. it was recreated since we last cached).
    const hasBootstrapCreds = BOOTSTRAP_ENV_VARS.every((v) => process.env[v])
    const appChanged = cache?.appId !== appId
    await finalizeBootstrap(nitro, {
      baseUrl,
      developmentTenant,
      appId,
      authHeader,
      target,
      manifestHash: currentHash,
      forceCredentials: !hasBootstrapCreds || appChanged,
    })
  } catch (error) {
    // Just warn if something fails, don't crash.
    nitro.logger.warn('Auto-bootstrap failed:', error instanceof Error ? error.message : String(error))
  }
}

interface FinalizeBootstrapOptions {
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
 * @param nitro
 * @param opts
 */
async function finalizeBootstrap(nitro: Nitro, opts: FinalizeBootstrapOptions): Promise<void> {
  // Subscribe tenant to application (409 if already subscribed is handled).
  await subscribeToApplication(opts.baseUrl, opts.developmentTenant, opts.appId, opts.authHeader)

  if (opts.forceCredentials) {
    const credentials = await getBootstrapCredentials(opts.baseUrl, opts.appId, opts.authHeader)

    const envFileName = await writeBootstrapCredentials(nitro.options.rootDir, {
      C8Y_BOOTSTRAP_TENANT: credentials.tenant,
      C8Y_BOOTSTRAP_USER: credentials.name,
      C8Y_BOOTSTRAP_PASSWORD: credentials.password,
    })

    // Set in process.env so runtime validation picks them up immediately.
    process.env.C8Y_BOOTSTRAP_TENANT = credentials.tenant
    process.env.C8Y_BOOTSTRAP_USER = credentials.name
    process.env.C8Y_BOOTSTRAP_PASSWORD = credentials.password

    nitro.logger.debug(`Bootstrap credentials written to ${envFileName}`)
  }

  await writeManifestCache(nitro.options.rootDir, {
    manifestHash: opts.manifestHash,
    target: opts.target,
    appId: opts.appId,
  })
}
