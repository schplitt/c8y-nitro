import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { C8YManifestOptions } from '../../src/types/manifest'
import {
  createC8yManifest,
  extractManifestInputs,
  resolveNitroOpenApiRoute,
} from '../../src/module/manifest'

// Mock pkg-types to return our test package.json data
const mockPackageData = vi.hoisted(() => ({ current: {} as Record<string, unknown> }))

vi.mock('pkg-types', () => ({
  readPackage: vi.fn(() => Promise.resolve(mockPackageData.current)),
}))

/**
 * Wrap legacy "user manifest options" into the Nitro-config shape now accepted
 * by createC8yManifest. Keeps each test focused on its specific assertion.
 * @param manifest - User manifest options
 */
function nitroConfigWithManifest(manifest: C8YManifestOptions = {}) {
  return { c8y: { manifest } }
}

describe('manifest generation', () => {
  beforeEach(() => {
    mockPackageData.current = {}
  })

  describe('createC8yManifest', () => {
    it('should create a basic manifest from package.json', async () => {
      mockPackageData.current = {
        name: 'my-service',
        version: '1.2.3',
        author: 'Test Author',
      }

      const manifest = await createC8yManifest('/project')

      expect(manifest.name).toBe('my-service')
      expect(manifest.version).toBe('1.2.3')
      expect(manifest.key).toBe('my-service-key')
      expect(manifest.apiVersion).toBe('v2')
      expect(manifest.type).toBe('MICROSERVICE')
    })

    it('should strip scope from package name', async () => {
      mockPackageData.current = {
        name: '@myorg/my-service',
        version: '1.0.0',
        author: 'Test Author',
      }

      const manifest = await createC8yManifest('/project')

      expect(manifest.name).toBe('my-service')
      expect(manifest.key).toBe('my-service-key')
    })

    it('should extract provider from author object', async () => {
      mockPackageData.current = {
        name: 'my-service',
        version: '1.0.0',
        author: {
          name: 'Company Name',
          email: 'support@company.com',
          url: 'https://company.com',
        },
      }

      const manifest = await createC8yManifest('/project')

      expect(manifest.provider).toEqual({
        name: 'Company Name',
        domain: 'https://company.com',
        support: 'support@company.com',
      })
    })

    it('should use homepage as provider domain', async () => {
      mockPackageData.current = {
        name: 'my-service',
        version: '1.0.0',
        author: 'Test Author',
        homepage: 'https://homepage.example.com',
      }

      const manifest = await createC8yManifest('/project')

      expect(manifest.provider?.domain).toBe('https://homepage.example.com')
    })

    it('should use bugs url as provider support', async () => {
      mockPackageData.current = {
        name: 'my-service',
        version: '1.0.0',
        author: 'Test Author',
        bugs: {
          url: 'https://github.com/org/repo/issues',
        },
      }

      const manifest = await createC8yManifest('/project')

      expect(manifest.provider?.support).toBe('https://github.com/org/repo/issues')
    })

    it('should use bugs string as provider support', async () => {
      mockPackageData.current = {
        name: 'my-service',
        version: '1.0.0',
        author: 'Test Author',
        bugs: 'https://github.com/org/repo/issues',
      }

      const manifest = await createC8yManifest('/project')

      expect(manifest.provider?.support).toBe('https://github.com/org/repo/issues')
    })

    it('should set default liveness and readiness probe paths', async () => {
      mockPackageData.current = {
        name: 'my-service',
        version: '1.0.0',
        author: 'Test Author',
      }

      const manifest = await createC8yManifest('/project')

      expect(manifest.livenessProbe?.httpGet?.path).toBe('/_c8y_nitro/liveness')
      expect(manifest.readinessProbe?.httpGet?.path).toBe('/_c8y_nitro/readiness')
    })

    it('should preserve custom probe httpGet paths from options', async () => {
      mockPackageData.current = {
        name: 'my-service',
        version: '1.0.0',
        author: 'Test Author',
      }

      const manifest = await createC8yManifest('/project', nitroConfigWithManifest({
        livenessProbe: {
          httpGet: { path: '/custom/liveness' },
        },
        readinessProbe: {
          httpGet: { path: '/custom/readiness' },
        },
      }))

      expect(manifest.livenessProbe?.httpGet?.path).toBe('/custom/liveness')
      expect(manifest.readinessProbe?.httpGet?.path).toBe('/custom/readiness')
    })

    it('should merge options into manifest', async () => {
      mockPackageData.current = {
        name: 'my-service',
        version: '1.0.0',
        author: 'Test Author',
      }

      const manifest = await createC8yManifest('/project', nitroConfigWithManifest({
        requiredRoles: ['ROLE_INVENTORY_READ', 'ROLE_INVENTORY_ADMIN'],
        resources: {
          cpu: '500m',
          memory: '512M',
        },
      }))

      expect(manifest.requiredRoles).toEqual(['ROLE_INVENTORY_READ', 'ROLE_INVENTORY_ADMIN'])
      expect(manifest.resources).toEqual({ cpu: '500m', memory: '512M' })
    })

    it('should throw error when a setting default value is empty', async () => {
      mockPackageData.current = {
        name: 'my-service',
        version: '1.0.0',
        author: 'Test Author',
      }

      await expect(createC8yManifest('/project', nitroConfigWithManifest({
        settings: [
          { key: 'valid.setting', defaultValue: 'configured' },
          { key: 'credentials.secret', defaultValue: '' },
        ],
      })))
        .rejects
        .toThrow('manifest.settings entries must define a non-empty defaultValue. Invalid keys: "credentials.secret"')
    })

    it('should throw error when a setting default value is missing', async () => {
      mockPackageData.current = {
        name: 'my-service',
        version: '1.0.0',
        author: 'Test Author',
      }

      await expect(createC8yManifest('/project', nitroConfigWithManifest({
        settings: [
          { key: 'credentials.secret' } as never,
        ],
      })))
        .rejects
        .toThrow('manifest.settings entries must define a non-empty defaultValue. Invalid keys: "credentials.secret"')
    })

    describe('auto ROLE_OPTION_MANAGEMENT_READ injection', () => {
      it('should add ROLE_OPTION_MANAGEMENT_READ when settings are defined and requiredRoles is empty', async () => {
        mockPackageData.current = {
          name: 'my-service',
          version: '1.0.0',
          author: 'Test Author',
        }

        const manifest = await createC8yManifest('/project', nitroConfigWithManifest({
          settings: [{ key: 'credentials.mySecret', defaultValue: 'default' }],
        }))

        expect(manifest.requiredRoles).toContain('ROLE_OPTION_MANAGEMENT_READ')
      })

      it('should add ROLE_OPTION_MANAGEMENT_READ alongside existing requiredRoles', async () => {
        mockPackageData.current = {
          name: 'my-service',
          version: '1.0.0',
          author: 'Test Author',
        }

        const manifest = await createC8yManifest('/project', nitroConfigWithManifest({
          settings: [{ key: 'credentials.mySecret', defaultValue: 'default' }],
          requiredRoles: ['ROLE_INVENTORY_READ'],
        }))

        expect(manifest.requiredRoles).toEqual(['ROLE_INVENTORY_READ', 'ROLE_OPTION_MANAGEMENT_READ'])
      })

      it('should NOT add ROLE_OPTION_MANAGEMENT_READ when user already has it', async () => {
        mockPackageData.current = {
          name: 'my-service',
          version: '1.0.0',
          author: 'Test Author',
        }

        const manifest = await createC8yManifest('/project', nitroConfigWithManifest({
          settings: [{ key: 'credentials.mySecret', defaultValue: 'default' }],
          requiredRoles: ['ROLE_OPTION_MANAGEMENT_READ'],
        }))

        expect(manifest.requiredRoles?.filter((r) => r === 'ROLE_OPTION_MANAGEMENT_READ')).toHaveLength(1)
      })

      it('should NOT add ROLE_OPTION_MANAGEMENT_READ when user has ROLE_OPTION_MANAGEMENT_ADMIN', async () => {
        mockPackageData.current = {
          name: 'my-service',
          version: '1.0.0',
          author: 'Test Author',
        }

        const manifest = await createC8yManifest('/project', nitroConfigWithManifest({
          settings: [{ key: 'credentials.mySecret', defaultValue: 'default' }],
          requiredRoles: ['ROLE_OPTION_MANAGEMENT_ADMIN'],
        }))

        expect(manifest.requiredRoles).not.toContain('ROLE_OPTION_MANAGEMENT_READ')
        expect(manifest.requiredRoles).toContain('ROLE_OPTION_MANAGEMENT_ADMIN')
      })

      it('should NOT add ROLE_OPTION_MANAGEMENT_READ when no settings are defined', async () => {
        mockPackageData.current = {
          name: 'my-service',
          version: '1.0.0',
          author: 'Test Author',
        }

        const manifest = await createC8yManifest('/project', nitroConfigWithManifest({}))

        expect(manifest.requiredRoles).toBeUndefined()
      })

      it('should NOT add ROLE_OPTION_MANAGEMENT_READ when settings array is empty', async () => {
        mockPackageData.current = {
          name: 'my-service',
          version: '1.0.0',
          author: 'Test Author',
        }

        const manifest = await createC8yManifest('/project', nitroConfigWithManifest({
          settings: [],
        }))

        expect(manifest.requiredRoles).toBeUndefined()
      })
    })

    describe('openApiSpec auto-injection', () => {
      beforeEach(() => {
        mockPackageData.current = {
          name: 'my-service',
          version: '1.0.0',
          author: 'Test Author',
        }
      })

      it('does NOT add openApiSpec when Nitro OpenAPI is not enabled', async () => {
        const manifest = await createC8yManifest('/project')

        expect(manifest.openApiSpec).toBeUndefined()
      })

      it('does NOT add openApiSpec when experimental.openAPI is enabled but no production output is configured', async () => {
        const manifest = await createC8yManifest('/project', {
          experimental: { openAPI: true },
        })

        expect(manifest.openApiSpec).toBeUndefined()
      })

      it('does NOT add openApiSpec when openAPI.production is false', async () => {
        const manifest = await createC8yManifest('/project', {
          experimental: { openAPI: true },
          openAPI: { production: false },
        })

        expect(manifest.openApiSpec).toBeUndefined()
      })

      it('adds the default openApiSpec when openAPI.production is "runtime"', async () => {
        const manifest = await createC8yManifest('/project', {
          experimental: { openAPI: true },
          openAPI: { production: 'runtime' },
        })

        expect(manifest.openApiSpec).toBe('/_openapi.json')
      })

      it('adds the default openApiSpec when openAPI.production is "prerender"', async () => {
        const manifest = await createC8yManifest('/project', {
          experimental: { openAPI: true },
          openAPI: { production: 'prerender' },
        })

        expect(manifest.openApiSpec).toBe('/_openapi.json')
      })

      it('uses the custom openAPI.route when configured', async () => {
        const manifest = await createC8yManifest('/project', {
          experimental: { openAPI: true },
          openAPI: { production: 'runtime', route: '/api/spec.json' },
        })

        expect(manifest.openApiSpec).toBe('/api/spec.json')
      })

      it('composes with user manifest options from c8y.manifest', async () => {
        const manifest = await createC8yManifest('/project', {
          c8y: { manifest: { requiredRoles: ['ROLE_INVENTORY_READ'] } },
          experimental: { openAPI: true },
          openAPI: { production: 'runtime' },
        })

        expect(manifest.openApiSpec).toBe('/_openapi.json')
        expect(manifest.requiredRoles).toEqual(['ROLE_INVENTORY_READ'])
      })
    })

    it('should throw error when package.json is missing required fields', async () => {
      mockPackageData.current = {
        name: 'my-service',
        // missing version and author
      }

      await expect(createC8yManifest('/project'))
        .rejects
        .toThrow('package.json must contain name, version, and author name fields')
    })

    it('should produce complete manifest structure', async () => {
      mockPackageData.current = {
        name: '@scope/test-microservice',
        version: '2.0.0',
        author: {
          name: 'Acme Corp',
          url: 'https://acme.com',
        },
        homepage: 'https://acme.com/products/test',
        bugs: 'https://support.acme.com',
      }

      const manifest = await createC8yManifest('/project', nitroConfigWithManifest({
        requiredRoles: ['ROLE_APPLICATION_MANAGEMENT_ADMIN'],
        isolation: 'MULTI_TENANT',
      }))

      expect(manifest).toEqual(
        {
          apiVersion: 'v2',
          contextPath: 'test-microservice',
          isolation: 'MULTI_TENANT',
          key: 'test-microservice-key',
          livenessProbe: {
            httpGet: {
              path: '/_c8y_nitro/liveness',
            },
          },
          name: 'test-microservice',
          provider: {
            domain: 'https://acme.com',
            name: 'Acme Corp',
            support: 'https://support.acme.com',
          },
          readinessProbe: {
            httpGet: {
              path: '/_c8y_nitro/readiness',
            },
          },
          requiredRoles: [
            'ROLE_APPLICATION_MANAGEMENT_ADMIN',
          ],
          type: 'MICROSERVICE',
          version: '2.0.0',
        },
      )
    })
  })

  describe('resolveNitroOpenApiRoute', () => {
    it('returns null when experimental.openAPI is not enabled', () => {
      expect(resolveNitroOpenApiRoute({})).toBeNull()
      expect(resolveNitroOpenApiRoute({ experimental: {} })).toBeNull()
      expect(resolveNitroOpenApiRoute({ experimental: { openAPI: false } })).toBeNull()
    })

    it('returns null when experimental.openAPI is enabled but production is disabled', () => {
      expect(
        resolveNitroOpenApiRoute({ experimental: { openAPI: true } }),
      ).toBeNull()
      expect(
        resolveNitroOpenApiRoute({
          experimental: { openAPI: true },
          openAPI: { production: false },
        }),
      ).toBeNull()
    })

    it('returns the default route when both flags are enabled and no route is configured', () => {
      expect(
        resolveNitroOpenApiRoute({
          experimental: { openAPI: true },
          openAPI: { production: 'runtime' },
        }),
      ).toBe('/_openapi.json')

      expect(
        resolveNitroOpenApiRoute({
          experimental: { openAPI: true },
          openAPI: { production: 'prerender' },
        }),
      ).toBe('/_openapi.json')
    })

    it('returns the configured custom route', () => {
      expect(
        resolveNitroOpenApiRoute({
          experimental: { openAPI: true },
          openAPI: { production: 'runtime', route: '/api/openapi.json' },
        }),
      ).toBe('/api/openapi.json')
    })

    it('falls back to default when route is an empty string', () => {
      expect(
        resolveNitroOpenApiRoute({
          experimental: { openAPI: true },
          openAPI: { production: 'runtime', route: '' },
        }),
      ).toBe('/_openapi.json')
    })
  })

  describe('extractManifestInputs', () => {
    it('returns empty options and no openApiSpec for an empty config', () => {
      expect(extractManifestInputs({})).toEqual({
        options: {},
        openApiSpec: undefined,
      })
    })

    it('pulls manifest options from c8y.manifest', () => {
      const result = extractManifestInputs({
        c8y: { manifest: { isolation: 'PER_TENANT' } },
      })

      expect(result.options).toEqual({ isolation: 'PER_TENANT' })
      expect(result.openApiSpec).toBeUndefined()
    })

    it('derives openApiSpec when Nitro OpenAPI is enabled for production', () => {
      const result = extractManifestInputs({
        experimental: { openAPI: true },
        openAPI: { production: 'runtime', route: '/spec' },
      })

      expect(result.options).toEqual({})
      expect(result.openApiSpec).toBe('/spec')
    })
  })
})
