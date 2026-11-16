import { defineConfig } from 'nitro'
import c8y from 'c8y-nitro'

export default defineConfig({
  preset: 'node_server',
  serverDir: './',

  builder: 'rolldown',

  experimental: {
    asyncContext: true,
  },

  c8y: {
    manifest: {
      roles: ['SOME_CUSTOM_ROLE', 'ANOTHER_ROLE'],
      settings: [
        { key: 'myOption', defaultValue: 'default' },
        { key: 'credentials.secret', defaultValue: 'change-me' },
        { key: 'maxTemperature', defaultValue: '80' },
      ],
      requiredRoles: [
        'ROLE_OPTION_MANAGEMENT_READ',
        'ROLE_OPTION_MANAGEMENT_ADMIN',
        'ROLE_INVENTORY_READ',
        'ROLE_IDENTITY_READ',
        'ROLE_MEASUREMENT_READ',
        'ROLE_ALARM_ADMIN',
        'ROLE_NOTIFICATION_2_ADMIN',
      ],
    },
    cache: {
      credentialsTTL: 400,
      tenantOptions: {
        myOption: 200,
      },
    },
  },

  modules: [
    c8y(),
  ],
})
