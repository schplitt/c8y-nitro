import { definePlugin } from 'nitro'
import process from 'node:process'

export default definePlugin(() => {
  if (import.meta.dev) {
    const env = process.env

    const requiredVars = ['C8Y_BASEURL', 'C8Y_BOOTSTRAP_TENANT', 'C8Y_BOOTSTRAP_USER', 'C8Y_BOOTSTRAP_PASSWORD']
    const missingVars = requiredVars.filter((varName) => !env[varName])

    if (missingVars.length > 0) {
      throw new Error(
        `Missing required environment variables for development: ${missingVars.join(', ')}\n\n`
        + `To set up your development environment, run:\n`
        + `  npx c8y-nitro bootstrap\n\n`
        + `This command will:\n`
        + `  1. Require your development tenant credentials (C8Y_BASEURL C8Y_DEVELOPMENT_TENANT, C8Y_DEVELOPMENT_USER, C8Y_DEVELOPMENT_PASSWORD)\n`
        + `  2. Register your microservice on the tenant\n`
        + `  3. Generate the necessary bootstrap credentials in a .env file\n\n`
        + `Make sure you have your development tenant credentials configured first.`,
      )
    }
  }
})
