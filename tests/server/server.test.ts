import {
  afterAll,
  beforeAll,
  describe,
  expect,
  it,
} from 'vitest'
import {
  build,
  createDevServer,
  createNitro,
  prepare,
} from 'nitro/builder'
import { Buffer } from 'buffer'
import { resolve } from 'pathe'
import type { NitroConfig } from 'nitro/types'
import type {
  C8yNitroModuleOptions,
} from '../../src/types'
import process from 'node:process'
import { generateMockClientCode } from './mocks/generator'
import type { MockC8yClientData } from './mocks/generator'

const rootDir = resolve(__dirname, './fixture')

const completeEnv = {
  C8Y_DEVELOPMENT_TENANT: 't12345',
  C8Y_DEVELOPMENT_USER: 'someUser@example.com',
  C8Y_DEVELOPMENT_PASSWORD: '<password>',
  C8Y_BASEURL: 'https://someTenant.cumulocity.com/',
  C8Y_BOOTSTRAP_TENANT: 't12345',
  C8Y_BOOTSTRAP_USER: 'bootstrapUser',
  C8Y_BOOTSTRAP_PASSWORD: 'bootstrapPassword',
}

interface ServerInput {
  nitroConfig?: NitroConfig & { c8y?: C8yNitroModuleOptions }
  env?: Record<string, string>
  mockData?: MockC8yClientData
}

declare module 'nitro/types' {
  interface NitroOptions {
    c8y?: C8yNitroModuleOptions
  }
}

describe('Nitro Server', () => {
  async function createC8yNitroServer(input: ServerInput) {
    // assign envs to process.env for the plugin to pick them up
    const inputEnv = input?.env ?? {}
    for (const [key, value] of Object.entries(inputEnv)) {
      process.env[key] = value
    }

    // Generate mock client code for virtual module
    const mockClientCode = input.mockData
      ? generateMockClientCode(input.mockData)
      : undefined

    const nitro = await createNitro({
      dev: true,
      rootDir,
      ...input.nitroConfig,
      builder: 'rolldown',

      // Use virtual modules to inject mock @c8y/client if mockData is provided
      virtual: mockClientCode
        ? {
            '@c8y/client': mockClientCode,
          }
        : {},

    })
    const devServer = createDevServer(nitro)
    const server = devServer.listen({})
    await prepare(nitro)
    const ready = new Promise<void>((resolve) => {
      nitro.hooks.hook('dev:reload', () => resolve())
    })
    await build(nitro)
    await ready
    return { nitro, devServer, server, env: inputEnv }
  }

  describe('Bootstrap validation', () => {
    let nitro: Awaited<ReturnType<typeof createNitro>>
    let devServer: ReturnType<typeof createDevServer>
    let server: Awaited<ReturnType<ReturnType<typeof createDevServer>['listen']>>

    beforeAll(async () => {
      const result = await createC8yNitroServer({})
      nitro = result.nitro
      devServer = result.devServer
      server = result.server
    })

    afterAll(async () => {
      await devServer?.close()
      await nitro?.close()
    })

    it('should throw an error if the bootstrap environment variables aren\'t set', async () => {
      const res = await server.fetch(new Request(new URL('/hello', server.url)))

      const json = await res.json()
      expect(json.message).toContain('Missing required environment variables for development: C8Y_BASEURL, C8Y_BOOTSTRAP_TENANT, C8Y_BOOTSTRAP_USER, C8Y_BOOTSTRAP_PASSWORD')
    })
  })

  describe('With complete environment', () => {
    let nitro: Awaited<ReturnType<typeof createNitro>>
    let devServer: ReturnType<typeof createDevServer>
    let server: Awaited<ReturnType<ReturnType<typeof createDevServer>['listen']>>
    let env: Record<string, string>

    beforeAll(async () => {
      const result = await createC8yNitroServer({
        env: completeEnv,
      })
      nitro = result.nitro
      devServer = result.devServer
      server = result.server
      env = result.env
    })

    afterAll(async () => {
      // clean up env vars
      for (const key of Object.keys(env)) {
        delete process.env[key]
      }

      await devServer?.close()
      await nitro?.close()
    })

    it('should get the development user auth injected if present', async () => {
      const res = await server.fetch(new Request(new URL('/authHeader', server.url)))
      const json = await res.json()

      expect(json).toEqual({ authHeader: expect.any(String) })

      expect(json.authHeader).toBe(`Basic ${Buffer.from(`${completeEnv.C8Y_DEVELOPMENT_TENANT}/${completeEnv.C8Y_DEVELOPMENT_USER}:${completeEnv.C8Y_DEVELOPMENT_PASSWORD}`).toString('base64')}`)
    })

    it('should correctly inject the probe handlers', async () => {
      const res1 = await server.fetch(new Request(new URL('/_c8y_nitro/liveness', server.url)))

      expect(res1.status).toEqual(200)

      const res2 = await server.fetch(new Request(new URL('/_c8y_nitro/readiness', server.url)))

      expect(res2.status).toEqual(200)
    })
  })

  describe('Access control (denied)', () => {
    let nitro: Awaited<ReturnType<typeof createNitro>>
    let devServer: ReturnType<typeof createDevServer>
    let server: Awaited<ReturnType<ReturnType<typeof createDevServer>['listen']>>
    let env: Record<string, string>

    beforeAll(async () => {
      const result = await createC8yNitroServer({
        env: completeEnv,
        mockData: {
          currentUser: {
            userName: 'someUser',
            effectiveRoles: [{
              name: 'SOME_CUSTOM_ROLE',
            }],
          },
        },
      })
      nitro = result.nitro
      devServer = result.devServer
      server = result.server
      env = result.env
    })

    afterAll(async () => {
      for (const key of Object.keys(env)) {
        delete process.env[key]
      }
      await devServer?.close()
      await nitro?.close()
    })

    it('should deny access to protected route', async () => {
      const res = await server.fetch(new Request(new URL('/protectedRoute', server.url)))

      const json = await res.json()

      expect(json.message).toEqual('User does not have required role(s) to access this resource: ADMIN_ROLE')
      expect(res.status).toEqual(403)
    })

    it('should deny access when user has none of the required roles', async () => {
      const res = await server.fetch(new Request(new URL('/protected-multi-role', server.url)))

      expect(res.status).toEqual(403)

      const json = await res.json()
      expect(json.message).toContain('ROLE_A')
      expect(json.message).toContain('ROLE_B')
    })
  })

  describe('Access control (allowed)', () => {
    let nitro: Awaited<ReturnType<typeof createNitro>>
    let devServer: ReturnType<typeof createDevServer>
    let server: Awaited<ReturnType<ReturnType<typeof createDevServer>['listen']>>
    let env: Record<string, string>

    beforeAll(async () => {
      const result = await createC8yNitroServer({
        env: completeEnv,
        mockData: {
          currentUser: {
            userName: 'adminUser',
            effectiveRoles: [
              { name: 'ADMIN_ROLE' },
              { name: 'ROLE_B' },
            ],
          },
        },
      })
      nitro = result.nitro
      devServer = result.devServer
      server = result.server
      env = result.env
    })

    afterAll(async () => {
      for (const key of Object.keys(env)) {
        delete process.env[key]
      }
      await devServer?.close()
      await nitro?.close()
    })

    it('should allow access to protected route', async () => {
      const res = await server.fetch(new Request(new URL('/protectedRoute', server.url)))

      expect(res.status).toEqual(200)

      const json = await res.json()
      expect(json.message).toBe('You have access to the protected route!')
    })

    it('should allow access when user has one of the required roles', async () => {
      const res = await server.fetch(new Request(new URL('/protected-multi-role', server.url)))

      expect(res.status).toEqual(200)

      const json = await res.json()
      expect(json.message).toBe('You have one of the required roles!')
    })
  })

  describe('User resources and tenant data', () => {
    let nitro: Awaited<ReturnType<typeof createNitro>>
    let devServer: ReturnType<typeof createDevServer>
    let server: Awaited<ReturnType<ReturnType<typeof createDevServer>['listen']>>
    let env: Record<string, string>

    beforeAll(async () => {
      const result = await createC8yNitroServer({
        env: completeEnv,
        mockData: {
          currentUser: {
            userName: 'testUser',
            effectiveRoles: [
              { name: 'ROLE_INVENTORY_READ' },
              { name: 'ROLE_ALARM_READ' },
              { name: 'ROLE_DEVICE_CONTROL' },
            ],
          },
          subscriptions: [
            { tenant: 't12345', user: 'serviceuser1', password: 'pass1' },
            { tenant: 't67890', user: 'serviceuser2', password: 'pass2' },
          ],
          tenantOptions: {
            myOption: 'hello-world',
            // stored without credentials. prefix since useTenantOption strips it before the API call
            secret: 'super-secret-value',
          },
        },
      })
      nitro = result.nitro
      devServer = result.devServer
      server = result.server
      env = result.env
    })

    afterAll(async () => {
      for (const key of Object.keys(env)) {
        delete process.env[key]
      }
      await devServer?.close()
      await nitro?.close()
    })

    it('should return the current user and their roles', async () => {
      const res = await server.fetch(new Request(new URL('/user', server.url)))

      expect(res.status).toEqual(200)

      const json = await res.json()
      expect(json.userName).toBe('testUser')
      expect(json.roles).toEqual(['ROLE_INVENTORY_READ', 'ROLE_ALARM_READ', 'ROLE_DEVICE_CONTROL'])
    })

    it('should return subscribed tenants and deployed tenant credentials', async () => {
      const res = await server.fetch(new Request(new URL('/credentials', server.url)))

      expect(res.status).toEqual(200)

      const json = await res.json()
      expect(json.subscribedTenants).toEqual(expect.arrayContaining(['t12345', 't67890']))
      expect(json.deployedTenant).toBe('t12345')
      expect(json.userTenant).toBe('t12345')
    })

    it('should fetch tenant option values', async () => {
      const res = await server.fetch(new Request(new URL('/tenant-options', server.url)))

      expect(res.status).toEqual(200)

      const json = await res.json()
      expect(json.myOption).toBe('hello-world')
      expect(json['credentials.secret']).toBe('super-secret-value')
      expect(json.message).toBe('Fetched tenant options successfully')
    })

    it('should allow access for allowed tenant', async () => {
      const res = await server.fetch(new Request(new URL('/tenant-restricted', server.url)))

      expect(res.status).toEqual(200)

      const json = await res.json()
      expect(json.message).toBe('Your tenant is allowed!')
    })

    it('should allow access for deployed tenant user', async () => {
      const res = await server.fetch(new Request(new URL('/deployed-tenant-only', server.url)))

      expect(res.status).toEqual(200)

      const json = await res.json()
      expect(json.message).toBe('You are from the deployed tenant!')
    })
  })

  describe('Tenant restriction (disallowed tenant)', () => {
    let nitro: Awaited<ReturnType<typeof createNitro>>
    let devServer: ReturnType<typeof createDevServer>
    let server: Awaited<ReturnType<ReturnType<typeof createDevServer>['listen']>>
    let env: Record<string, string>

    beforeAll(async () => {
      // Use a different development tenant that is NOT in the allowed list
      const result = await createC8yNitroServer({
        env: {
          ...completeEnv,
          C8Y_DEVELOPMENT_TENANT: 't00000',
        },
        mockData: {
          currentUser: {
            userName: 'testUser',
            effectiveRoles: [],
          },
        },
      })
      nitro = result.nitro
      devServer = result.devServer
      server = result.server
      env = result.env
    })

    afterAll(async () => {
      for (const key of Object.keys(env)) {
        delete process.env[key]
      }
      await devServer?.close()
      await nitro?.close()
    })

    it('should deny access for disallowed tenant', async () => {
      const res = await server.fetch(new Request(new URL('/tenant-restricted', server.url)))

      expect(res.status).toEqual(403)

      const json = await res.json()
      expect(json.message).toContain('t00000')
      expect(json.message).toContain('not allowed')
    })
  })

  describe('Deployed tenant only (different tenant)', () => {
    let nitro: Awaited<ReturnType<typeof createNitro>>
    let devServer: ReturnType<typeof createDevServer>
    let server: Awaited<ReturnType<ReturnType<typeof createDevServer>['listen']>>
    let env: Record<string, string>

    beforeAll(async () => {
      // Development tenant differs from bootstrap tenant
      const result = await createC8yNitroServer({
        env: {
          ...completeEnv,
          C8Y_DEVELOPMENT_TENANT: 't99999',
        },
        mockData: {
          currentUser: {
            userName: 'testUser',
            effectiveRoles: [],
          },
        },
      })
      nitro = result.nitro
      devServer = result.devServer
      server = result.server
      env = result.env
    })

    afterAll(async () => {
      for (const key of Object.keys(env)) {
        delete process.env[key]
      }
      await devServer?.close()
      await nitro?.close()
    })

    it('should deny access for non-deployed tenant user', async () => {
      const res = await server.fetch(new Request(new URL('/deployed-tenant-only', server.url)))

      expect(res.status).toEqual(403)

      const json = await res.json()
      expect(json.message).toContain('t12345')
    })
  })
})
