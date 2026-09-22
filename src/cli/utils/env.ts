import { statSync } from 'node:fs'
import { resolve } from 'pathe'
import { setupDotenv } from 'c12'
import process from 'node:process'

/**
 * The project's own env files. Always loaded last so they override any
 * additional (e.g. monorepo-root) env files configured via `c8y.envFile`.
 */
const LOCAL_ENV_FILES = ['.env', '.env.local'] as const

/**
 * Env vars that also accept a `C8Y_NITRO_`-prefixed variant
 * (e.g. `C8Y_NITRO_DEVELOPMENT_USER`). The prefixed variant takes precedence,
 * so shared env files can carry c8y-nitro credentials without clashing with
 * other tools that read the generic `C8Y_*` names.
 */
export const PREFIXABLE_ENV_VARS = [
  'C8Y_BASEURL',
  'C8Y_DEVELOPMENT_TENANT',
  'C8Y_DEVELOPMENT_USER',
  'C8Y_DEVELOPMENT_PASSWORD',
] as const

/**
 * Maps a `C8Y_*` variable name to its `C8Y_NITRO_*` variant.
 * @param name - Unprefixed variable name (e.g. `C8Y_DEVELOPMENT_USER`)
 */
export function toPrefixedEnvVar(name: string): string {
  return name.replace(/^C8Y_/, 'C8Y_NITRO_')
}

/**
 * Builds the ordered list of env files to load. Later entries override earlier
 * ones, so configured extra files (monorepo root) come first and the project's
 * own `.env`/`.env.local` last.
 *
 * Extra entries may point at a file (`../../.env`) or a directory (`../..`,
 * expanded to its `.env` and `.env.local`).
 *
 * @param cwd - Directory that relative entries are resolved against
 * @param envFile - Extra env file(s) or directory(ies) from `c8y.envFile`
 */
export function resolveEnvFileNames(cwd: string, envFile?: string | string[]): string[] {
  const extraEntries = typeof envFile === 'string' ? [envFile] : envFile ?? []

  const extraFiles = extraEntries.flatMap((entry) => {
    const resolved = resolve(cwd, entry)
    if (statSync(resolved, { throwIfNoEntry: false })?.isDirectory()) {
      return LOCAL_ENV_FILES.map((fileName) => resolve(resolved, fileName))
    }
    return [resolved]
  })

  return [...extraFiles, ...LOCAL_ENV_FILES]
}

/**
 * Applies `C8Y_NITRO_*` variants onto their unprefixed `C8Y_*` counterparts
 * (see {@link PREFIXABLE_ENV_VARS}). Mutates `env` in place; a set prefixed
 * variant always wins over the unprefixed value.
 * @param env - Environment variables object (e.g. `process.env` or a loaded `.env`)
 */
export function applyC8yNitroEnvVars(env: Record<string, string | undefined>): void {
  for (const name of PREFIXABLE_ENV_VARS) {
    const prefixed = env[toPrefixedEnvVar(name)]
    if (prefixed) {
      env[name] = prefixed
    }
  }
}

/**
 * Loads the configured env files into `process.env` (existing real environment
 * variables are never overridden) and resolves `C8Y_NITRO_*` variants.
 * Used during Nitro dev mode, where only the project's own env files would be
 * picked up otherwise.
 * @param rootDir - Project root directory
 * @param envFile - Extra env file(s)/directory(ies) from `c8y.envFile`
 */
export async function setupC8yDevEnv(rootDir: string, envFile?: string | string[]): Promise<void> {
  await setupDotenv({
    cwd: rootDir,
    fileName: resolveEnvFileNames(rootDir, envFile),
  })
  applyC8yNitroEnvVars(process.env)
}
