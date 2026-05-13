import {
  afterAll,
  beforeAll,
  describe,
  expect,
  it,
  vi,
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
import { consola } from 'consola'
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
  // TODO: investigate why server crashes at logging tests when c8y client is not mocked
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
      const json = await res.json() as Record<string, any>

      expect(json).toEqual({ authHeader: expect.any(String) })

      expect(json.authHeader).toBe(`Basic ${Buffer.from(`${completeEnv.C8Y_DEVELOPMENT_TENANT}/${completeEnv.C8Y_DEVELOPMENT_USER}:${completeEnv.C8Y_DEVELOPMENT_PASSWORD}`).toString('base64')}`)
    })

    it('should correctly inject the probe handlers', async () => {
      const res1 = await server.fetch(new Request(new URL('/_c8y_nitro/liveness', server.url)))

      expect(res1.status).toEqual(200)

      const res2 = await server.fetch(new Request(new URL('/_c8y_nitro/readiness', server.url)))

      expect(res2.status).toEqual(200)
    })

    it.sequential('should run a scheduled task after its delay', async () => {
      const marker = `marker-${Date.now()}`
      const logs: string[] = []
      const mockFn = vi.fn((context: unknown) => {
        logs.push(String(context))
      })

      consola.mockTypes(() => mockFn)
      consola.wrapAll()

      try {
        const res = await server.fetch(new Request(new URL(`/schedule-task?marker=${marker}&schedule=0.2`, server.url)))

        expect(res.status).toEqual(200)

        const json = await res.json() as Record<string, any>
        expect(json.scheduled).toEqual({
          id: expect.stringMatching(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/),
          task: 'scheduler:log',
          runAt: expect.any(String),
        })
        expect(json.pending[json.scheduled.id]).toEqual(json.scheduled)
        expect(logs.join('\n')).not.toContain(`scheduled-task:${marker}`)

        const waitMs = Math.max(new Date(json.scheduled.runAt).getTime() - Date.now(), 0) + 2_000
        await new Promise<void>((resolve) => {
          setTimeout(() => resolve(), waitMs)
        })
        const listRes = await server.fetch(new Request(new URL('/scheduled-tasks', server.url)))
        expect(listRes.status).toEqual(200)

        const listJson = await listRes.json() as Record<string, any>
        expect(listJson.pending).not.toHaveProperty(json.scheduled.id)

        expect(logs.join('\n')).toContain(`scheduled-task:${marker}`)
      } finally {
        consola.restoreAll()
      }
    })
  })

  describe('With dev user injection disabled', () => {
    let nitro: Awaited<ReturnType<typeof createNitro>>
    let devServer: ReturnType<typeof createDevServer>
    let server: Awaited<ReturnType<ReturnType<typeof createDevServer>['listen']>>
    let env: Record<string, string>

    beforeAll(async () => {
      const result = await createC8yNitroServer({
        env: completeEnv,
        nitroConfig: {
          c8y: {
            dev: {
              injectUser: false,
            },
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

    it('should not register the dev user middleware when disabled in config', async () => {
      const upstreamAuthHeader = 'Basic proxy-auth-header'
      const res = await server.fetch(new Request(new URL('/authHeader', server.url), {
        headers: {
          authorization: upstreamAuthHeader,
        },
      }))
      const json = await res.json() as Record<string, any>

      expect(json).toEqual({ authHeader: upstreamAuthHeader })
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

      const json = await res.json() as Record<string, any>

      expect(json.message).toEqual('User does not have required role(s) to access this resource: ADMIN_ROLE')
      expect(res.status).toEqual(403)
    })

    it('should deny access when user has none of the required roles', async () => {
      const res = await server.fetch(new Request(new URL('/protected-multi-role', server.url)))

      expect(res.status).toEqual(403)

      const json = await res.json() as Record<string, any>
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

      const json = await res.json() as Record<string, any>
      expect(json.message).toBe('You have access to the protected route!')
    })

    it('should allow access when user has one of the required roles', async () => {
      const res = await server.fetch(new Request(new URL('/protected-multi-role', server.url)))

      expect(res.status).toEqual(200)

      const json = await res.json() as Record<string, any>
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
        nitroConfig: {
          c8y: {
            cache: {
              tenantOptions: {
                cacheExpiryOption: 4,
              },
            },
          },
        },
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
            'myOption': 'hello-world',
            'credentials.secret': 'super-secret-value',
            'cacheExpiryOption': 'cache-initial-value',
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

      const json = await res.json() as Record<string, any>
      expect(json.userName).toBe('testUser')
      expect(json.roles).toEqual(['ROLE_INVENTORY_READ', 'ROLE_ALARM_READ', 'ROLE_DEVICE_CONTROL'])
    })

    it('should return subscribed tenants and deployed tenant credentials', async () => {
      const res = await server.fetch(new Request(new URL('/credentials', server.url)))

      expect(res.status).toEqual(200)

      const json = await res.json() as Record<string, any>
      expect(json.subscribedTenants).toEqual(expect.arrayContaining(['t12345', 't67890']))
      expect(json.deployedTenant).toBe('t12345')
      expect(json.userTenant).toBe('t12345')
    })

    it('should fetch tenant option values', async () => {
      const res = await server.fetch(new Request(new URL('/tenant-options', server.url)))

      expect(res.status).toEqual(200)

      const json = await res.json() as Record<string, any>
      expect(json.myOption).toBe('hello-world')
      expect(json['credentials.secret']).toBe('super-secret-value')
      expect(json.cacheExpiryOption).toBe('cache-initial-value')
      expect(json.message).toBe('Fetched tenant options successfully')
    })

    it('should invalidate a created tenant option cache by key', async () => {
      await server.fetch(new Request(new URL('/tenant-options', server.url)))

      const res = await server.fetch(new Request(new URL('/_c8y_nitro/invalidate-tenant-options?key=myOption', server.url)))

      expect(res.status).toEqual(200)

      const json = await res.json() as Record<string, any>
      expect(json.message).toBe('success')
    })

    it('should skip invalidation when the key fetcher was not created yet', async () => {
      const res = await server.fetch(new Request(new URL('/_c8y_nitro/invalidate-tenant-options?key=credentials.secret', server.url)))

      expect(res.status).toEqual(200)

      const json = await res.json() as Record<string, any>
      expect(json.message).toBe('success')
    })

    it('should prioritize all over key when both query params are present', async () => {
      await server.fetch(new Request(new URL('/tenant-options', server.url)))

      const res = await server.fetch(new Request(new URL('/_c8y_nitro/invalidate-tenant-options?all=1&key=myOption', server.url)))

      expect(res.status).toEqual(200)

      const json = await res.json() as Record<string, any>
      expect(json.message).toBe('success')
    })

    it('should reject unknown tenant option keys', async () => {
      const res = await server.fetch(new Request(new URL('/_c8y_nitro/invalidate-tenant-options?key=unknown.option', server.url)))

      expect(res.status).toEqual(400)

      const json = await res.json() as Record<string, any>
      expect(json.message).toBe('Invalid tenant option invalidation request')
    })

    it('should reject invalidation requests without all or key', async () => {
      const res = await server.fetch(new Request(new URL('/_c8y_nitro/invalidate-tenant-options', server.url)))

      expect(res.status).toEqual(400)

      const json = await res.json() as Record<string, any>
      expect(json.message).toBe('Provide either the all or key query parameter')
    })

    it('should allow access for allowed tenant', async () => {
      const res = await server.fetch(new Request(new URL('/tenant-restricted', server.url)))

      expect(res.status).toEqual(200)

      const json = await res.json() as Record<string, any>
      expect(json.message).toBe('Your tenant is allowed!')
    })

    it('should allow access for deployed tenant user', async () => {
      const res = await server.fetch(new Request(new URL('/deployed-tenant-only', server.url)))

      expect(res.status).toEqual(200)

      const json = await res.json() as Record<string, any>
      expect(json.message).toBe('You are from the deployed tenant!')
    })

    it('should keep the cached tenant option until TTL expires and then return the updated value', async () => {
      const initialRes = await server.fetch(new Request(new URL('/tenant-options', server.url)))
      expect(initialRes.status).toEqual(200)
      const initialJson = await initialRes.json() as Record<string, any>
      expect(initialJson.cacheExpiryOption).toBe('cache-initial-value')

      const updateRes = await server.fetch(new Request(new URL('/mock-tenant-option?key=cacheExpiryOption&value=cache-updated-value', server.url)))
      expect(updateRes.status).toEqual(200)
      const updateJson = await updateRes.json() as Record<string, any>
      expect(updateJson).toEqual({
        key: 'cacheExpiryOption',
        value: 'cache-updated-value',
      })

      await new Promise<void>((resolve) => {
        setTimeout(() => resolve(), 2_000)
      })

      const cachedRes = await server.fetch(new Request(new URL('/tenant-options', server.url)))
      expect(cachedRes.status).toEqual(200)
      const cachedJson = await cachedRes.json() as Record<string, any>
      expect(cachedJson.cacheExpiryOption).toBe('cache-initial-value')

      await new Promise<void>((resolve) => {
        setTimeout(() => resolve(), 3_200)
      })

      const refreshedRes = await server.fetch(new Request(new URL('/tenant-options', server.url)))
      expect(refreshedRes.status).toEqual(200)
      const refreshedJson = await refreshedRes.json() as Record<string, any>
      expect(refreshedJson.cacheExpiryOption).toBe('cache-updated-value')
    }, 8_000)

    it('should fire the tenant credentials lifecycle hook when credentials are refreshed after a mocked subscription change', async () => {
      const clearInitialRes = await server.fetch(new Request(new URL('/credentials-hook-events?clear=1', server.url)))
      expect(clearInitialRes.status).toEqual(200)

      const initialRes = await server.fetch(new Request(new URL('/subscribed-credentials', server.url)))
      expect(initialRes.status).toEqual(200)
      const initialJson = await initialRes.json() as Record<string, any>
      expect(initialJson.subscribedTenants).toEqual(['t12345', 't67890'])

      const clearCachedEventsRes = await server.fetch(new Request(new URL('/credentials-hook-events?clear=1', server.url)))
      expect(clearCachedEventsRes.status).toEqual(200)

      const mutateRes = await server.fetch(new Request(new URL('/subscribed-credentials?tenant=t99999&user=serviceuser3&password=pass3', server.url)))
      expect(mutateRes.status).toEqual(200)
      const mutateJson = await mutateRes.json() as Record<string, any>
      expect(mutateJson.mockSubscribedTenants).toEqual(['t12345', 't67890', 't99999'])
      expect(mutateJson.subscribedTenants).toEqual(['t12345', 't67890'])

      const staleRes = await server.fetch(new Request(new URL('/subscribed-credentials', server.url)))
      expect(staleRes.status).toEqual(200)
      const staleJson = await staleRes.json() as Record<string, any>
      expect(staleJson.subscribedTenants).toEqual(['t12345', 't67890'])

      const refreshRes = await server.fetch(new Request(new URL('/subscribed-credentials?refresh=1', server.url)))
      expect(refreshRes.status).toEqual(200)
      const refreshJson = await refreshRes.json() as Record<string, any>
      expect(refreshJson.subscribedTenants).toEqual(['t12345', 't67890', 't99999'])

      const refreshEventsRes = await server.fetch(new Request(new URL('/credentials-hook-events?clear=1', server.url)))
      expect(refreshEventsRes.status).toEqual(200)
      const refreshEventsJson = await refreshEventsRes.json() as Record<string, any>
      expect(refreshEventsJson.events).toEqual([
        {
          prevTenants: ['t12345', 't67890'],
          nextTenants: ['t12345', 't67890', 't99999'],
        },
      ])
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

      const json = await res.json() as Record<string, any>
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

      const json = await res.json() as Record<string, any>
      expect(json.message).toContain('t12345')
    })
  })

  describe('Logging', () => {
    let nitro: Awaited<ReturnType<typeof createNitro>>
    let devServer: ReturnType<typeof createDevServer>
    let server: Awaited<ReturnType<ReturnType<typeof createDevServer>['listen']>>
    let env: Record<string, string>

    beforeAll(async () => {
      const result = await createC8yNitroServer({
        env: completeEnv,
        mockData: {},
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

    it.sequential('should log wide event context and return correct JSON for success path', async () => {
      const logs: string[] = []
      const mockFn = vi.fn((context: unknown) => {
        logs.push(String(context))
      })

      consola.mockTypes(() => mockFn)
      consola.wrapAll()

      try {
        const res = await server.fetch(new Request(new URL('/logging/success', server.url)))

        expect(res.status).toEqual(200)
        const json = await res.json() as Record<string, any>
        expect(json.message).toBe('ok')
        expect(json.action).toBe('test-success')

        // Wait for async logs to be written
        await new Promise<void>((resolve) => {
          setTimeout(() => resolve(), 100)
        })

        expect(mockFn).toHaveBeenCalled()
        const logOutput = logs.join('\n')
        expect(logOutput).toMatch(/GET \/logging\/success/)
        expect(logOutput).toContain('user_123')
      } finally {
        consola.restoreAll()
      }
    })

    it.sequential('should log error wide event and return structured error JSON', async () => {
      const logs: string[] = []
      const mockFn = vi.fn((context: unknown) => {
        logs.push(String(context))
      })

      consola.mockTypes(() => mockFn)
      consola.wrapAll()

      try {
        const res = await server.fetch(new Request(new URL('/logging/error', server.url)))

        expect(res.status).toEqual(400)
        const json = await res.json() as Record<string, any>
        expect(json.message).toBe('Something went wrong')
        expect(json.data.why).toBe('Test error occurred for logging verification')
        expect(json.data.fix).toBe('This is a test fixture, nothing to fix')
        expect(json.data.link).toBe('https://www.evlog.dev/core-concepts/structured-errors')

        // Wait for async logs to be written
        await new Promise<void>((resolve) => {
          setTimeout(() => resolve(), 100)
        })

        expect(mockFn).toHaveBeenCalled()
        const logOutput = logs.join('\n')
        expect(logOutput).toMatch(/GET \/logging\/error/)
        expect(logOutput).toContain('user_456')
      } finally {
        consola.restoreAll()
      }
    })

    it.sequential('should not log liveness and readiness probe requests', async () => {
      const logs: string[] = []
      const mockFn = vi.fn((context: unknown) => {
        logs.push(String(context))
      })

      consola.mockTypes(() => mockFn)
      consola.wrapAll()

      try {
        const livenessRes = await server.fetch(new Request(new URL('/_c8y_nitro/liveness', server.url)))
        const readinessRes = await server.fetch(new Request(new URL('/_c8y_nitro/readiness', server.url)))
        const helloRes = await server.fetch(new Request(new URL('/hello', server.url)))

        expect(livenessRes.status).toEqual(200)
        expect(readinessRes.status).toEqual(200)
        expect(helloRes.status).toEqual(200)

        await new Promise<void>((resolve) => {
          setTimeout(() => resolve(), 100)
        })

        const logOutput = logs.join('\n')
        expect(logOutput).toMatch(/GET \/hello/)
        expect(logOutput).not.toMatch(/GET \/_c8y_nitro\/liveness/)
        expect(logOutput).not.toMatch(/GET \/_c8y_nitro\/readiness/)
      } finally {
        consola.restoreAll()
      }
    })
  })
})
