import type { C8YManifest } from '../types/manifest'
import { createHash } from 'node:crypto'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { join } from 'node:path'

/**
 * Directory (inside the project's `node_modules`) where c8y-nitro persists
 * local dev state such as the last-synced manifest hash. Lives in
 * `node_modules` so it is naturally gitignored and scoped per-checkout.
 */
const CACHE_DIR_SEGMENTS = ['node_modules', '.c8y-nitro']
const CACHE_FILE_NAME = 'bootstrap-state.json'
const CACHE_SCHEMA_VERSION = 1

/**
 * Identifies the deployment target a cache entry belongs to. If any of these
 * change (e.g. the developer points at a different tenant), the previously
 * cached manifest hash must no longer be considered a match.
 */
export interface ManifestCacheTarget {
  baseUrl: string
  developmentTenant: string
  name: string
}

/**
 * Persisted state describing what c8y-nitro last synced to the development
 * tenant, used to detect manifest changes across dev restarts.
 */
export interface ManifestCacheState {
  schemaVersion: number
  /** sha256 over the manifest + target identity. */
  manifestHash: string
  target: ManifestCacheTarget
  /** ID of the application we last synced against. */
  appId: string
}

function getCacheDir(rootDir: string): string {
  return join(rootDir, ...CACHE_DIR_SEGMENTS)
}

function getCacheFile(rootDir: string): string {
  return join(getCacheDir(rootDir), CACHE_FILE_NAME)
}

/**
 * Deterministically serialize a value with object keys sorted, so structurally
 * equal manifests always produce the same string (and thus the same hash)
 * regardless of key insertion order.
 * @param value - The value to stringify
 */
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value) ?? 'null'
  }
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(',')}]`
  }
  const entries = Object.keys(value as Record<string, unknown>)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableStringify((value as Record<string, unknown>)[key])}`)
  return `{${entries.join(',')}}`
}

/**
 * Compute a stable hash over the manifest and the deployment target it will be
 * synced to. Folding the target in means switching tenant/baseURL invalidates
 * the cached hash even if the manifest itself is unchanged.
 * @param manifest - The generated Cumulocity manifest
 * @param target - The deployment target identity
 */
export function hashManifest(manifest: C8YManifest, target: ManifestCacheTarget): string {
  const payload = stableStringify({ manifest, target })
  return createHash('sha256').update(payload).digest('hex')
}

/**
 * Read the persisted bootstrap state, or `null` when absent, unreadable, or
 * from an incompatible schema version.
 * @param rootDir - Project root directory (containing `node_modules`)
 */
export async function readManifestCache(rootDir: string): Promise<ManifestCacheState | null> {
  try {
    const content = await readFile(getCacheFile(rootDir), 'utf-8')
    const state = JSON.parse(content) as ManifestCacheState
    if (state.schemaVersion !== CACHE_SCHEMA_VERSION) {
      return null
    }
    return state
  } catch {
    // Missing or corrupt cache is not an error - just means "no known state".
    return null
  }
}

/**
 * Persist the bootstrap state for future dev restarts.
 * @param rootDir - Project root directory (containing `node_modules`)
 * @param state - The state to persist (schema version is filled in automatically)
 */
export async function writeManifestCache(
  rootDir: string,
  state: Omit<ManifestCacheState, 'schemaVersion'>,
): Promise<void> {
  const dir = getCacheDir(rootDir)
  await mkdir(dir, { recursive: true })
  const payload: ManifestCacheState = { schemaVersion: CACHE_SCHEMA_VERSION, ...state }
  await writeFile(getCacheFile(rootDir), JSON.stringify(payload, null, 2), 'utf-8')
}
