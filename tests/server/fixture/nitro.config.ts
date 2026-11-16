import { defineConfig } from 'nitro'
import c8y from 'c8y-nitro'

export default defineConfig({
  preset: 'node_server',
  serverDir: './',

  builder: 'rolldown',

  experimental: {
    asyncContext: true,
    openAPI: true,
  },

  c8y: {
    skipBootstrap: true, // skip auto-bootstrap for testing purposes
    enableTenantOptionsInvalidationRoute: true,
    openapi: {
      excludeRoutes: ['/hidden'],
    },
    manifest: {
      roles: ['SOME_CUSTOM_ROLE', 'ANOTHER_ROLE'],
      settings: [
        { key: 'myOption', defaultValue: 'default' },
        { key: 'credentials.secret', defaultValue: 'change-me' },
        { key: 'cacheExpiryOption', defaultValue: 'cache-default' },
      ],
      requiredRoles: [
        'ROLE_OPTION_MANAGEMENT_READ',
        'ROLE_OPTION_MANAGEMENT_ADMIN',
        'ROLE_INVENTORY_READ',
        'ROLE_IDENTITY_READ',
        'ROLE_MEASUREMENT_READ',
        'ROLE_ALARM_ADMIN',
        'ROLE_DEVICE_CONTROL_ADMIN',
        'ROLE_NOTIFICATION_2_ADMIN',
      ],
    },
    cache: {
      credentialsTTL: 400,
      tenantOptions: {
        myOption: 200,
        // short TTL for the cache expiry test
        cacheExpiryOption: 4,
      },
    },
  },

  modules: [
    c8y(),
  ],
})
