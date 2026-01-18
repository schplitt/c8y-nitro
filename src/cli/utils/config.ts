import { loadConfig, loadDotenv } from 'c12'
import { dirname } from 'pathe'
import type { NitroConfig } from 'nitro/types'
import type { C8yNitroModuleOptions } from '../../types'
import process from 'process'

export interface C8yConfig {
  /**
   * Loaded .env variables
   */
  env: Record<string, string | undefined>
  /**
   * Loaded Nitro config
   */
  nitroConfig: NitroConfig
  /**
   * c8y module options from the config
   */
  c8yOptions: C8yNitroModuleOptions | undefined
  /**
   * Directory containing the config file
   */
  configDir: string
  /**
   * Path to the config file
   */
  configFile: string
}

/**
 * Loads c8y configuration from nitro.config and .env files.
 * Searches in cwd.
 */
export async function loadC8yConfig(): Promise<C8yConfig> {
  const cwd = process.cwd()
  // Load .env and .env.local files
  const env = await loadDotenv({
    cwd,
    fileName: ['.env', '.env.local'],
  })

  // Load nitro config
  const { config, _configFile } = await loadConfig<NitroConfig>({
    configFile: 'nitro.config',
    cwd,
  })

  if (!_configFile) {
    throw new Error(
      'No nitro.config file found. Please ensure you have a valid nitro.config file.',
    )
  }

  const configDir = dirname(_configFile)

  // Extract c8y options from the config
  const c8yOptions = config.c8y as C8yNitroModuleOptions | undefined

  return {
    env,
    nitroConfig: config,
    c8yOptions,
    configDir,
    configFile: _configFile,
  }
}

/**
 * Required environment variables for bootstrap command
 */
export const REQUIRED_BOOTSTRAP_ENV_VARS = [
  'C8Y_BASE_URL',
  'C8Y_DEVELOPMENT_TENANT',
  'C8Y_DEVELOPMENT_USER',
  'C8Y_DEVELOPMENT_PASSWORD',
] as const

export type BootstrapEnvVars = Record<(typeof REQUIRED_BOOTSTRAP_ENV_VARS)[number], string>

/**
 * Validates that all required environment variables are present.
 * @param env - Environment variables object
 * @returns The validated environment variables
 * @throws Error if any required variable is missing
 */
export function validateBootstrapEnv(env: Record<string, string | undefined>): BootstrapEnvVars {
  const missing = REQUIRED_BOOTSTRAP_ENV_VARS.filter((key) => !env[key])

  if (missing.length > 0) {
    throw new Error(
      `Missing required environment variables:\n${missing.map((k) => `  - ${k}`).join('\n')}\n\nPlease set these in your .env or .env.local file.`,
    )
  }

  const endsWithSlash = env.C8Y_BASE_URL!.endsWith('/')
  const baseUrl = endsWithSlash
    ? env.C8Y_BASE_URL!.slice(0, -1)
    : env.C8Y_BASE_URL!

  return {
    C8Y_BASE_URL: baseUrl,
    C8Y_DEVELOPMENT_TENANT: env.C8Y_DEVELOPMENT_TENANT!,
    C8Y_DEVELOPMENT_USER: env.C8Y_DEVELOPMENT_USER!,
    C8Y_DEVELOPMENT_PASSWORD: env.C8Y_DEVELOPMENT_PASSWORD!,
  }
}
