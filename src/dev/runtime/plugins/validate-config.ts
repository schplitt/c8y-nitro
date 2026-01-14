/* import { useRuntimeConfig } from 'nitro/~internal/runtime/runtime-config'
import { definePlugin } from 'nitro'

export default definePlugin(() => {
  const config = useRuntimeConfig()

  const requiredVars = ['C8Y_BASE_URL', 'C8Y_BOOTSTRAP_TENANT', 'C8Y_BOOTSTRAP_USER', 'C8Y_BOOTSTRAP_PASSWORD']
  const missingVars = requiredVars.filter((varName) => !config[varName])

  if (missingVars.length > 0) {
    throw new Error(`Missing required runtime configuration variables: ${missingVars.join(', ')}`)
  }
})
 */
