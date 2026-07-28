import { defineCommand } from 'citty'
import { consola } from 'consola'
import { createInterface } from 'node:readline/promises'
import process from 'node:process'
import { loadC8yConfig, validateBootstrapEnv } from '../utils/config'
import {
  createBasicAuthHeader,
  getCurrentApplicationSettings,
  getTenantOptionsByCategory,
  upsertTenantOption,
  deleteTenantOption,
} from '../utils/c8y-api'
import type { C8yBootstrapCredentials } from '../utils/c8y-api'
import { readBootstrapCredentialsFromEnv, syncBootstrappedMicroservice } from '../../module/autoBootstrap'
import { createC8yManifest } from '../../module/manifest'

/**
 * Shared request context for the option handlers.
 *
 * Writes and deletes always use the development user (`devAuthHeader`).
 * Reads prefer the bootstrap user (`bootstrapAuthHeader`) when available:
 * encrypted `credentials.*` options are only returned decrypted to the
 * microservice's own (bootstrap/service) user — the development user gets
 * `<<Encrypted>>` back.
 */
interface OptionsContext {
  baseUrl: string
  category: string
  /**
   * Basic Auth header of the development user - used for writes/deletes and
   * for set/unset checks via the Options API.
   */
  devAuthHeader: string
  /**
   * Basic Auth header of the bootstrap user, when credentials are available.
   * Used to read decrypted values via `/application/currentApplication/settings`
   * (the bootstrap user is rejected by the Options API itself).
   */
  bootstrapAuthHeader: string | undefined
  /**
   * Option keys declared in the manifest settings.
   */
  availableKeys: string[]
  /**
   * Current option values from the tenant (decrypted where possible).
   */
  currentOptions: Record<string, string>
}

export default defineCommand({
  meta: {
    name: 'options',
    description: 'Manage tenant options on the development tenant',
  },
  args: {},
  async run() {
    // Step 1: Load config and env
    consola.info('Loading configuration...')
    const { env, nitroConfig, configDir } = await loadC8yConfig()

    // Step 2: Validate required environment variables
    consola.info('Validating environment variables...')
    const envVars = validateBootstrapEnv(env)

    // Step 3: Build manifest to get settings category and keys
    consola.info('Loading manifest...')
    const manifest = await createC8yManifest(configDir, nitroConfig)
    const category = manifest.settingsCategory || manifest.contextPath || manifest.name

    if (!manifest.settings || manifest.settings.length === 0) {
      throw new Error('No settings defined in manifest. Add settings to your c8y.manifest configuration.')
    }

    consola.success(`Using category: ${category}`)

    // Step 4: Create dev-user auth header (used for writes/deletes)
    const devAuthHeader = createBasicAuthHeader(
      envVars.C8Y_DEVELOPMENT_TENANT,
      envVars.C8Y_DEVELOPMENT_USER,
      envVars.C8Y_DEVELOPMENT_PASSWORD,
    )

    // Step 5: Sync the microservice with the local manifest and obtain
    // bootstrap credentials for decrypted reads. This re-bootstraps when the
    // manifest changed (e.g. new settings or the auto-added
    // ROLE_OPTION_MANAGEMENT_READ) and refreshes stale/missing credentials.
    let bootstrapCredentials: C8yBootstrapCredentials | undefined
    try {
      consola.info('Checking microservice on development tenant...')
      bootstrapCredentials = await syncBootstrappedMicroservice({
        rootDir: configDir,
        baseUrl: envVars.C8Y_BASEURL,
        developmentTenant: envVars.C8Y_DEVELOPMENT_TENANT,
        authHeader: devAuthHeader,
        manifest,
        logger: consola,
        env,
      })
    } catch (error) {
      consola.warn(`Could not sync microservice with the development tenant: ${error instanceof Error ? error.message : String(error)}`)
      // Fall back to whatever credentials are already in the env files.
      bootstrapCredentials = readBootstrapCredentialsFromEnv(env)
    }

    const bootstrapAuthHeader = bootstrapCredentials
      ? createBasicAuthHeader(bootstrapCredentials.tenant, bootstrapCredentials.name, bootstrapCredentials.password)
      : undefined

    if (!bootstrapAuthHeader) {
      consola.warn('No bootstrap credentials available - reading with the development user. Encrypted credentials.* options cannot be decrypted.')
    }

    // Step 6: Fetch current options from tenant.
    // The Options API listing (dev user) is authoritative for which keys are
    // set; the current-application settings endpoint (bootstrap user) supplies
    // the decrypted values.
    consola.info('Fetching current tenant options...')
    const currentOptions = await getTenantOptionsByCategory(
      envVars.C8Y_BASEURL,
      category,
      devAuthHeader,
    )

    if (bootstrapAuthHeader) {
      try {
        const decryptedSettings = await getCurrentApplicationSettings(envVars.C8Y_BASEURL, bootstrapAuthHeader)
        // Overlay decrypted values over the listing, and fill in credentials.*
        // keys that some platform versions hide from the category listing.
        for (const [key, value] of Object.entries(decryptedSettings)) {
          if (currentOptions[key] !== undefined || key.startsWith('credentials.')) {
            currentOptions[key] = value
          }
        }
      } catch (error) {
        consola.warn(`Could not read decrypted settings with the bootstrap user: ${error instanceof Error ? error.message : String(error)}`)
      }
    }

    const availableKeys = manifest.settings.map((s) => s.key)
    const setManifestKeys = availableKeys.filter((k) => currentOptions[k] !== undefined)
    consola.success(`Found ${Object.keys(currentOptions).length} options set on tenant (${setManifestKeys.length} of ${availableKeys.length} manifest settings)`)

    const ctx: OptionsContext = {
      baseUrl: envVars.C8Y_BASEURL,
      category,
      devAuthHeader,
      bootstrapAuthHeader,
      availableKeys,
      currentOptions,
    }

    // Main interactive action
    // Step 7: Prompt for action
    const action = await consola.prompt('What do you want to do?', {
      type: 'select',
      options: [
        { label: 'Read option value', value: 'read' },
        { label: 'Update/Create option', value: 'update' },
        { label: 'Delete option(s)', value: 'delete' },
      ],
    })

    if (action === 'read') {
      await handleRead(ctx)
    } else if (action === 'update') {
      await handleUpdate(ctx)
    } else if (action === 'delete') {
      await handleDelete(ctx)
    }
  },
})

/**
 * Handle reading options: prints all options at once (decrypted where
 * possible), then - after the user confirms with Enter - rewrites the output
 * in place with `credentials.*` values masked, so secrets don't linger in the
 * terminal scrollback.
 * @param ctx - The shared options context
 */
async function handleRead(ctx: OptionsContext): Promise<void> {
  const { bootstrapAuthHeader, availableKeys, currentOptions } = ctx

  if (!bootstrapAuthHeader && availableKeys.some((k) => k.startsWith('credentials.'))) {
    consola.warn('Encrypted credentials.* options cannot be read in decrypted form without bootstrap credentials. Run `npx c8y-nitro bootstrap` first.')
  }

  // All manifest settings plus any other options set in the category.
  const keys = [...new Set([...availableKeys, ...Object.keys(currentOptions)])]
  const padWidth = Math.max(...keys.map((k) => k.length))

  const renderLine = (key: string, maskCredentials: boolean): string => {
    const value = currentOptions[key]
    const shownValue = value === undefined
      ? '(not set)'
      : maskCredentials && key.startsWith('credentials.')
        ? '****'
        : value
    const suffix = availableKeys.includes(key) ? '' : ' (not in manifest)'
    return `  ${key.padEnd(padWidth)} = ${shownValue}${suffix}`
  }

  const revealedLines = keys.map((key) => renderLine(key, false))
  process.stdout.write(`${revealedLines.join('\n')}\n`)

  const rl = createInterface({ input: process.stdin, output: process.stdout })
  await rl.question('Press <Enter> to hide credential values...')
  rl.close()

  if (process.stdout.isTTY) {
    // Move the cursor back over the printed block (accounting for wrapped
    // lines) plus the Enter prompt, clear it, and re-print with masked values.
    const columns = process.stdout.columns || 80
    const rowsFor = (line: string): number => Math.max(1, Math.ceil(line.length / columns))
    const rowsToErase = revealedLines.reduce((rows, line) => rows + rowsFor(line), 1)
    process.stdout.write(`\x1B[${rowsToErase}A\x1B[0J`)
    process.stdout.write(`${keys.map((key) => renderLine(key, true)).join('\n')}\n`)
  }
}

/**
 * Handle updating options (with loop for multiple updates)
 * @param ctx - The shared options context
 */
async function handleUpdate(ctx: OptionsContext): Promise<void> {
  const { baseUrl, category, devAuthHeader, bootstrapAuthHeader, availableKeys, currentOptions } = ctx
  let continueUpdating = true

  while (continueUpdating) {
    const key = await consola.prompt('Select option to update:', {
      type: 'select',
      options: availableKeys.map((k) => ({
        label: currentOptions[k] !== undefined
          ? `${k} (current: ${currentOptions[k]})`
          // Without bootstrap credentials we can't tell whether a credentials.*
          // option is set - with them, absence really means "not set".
          : k.startsWith('credentials.') && !bootstrapAuthHeader
            ? `${k} (current: unknown)`
            : `${k} (not set)`,
        value: k,
      })),
      cancel: 'reject',
    })

    const currentValue = currentOptions[key]
    const newValue = await consola.prompt('Enter new value:', {
      type: 'text',
      default: currentValue,
      cancel: 'reject',
    })

    consola.info(`Updating option: ${key}`)

    await upsertTenantOption(
      baseUrl,
      category,
      key,
      newValue,
      devAuthHeader,
    )

    // Update local cache
    currentOptions[key] = newValue

    consola.success(`Option '${key}' updated successfully`)

    const updateAnother = await consola.prompt('Update another option?', {
      type: 'confirm',
      initial: false,
      cancel: 'reject',
    })

    if (!updateAnother) {
      continueUpdating = false
    }
  }
}

/**
 * Handle deleting multiple options
 * @param ctx - The shared options context
 */
async function handleDelete(ctx: OptionsContext): Promise<void> {
  const { baseUrl, category, devAuthHeader, bootstrapAuthHeader, availableKeys, currentOptions } = ctx

  // Same set-detection as handleRead: with bootstrap credentials we know which
  // keys are set; without them, credentials.* keys are always offered.
  const allKeys = bootstrapAuthHeader
    ? availableKeys.filter((k) => currentOptions[k] !== undefined)
    : [
        ...availableKeys.filter((k) => !k.startsWith('credentials.') && currentOptions[k] !== undefined),
        ...availableKeys.filter((k) => k.startsWith('credentials.')),
      ]

  if (allKeys.length === 0) {
    consola.warn('No options are currently set')
    return
  }

  const keysToDelete = await consola.prompt('Select option(s) to delete:', {
    type: 'multiselect',
    options: allKeys,
    required: true,
    cancel: 'reject',
  })

  consola.info(`Deleting ${keysToDelete.length} option(s)...`)

  for (const key of keysToDelete) {
    consola.info(`Deleting option: ${key}`)
    await deleteTenantOption(baseUrl, category, key, devAuthHeader)
    delete currentOptions[key]
    consola.success(`✓ Deleted: ${key}`)
  }

  consola.success('Delete operation completed')
}
