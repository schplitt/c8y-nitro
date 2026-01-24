import type { Nitro } from 'nitro/types'
import type { C8YManifest, C8YManifestOptions, Provider } from '../types/manifest'
import { readPackage } from 'pkg-types'
import { GENERATED_LIVENESS_ROUTE, GENERATED_READINESS_ROUTE } from './constants'
import type { ConsolaInstance } from 'consola'

interface PackageJsonFields {
  name: string
  version: string
  provider: Provider
  contextPath: string
}

async function readPackageJsonFieldsForManifest(
  rootDir: string,
  logger?: ConsolaInstance,
): Promise<PackageJsonFields> {
  logger?.debug(`Reading package file from ${rootDir}`)

  const pkg = await readPackage(rootDir)

  // Strip scope from package name (e.g., @org/package -> package)
  const name = pkg.name?.replace(/^@[^/]+\//, '')
  const version = pkg.version

  // Extract provider information with fallbacks
  const author = pkg.author
  const authorName = typeof author === 'string' ? author : author?.name
  const authorEmail = typeof author === 'string' ? undefined : author?.email
  const authorUrl = typeof author === 'string' ? undefined : author?.url

  if (!name || !version || !authorName) {
    throw new Error('package.json must contain name, version, and author name fields')
  }

  const support = typeof pkg.bugs === 'string' ? pkg.bugs : pkg.bugs?.url ?? pkg.bugs?.email

  const provider: Provider = {
    name: authorName ?? name,
    domain: authorUrl ?? pkg.homepage,
    support: support ?? authorEmail,
  }

  logger?.debug(`Found package.json fields for manifest: name=${name}, version=${version}, provider=${JSON.stringify(provider)}`)
  return {
    name,
    version,
    provider,
    contextPath: name,
  }
}

/**
 * Creates a Cumulocity manifest from rootDir and options.
 * Standalone function that can be used by CLI or module.
 * @param rootDir - Directory containing package.json
 * @param options - Manifest options
 * @param logger - Optional logger for debug output
 */
export async function createC8yManifest(
  rootDir: string,
  options: C8YManifestOptions = {},
  logger?: ConsolaInstance,
): Promise<C8YManifest> {
  // TODO: force type to be microservice and remove from manifest options

  const {
    name,
    version,
    provider,
    ...restManifestFields
  } = await readPackageJsonFieldsForManifest(rootDir, logger)

  // Build probe configuration - only add httpGet if not defined by user
  const probeFields: Partial<Pick<C8YManifest, 'livenessProbe' | 'readinessProbe'>> = {}

  // Add liveness probe httpGet if not defined by user (keep other probe settings)
  if (!options.livenessProbe?.httpGet) {
    probeFields.livenessProbe = {
      ...options.livenessProbe,
      httpGet: {
        path: GENERATED_LIVENESS_ROUTE,
      },
    }
  }

  // Add readiness probe httpGet if not defined by user (keep other probe settings)
  if (!options.readinessProbe?.httpGet) {
    probeFields.readinessProbe = {
      ...options.readinessProbe,
      httpGet: {
        path: GENERATED_READINESS_ROUTE,
      },
    }
  }

  const key = `${name}-key`

  const manifest: C8YManifest = {
    ...restManifestFields,
    provider,
    ...probeFields,
    ...options,
    name,
    version,
    apiVersion: 'v2',
    key,
  }
  logger?.debug(`Created Cumulocity manifest: ${JSON.stringify(manifest, null, 2)}`)
  return manifest
}

/**
 * Creates a Cumulocity manifest from a Nitro instance.
 * Convenience wrapper for use in the Nitro module.
 * @param nitro - The Nitro instance
 */
export async function createC8yManifestFromNitro(
  nitro: Nitro,
): Promise<C8YManifest> {
  return createC8yManifest(nitro.options.rootDir, nitro.options.c8y?.manifest, nitro.logger)
}
