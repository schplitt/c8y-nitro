import {
  afterAll,
  afterEach,
  beforeEach,
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
import { mockUtils } from './mocks/client'
import { mockData } from './mocks/db.mjs'

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
}

declare module 'nitro/types' {
  interface NitroOptions {
    c8y?: C8yNitroModuleOptions
  }
}

describe('Nitro Server', () => {
  let devInput: ServerInput = {}
  let nitro: Awaited<ReturnType<typeof createNitro>>
  let devServer: ReturnType<typeof createDevServer>
  let server: Awaited<ReturnType<ReturnType<typeof createDevServer>['listen']>>

  async function createC8yNitroServer(input: ServerInput) {
    devInput = input

    // assign envs to process.env for the plugin to pick them up
    const inputEnv = devInput?.env ?? {}
    for (const [key, value] of Object.entries(inputEnv)) {
      process.env[key] = value
    }

    nitro = await createNitro({
      dev: true,
      rootDir,
      ...input.nitroConfig,
      builder: 'rolldown',
      rolldownConfig: {
        output: {},
        // Mark db.mjs as external so it's shared between test and server
        external: [resolve(__dirname, './mocks/db.mjs')],
        resolve: {
          alias: {
            '@c8y/client': resolve(__dirname, './mocks/client.ts'),
            [resolve(__dirname, './mocks/db.mjs')]: resolve(__dirname, './mocks/db.mjs'),
          },
        },
      },

    }, {
      dotenv: {
        env: input.env,
      },
    })
    devServer = createDevServer(nitro)
    server = devServer.listen({})
    await prepare(nitro)
    const ready = new Promise<void>((resolve) => {
      nitro.hooks.hook('dev:reload', () => resolve())
    })
    await build(nitro)
    await ready
    return { nitro, devServer, server }
  }

  beforeEach(() => {
    // reset mock data
    mockUtils.reset()
  })

  afterEach(() => {
    // clean up env vars after each test
    const inputEnv = devInput!.env ?? {}
    for (const key of Object.keys(inputEnv)) {
      delete process.env[key]
    }

    // close the dev server and nitro instance after each test to ensure a clean slate
    devServer?.close()
    nitro?.close()
  })

  afterAll(async () => {
    await devServer?.close()
    await nitro?.close()
  })

  it('should throw an error if the bootstrap environment variables aren\'t set', async () => {
    const { server } = await createC8yNitroServer({})

    const res = await server.fetch(new Request(new URL('/hello', server.url)))

    const json = await res.json()
    expect(json.message).toContain('Missing required environment variables for development: C8Y_BASEURL, C8Y_BOOTSTRAP_TENANT, C8Y_BOOTSTRAP_USER, C8Y_BOOTSTRAP_PASSWORD')
  })

  it('should get the development user auth injected if present', async () => {
    const { server } = await createC8yNitroServer({
      env: completeEnv,
    })

    const res = await server.fetch(new Request(new URL('/authHeader', server.url)))
    const json = await res.json()

    expect(json).toEqual({ authHeader: expect.any(String) })

    expect(json.authHeader).toBe(`Basic ${Buffer.from(`${completeEnv.C8Y_DEVELOPMENT_TENANT}/${completeEnv.C8Y_DEVELOPMENT_USER}:${completeEnv.C8Y_DEVELOPMENT_PASSWORD}`).toString('base64')}`)
  })

  it('should correctly inject the probe handlers', async () => {
    const { server } = await createC8yNitroServer({
      env: completeEnv,
      nitroConfig: {

      },
    })

    const res1 = await server.fetch(new Request(new URL('/_c8y_nitro/liveness', server.url)))

    expect(res1.status).toEqual(200)

    const res2 = await server.fetch(new Request(new URL('/_c8y_nitro/readiness', server.url)))

    expect(res2.status).toEqual(200)
  })

  it('should correctly restrict access to a protected route based on user roles', async () => {
    // Set mock data directly - since db.mjs is external, this is shared with the server
    mockData.currentUser = {
      userName: 'someUser',
      effectiveRoles: [{
        // does not have the required ADMIN_ROLE
        name: 'SOME_CUSTOM_ROLE',
      }],
    }

    const { server } = await createC8yNitroServer({
      env: completeEnv,
    })

    const res = await server.fetch(new Request(new URL('/protectedRoute', server.url)))

    const json = await res.json()

    expect(json).toEqual({ message: 'User does not have the required role to access this resource: ADMIN_ROLE' })
    expect(res.status).toEqual(403)

    // Update mock data for second test case
    mockData.currentUser = {
      userName: 'adminUser',
      effectiveRoles: [{
        name: 'ADMIN_ROLE',
      }],
    }

    const res2 = await server.fetch(new Request(new URL('/protectedRoute', server.url)))

    expect(res2.status).toEqual(200)

    const json2 = await res2.json()
    expect(json2.message).toBe('You have access to the protected route!')
  })
})
