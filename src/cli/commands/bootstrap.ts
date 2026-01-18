import { defineCommand } from 'citty'
import { consola } from 'consola'
import { loadC8yConfig, validateBootstrapEnv } from '../utils/config'
import {
  createBasicAuthHeader,
  createMicroservice,
  findMicroserviceByName,
  getBootstrapCredentials,
  updateMicroservice,
} from '../utils/c8y-api'
import { writeBootstrapCredentials } from '../utils/env-file'
import { createC8yManifest } from '../../dev/manifest'

export default defineCommand({
  meta: {
    name: 'bootstrap',
    description: 'Bootstrap your microservice to the development tenant',
  },
  args: {},
  async run() {
    // Step 1: Load config and env
    consola.info('Loading configuration...')
    const { env, c8yOptions, configDir } = await loadC8yConfig()

    // Step 2: Validate required environment variables
    consola.info('Validating environment variables...')
    const envVars = validateBootstrapEnv(env)

    // Step 3: Build manifest
    consola.info('Building manifest...')
    const manifest = await createC8yManifest(configDir, c8yOptions?.manifest)
    consola.success(`Manifest created for: ${manifest.name} v${manifest.version}`)

    // Step 4: Create auth header
    const authHeader = createBasicAuthHeader(
      envVars.C8Y_DEVELOPMENT_TENANT,
      envVars.C8Y_DEVELOPMENT_USER,
      envVars.C8Y_DEVELOPMENT_PASSWORD,
    )

    // Step 5: Check if microservice already exists
    consola.info(`Checking if microservice "${manifest.name}" exists...`)
    const existingApp = await findMicroserviceByName(
      envVars.C8Y_BASE_URL,
      manifest.name,
      authHeader,
    )

    let appId: string

    if (existingApp) {
      // Microservice exists - prompt for update
      consola.warn(`Microservice "${manifest.name}" already exists on development tenant (ID: ${existingApp.id})`)

      const shouldUpdate = await consola.prompt(
        'Do you want to update the existing microservice?',
        { type: 'confirm', cancel: 'reject' },
      )

      if (!shouldUpdate) {
        consola.info('Bootstrap cancelled.')
        return
      }

      // Step 6a: Update existing microservice
      consola.info('Updating microservice...')
      const updatedApp = await updateMicroservice(
        envVars.C8Y_BASE_URL,
        existingApp.id,
        manifest,
        authHeader,
      )
      appId = updatedApp.id
      consola.success(`Microservice updated successfully (ID: ${appId})`)
    } else {
      // Step 6b: Create new microservice
      consola.info('Creating microservice...')
      const createdApp = await createMicroservice(
        envVars.C8Y_BASE_URL,
        manifest,
        authHeader,
      )
      appId = createdApp.id
      consola.success(`Microservice created successfully (ID: ${appId})`)
    }

    // Step 7: Get bootstrap credentials
    consola.info('Fetching bootstrap credentials...')
    const credentials = await getBootstrapCredentials(
      envVars.C8Y_BASE_URL,
      appId,
      authHeader,
    )

    // Step 8: Write credentials to .env file
    consola.info('Writing bootstrap credentials...')
    const envFileName = await writeBootstrapCredentials(configDir, {
      C8Y_BOOTSTRAP_TENANT: credentials.tenant,
      C8Y_BOOTSTRAP_USER: credentials.name,
      C8Y_BOOTSTRAP_PASSWORD: credentials.password,
    })
    consola.success(`Bootstrap credentials written to ${envFileName}`)

    consola.success('Bootstrap complete!')
  },
})
