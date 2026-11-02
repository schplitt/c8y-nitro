import { defineConfig } from 'vitest/config'

// Contract scenarios against a real tenant (see tests/contract/real-tenant.test.ts).
export default defineConfig({
  test: {
    include: ['tests/contract/real-tenant.test.ts'],
    // one tenant, one scenario at a time
    fileParallelism: false,
    testTimeout: 60_000,
  },
})
