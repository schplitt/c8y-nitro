import type { Nitro } from 'nitro/types'
import { createC8yManifest } from './manifest'
import {
  createBasicAuthHeader,
  createMicroservice,
  findMicroserviceByName,
  getBootstrapCredentials,
  subscribeToApplication,
} from '../cli/utils/c8y-api'
import { writeBootstrapCredentials } from '../cli/utils/env-file'
import process from 'node:process'

/**
 * Automatically bootstraps the microservice to the development tenant if needed.
 * Runs silently - only logs if bootstrap was performed or if errors occur.
 * @param nitro - Nitro instance
 */
export async function autoBootstrap(nitro: Nitro): Promise<void> {
  try {
    // Step 1: Check if we already have bootstrap credentials
    const bootstrapEnvVars = ['C8Y_BOOTSTRAP_TENANT', 'C8Y_BOOTSTRAP_USER', 'C8Y_BOOTSTRAP_PASSWORD']
    const hasBootstrapCreds = bootstrapEnvVars.every((v) => process.env[v])

    if (hasBootstrapCreds) {
      // Already bootstrapped, nothing to do (silent)
      return
    }

    // Step 2: Check if we have development credentials to perform auto-bootstrap
    const devEnvVars = ['C8Y_BASEURL', 'C8Y_DEVELOPMENT_TENANT', 'C8Y_DEVELOPMENT_USER', 'C8Y_DEVELOPMENT_PASSWORD']
    const missingDevVars = devEnvVars.filter((v) => !process.env[v])

    if (missingDevVars.length > 0) {
      // Missing dev credentials, can't auto-bootstrap
      // don't output as plugin will inform user about missing credentials
      return
    }

    // Step 3: We have dev creds but not bootstrap creds - auto-bootstrap!
    const baseUrl = process.env.C8Y_BASEURL!.endsWith('/')
      ? process.env.C8Y_BASEURL!.slice(0, -1)
      : process.env.C8Y_BASEURL!

    const authHeader = createBasicAuthHeader(
      process.env.C8Y_DEVELOPMENT_TENANT!,
      process.env.C8Y_DEVELOPMENT_USER!,
      process.env.C8Y_DEVELOPMENT_PASSWORD!,
    )

    // Build manifest
    const manifest = await createC8yManifest(nitro.options.rootDir, nitro.options.c8y?.manifest, nitro.logger)

    // Check if microservice exists
    const existingApp = await findMicroserviceByName(
      baseUrl,
      manifest.name,
      authHeader,
    )

    let appId: string

    if (existingApp) {
      // Microservice already exists - just use existing one, don't update
      appId = existingApp.id
      nitro.logger.debug(`Microservice "${manifest.name}" already exists (ID: ${appId}), retrieving bootstrap credentials...`)
    } else {
      // Create new microservice
      const createdApp = await createMicroservice(
        baseUrl,
        manifest,
        authHeader,
      )
      appId = createdApp.id
      nitro.logger.debug(`Microservice "${manifest.name}" created (ID: ${appId})`)
    }

    // Subscribe tenant to application (409 if already subscribed is OK)
    await subscribeToApplication(
      baseUrl,
      process.env.C8Y_DEVELOPMENT_TENANT!,
      appId,
      authHeader,
    )

    // Get bootstrap credentials
    const credentials = await getBootstrapCredentials(
      baseUrl,
      appId,
      authHeader,
    )

    // Write credentials to .env file
    const envFileName = await writeBootstrapCredentials(nitro.options.rootDir, {
      C8Y_BOOTSTRAP_TENANT: credentials.tenant,
      C8Y_BOOTSTRAP_USER: credentials.name,
      C8Y_BOOTSTRAP_PASSWORD: credentials.password,
    })

    // Set credentials in process.env so runtime validation picks them up immediately
    process.env.C8Y_BOOTSTRAP_TENANT = credentials.tenant
    process.env.C8Y_BOOTSTRAP_USER = credentials.name
    process.env.C8Y_BOOTSTRAP_PASSWORD = credentials.password

    // Log success
    nitro.logger.success(`Auto-bootstrap complete! Bootstrap credentials written to ${envFileName}`)
  } catch (error) {
    // Just warn if something fails, don't crash
    nitro.logger.warn('Auto-bootstrap failed:', error instanceof Error ? error.message : String(error))
  }
}
