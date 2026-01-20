import { definePlugin } from 'nitro'
import process from 'node:process'

export default definePlugin(() => {
  const env = process.env

  const requiredVars = ['C8Y_BASE_URL', 'C8Y_BOOTSTRAP_TENANT', 'C8Y_BOOTSTRAP_USER', 'C8Y_BOOTSTRAP_PASSWORD']
  const missingVars = requiredVars.filter((varName) => !env[varName])

  if (missingVars.length > 0) {
    throw new Error(`Missing required environment variables: ${missingVars.join(', ')}`)
  }
})
