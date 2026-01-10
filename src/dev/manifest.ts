import type { Nitro } from 'nitro/types'
import type { C8YManifest, C8YManifestOptions, Provider } from '../types/manifest'
import { readPackage } from 'pkg-types'
import { GENERATED_LIVENESS_ROUTE, GENERATED_READINESS_ROUTE } from '../runtime/probes'

async function readPackageJsonFieldsForManifest(nitro: Nitro): Promise<C8YManifestOptions & { name: string, version: string, provider: Provider }> {
  nitro.logger.debug(`Reading package file from ${nitro.options.rootDir}`)

  const pkg = await readPackage(nitro.options.rootDir)

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

  nitro.logger.debug(`Found package.json fields for manifest: name=${name}, version=${version}, provider=${JSON.stringify(provider)}`)
  return {
    name,
    version,
    provider,
    contextPath: name,
  }
}

/**
 * Gets service name and context path without building full manifest.
 * Used by API client generation to avoid duplicate manifest creation.
 * @param nitro - Nitro instance
 * @param manifestOptions - Optional manifest configuration for contextPath override
 */
export async function getServiceInfo(
  nitro: Nitro,
  manifestOptions?: C8YManifestOptions,
): Promise<{ serviceName: string, contextPath: string } | undefined> {
  try {
    const pkg = await readPackage(nitro.options.rootDir)
    const pkgName = pkg.name

    if (!pkgName) {
      return undefined
    }

    // Strip scope from package name (e.g., @org/package -> package)
    const serviceName = pkgName.replace(/^@[^/]+\//, '')

    // contextPath: use manifest override or fallback to stripped package name
    const contextPath = manifestOptions?.contextPath ?? serviceName

    return { serviceName, contextPath }
  } catch {
    return undefined
  }
}

export async function createC8yManifest(
  nitro: Nitro,
  options: C8YManifestOptions = {},
): Promise<C8YManifest> {
  const {
    name,
    version,
    provider,
    ...restManifestFields
  } = await readPackageJsonFieldsForManifest(nitro)

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

  const manifest: C8YManifest = {
    ...restManifestFields,
    provider,
    ...probeFields,
    ...options,
    name,
    version,
    apiVersion: 'v2',
  }
  nitro.logger.debug(`Created Cumulocity manifest: ${JSON.stringify(manifest, null, 2)}`)
  return manifest
}
