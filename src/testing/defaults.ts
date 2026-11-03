import type { C8yTestUser } from './types'

/**
 * Values the fake tenant uses when the plugin config leaves them out.
 */
export const DEFAULTS = {
  tenant: 't12345',
  baseUrl: 'https://t12345.cumulocity.test',
  user: { userName: 'test-user', roles: [] } as C8yTestUser,
  bootstrapUser: 'servicebootstrap_test',
  bootstrapPassword: 'bootstrap-password',
  developmentPassword: 'test-password',
} as const

/**
 * Key under which the plugin provides its options to the test workers.
 */
export const PROVIDE_KEY = 'c8yNitroTest'
