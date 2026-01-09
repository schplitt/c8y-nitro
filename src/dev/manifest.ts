import type { Nitro } from 'nitro/types'
import type { C8YManifest, C8YManifestOptions, Provider } from '../types/manifest'
import { readPackage } from 'pkg-types'

async function readPackageJsonFieldsForManifest(nitro: Nitro): Promise<C8YManifestOptions & { name: string, version: string, provider: Provider }> {
  nitro.logger.debug(`Reading package file from ${nitro.options.rootDir}`)

  const pkg = await readPackage(nitro.options.rootDir)

  const name = pkg.name
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

export async function createC8yManifest(nitro: Nitro, options: C8YManifestOptions = {}): Promise<C8YManifest> {
  const {
    name,
    version,
    provider,
    ...restManifestFields
  } = await readPackageJsonFieldsForManifest(nitro)

  const manifest: C8YManifest = {
    ...restManifestFields,
    provider,
    ...options,
    name,
    version,
    apiVersion: 'v2',
  }
  nitro.logger.debug(`Created Cumulocity manifest: ${JSON.stringify(manifest, null, 2)}`)
  return manifest
}
