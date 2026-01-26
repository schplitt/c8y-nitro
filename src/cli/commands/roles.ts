import { defineCommand } from 'citty'
import { consola } from 'consola'
import { loadC8yConfig, validateBootstrapEnv } from '../utils/config'
import {
  assignUserRole,
  createBasicAuthHeader,
  unassignUserRole,
} from '../utils/c8y-api'
import { createC8yManifest } from '../../dev/manifest'

export default defineCommand({
  meta: {
    name: 'roles',
    description: 'Manage microservice roles for the development user',
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

    // Step 4: Create auth header
    const authHeader = createBasicAuthHeader(
      envVars.C8Y_DEVELOPMENT_TENANT,
      envVars.C8Y_DEVELOPMENT_USER,
      envVars.C8Y_DEVELOPMENT_PASSWORD,
    )

    // Step 5: Handle role assignment if roles are defined
    if (manifest.roles && manifest.roles.length > 0) {
      const rolesToAssign = await consola.prompt(
        'Select roles to assign to your user (unselected roles will be removed):',
        {
          type: 'multiselect',
          options: manifest.roles,
          cancel: 'reject',
          required: false,
        },
      )

      consola.info('Managing user roles...')

      const rolePromises = manifest.roles.map(async (role) => {
        if (rolesToAssign.includes(role)) {
          // Assign selected roles
          return await assignUserRole(
            envVars.C8Y_BASEURL,
            envVars.C8Y_DEVELOPMENT_TENANT,
            envVars.C8Y_DEVELOPMENT_USER,
            role,
            authHeader,
          )
        } else {
          // Unassign non-selected roles
          return await unassignUserRole(
            envVars.C8Y_BASEURL,
            envVars.C8Y_DEVELOPMENT_TENANT,
            envVars.C8Y_DEVELOPMENT_USER,
            role,
            authHeader,
          )
        }
      })

      await Promise.all(rolePromises)

      consola.success('Role management complete')
    } else {
      consola.warn('No roles defined in manifest. Nothing to manage.')
    }
  },
})
