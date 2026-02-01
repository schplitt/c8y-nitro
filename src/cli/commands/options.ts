import { defineCommand } from 'citty'
import { consola } from 'consola'
import { loadC8yConfig, validateBootstrapEnv } from '../utils/config'
import {
  createBasicAuthHeader,
  getTenantOptionsByCategory,
  getTenantOption,
  updateTenantOption,
  deleteTenantOption,
} from '../utils/c8y-api'
import { createC8yManifest } from '../../module/manifest'

export default defineCommand({
  meta: {
    name: 'options',
    description: 'Manage tenant options on the development tenant',
  },
  args: {},
  async run() {
    // Step 1: Load config and env
    consola.info('Loading configuration...')
    const { env, c8yOptions, configDir } = await loadC8yConfig()

    // Step 2: Validate required environment variables
    consola.info('Validating environment variables...')
    const envVars = validateBootstrapEnv(env)

    // Step 3: Build manifest to get settings category and keys
    consola.info('Loading manifest...')
    const manifest = await createC8yManifest(configDir, c8yOptions?.manifest)
    const category = manifest.settingsCategory || manifest.contextPath || manifest.name

    if (!manifest.settings || manifest.settings.length === 0) {
      throw new Error('No settings defined in manifest. Add settings to your c8y.manifest configuration.')
    }

    consola.success(`Using category: ${category}`)

    // Step 4: Create auth header
    const authHeader = createBasicAuthHeader(
      envVars.C8Y_DEVELOPMENT_TENANT,
      envVars.C8Y_DEVELOPMENT_USER,
      envVars.C8Y_DEVELOPMENT_PASSWORD,
    )

    // Step 5: Fetch current options from tenant
    consola.info('Fetching current tenant options...')
    const currentOptions = await getTenantOptionsByCategory(
      envVars.C8Y_BASEURL,
      category,
      authHeader,
    )

    const availableKeys = manifest.settings.map((s) => s.key)
    consola.success(`Found ${Object.keys(currentOptions).length} options set on tenant`)

    // Main interactive loop
    let continueLoop = true
    while (continueLoop) {
      // Step 6: Prompt for action
      const action = await consola.prompt('What do you want to do?', {
        type: 'select',
        options: [
          { label: 'Read option value', value: 'read' },
          { label: 'Update/Create option', value: 'update' },
          { label: 'Delete option(s)', value: 'delete' },
        ],
      })

      if (action === 'read') {
        await handleRead(envVars.C8Y_BASEURL, category, authHeader, availableKeys, currentOptions)
        continueLoop = false
      } else if (action === 'update') {
        await handleUpdate(envVars.C8Y_BASEURL, category, authHeader, availableKeys, currentOptions)
        continueLoop = false
      } else if (action === 'delete') {
        await handleDelete(envVars.C8Y_BASEURL, category, authHeader, availableKeys, currentOptions)
        continueLoop = false
      }
    }
  },
})

/**
 * Handle reading a single option
 * @param baseUrl - The Cumulocity base URL
 * @param category - The tenant option category
 * @param authHeader - The Basic Auth header
 * @param availableKeys - List of available option keys
 * @param currentOptions - Current option values from tenant
 */
async function handleRead(
  baseUrl: string,
  category: string,
  authHeader: string,
  availableKeys: string[],
  currentOptions: Record<string, string>,
): Promise<void> {
  // Regular keys that are set
  const setKeys = availableKeys.filter((k) => !k.startsWith('credentials.') && currentOptions[k] !== undefined)
  // Credentials keys (always included as we can't tell if they're set)
  const credentialsKeys = availableKeys.filter((k) => k.startsWith('credentials.'))
  const allKeys = [...setKeys, ...credentialsKeys]

  if (allKeys.length === 0) {
    consola.warn('No options are currently set')
    return
  }

  const key = await consola.prompt('Select option to read:', {
    type: 'select',
    options: allKeys.map((k) => ({
      label: k.startsWith('credentials.') ? `${k} (unknown)` : k,
      value: k,
    })),
    cancel: 'reject',
  })

  consola.info(`Reading option: ${key}`)

  try {
    const apiKey = key.startsWith('credentials.') ? key.replace(/^credentials\./, '') : key
    const value = await getTenantOption(baseUrl, category, apiKey, authHeader)

    if (value === undefined) {
      consola.warn(`Option '${key}' is not set`)
    } else {
      consola.success(`Value: ${value}`)
    }
  } catch (error: any) {
    if (error?.status === 404) {
      consola.warn(`Option '${key}' is not set`)
    } else {
      throw error
    }
  }
}

/**
 * Handle updating options (with loop for multiple updates)
 * @param baseUrl - The Cumulocity base URL
 * @param category - The tenant option category
 * @param authHeader - The Basic Auth header
 * @param availableKeys - List of available option keys
 * @param currentOptions - Current option values from tenant
 */
async function handleUpdate(
  baseUrl: string,
  category: string,
  authHeader: string,
  availableKeys: string[],
  currentOptions: Record<string, string>,
): Promise<void> {
  let continueUpdating = true

  while (continueUpdating) {
    const key = await consola.prompt('Select option to update:', {
      type: 'select',
      options: availableKeys.map((k) => ({
        label: currentOptions[k] !== undefined
          ? `${k} (current: ${currentOptions[k]})`
          : k.startsWith('credentials.')
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

    const apiKey = key.replace(/^credentials\./, '')
    await updateTenantOption(baseUrl, category, apiKey, newValue, authHeader)

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
 * @param baseUrl - The Cumulocity base URL
 * @param category - The tenant option category
 * @param authHeader - The Basic Auth header
 * @param availableKeys - List of available option keys
 * @param currentOptions - Current option values from tenant
 */
async function handleDelete(
  baseUrl: string,
  category: string,
  authHeader: string,
  availableKeys: string[],
  currentOptions: Record<string, string>,
): Promise<void> {
  // Regular keys that are set
  const setKeys = availableKeys.filter((k) => !k.startsWith('credentials.') && currentOptions[k] !== undefined)
  // Credentials keys (always included as we can't tell if they're set)
  const credentialsKeys = availableKeys.filter((k) => k.startsWith('credentials.'))
  const allKeys = [...setKeys, ...credentialsKeys]

  if (allKeys.length === 0) {
    consola.warn('No options are currently set')
    return
  }

  const keysToDelete = await consola.prompt('Select option(s) to delete:', {
    type: 'multiselect',
    options: allKeys,
    required: false,
    cancel: 'reject',
  })
  if (keysToDelete.length === 0) {
    consola.warn('No options selected')
    return
  }

  consola.info(`Deleting ${keysToDelete.length} option(s)...`)

  for (const key of keysToDelete) {
    consola.info(`Deleting option: ${key}`)
    const apiKey = key.startsWith('credentials.') ? key.replace(/^credentials\./, '') : key
    await deleteTenantOption(baseUrl, category, apiKey, authHeader)
    consola.success(`✓ Deleted: ${key}`)
  }

  consola.success('Delete operation completed')
}
