import { nitro } from 'nitro/vite'
import { c8yTest } from 'c8y-nitro/testing/vite'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  plugins: [
    nitro(),
    // Every test starts with a fake Cumulocity tenant where this user calls the service
    c8yTest({
      user: { userName: 'operator', roles: ['ROLE_INVENTORY_READ', 'ROLE_ALARM_ADMIN'] },
    }),
  ],
})
