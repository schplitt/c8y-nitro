import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createC8yManifest } from '../../src/module/manifest'

// Mock pkg-types to return our test package.json data
const mockPackageData = vi.hoisted(() => ({ current: {} as Record<string, unknown> }))

vi.mock('pkg-types', () => ({
  readPackage: vi.fn(() => Promise.resolve(mockPackageData.current)),
}))

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

      const manifest = await createC8yManifest('/project', {
        livenessProbe: {
          httpGet: { path: '/custom/liveness' },
        },
        readinessProbe: {
          httpGet: { path: '/custom/readiness' },
        },
      })

      expect(manifest.livenessProbe?.httpGet?.path).toBe('/custom/liveness')
      expect(manifest.readinessProbe?.httpGet?.path).toBe('/custom/readiness')
    })

    it('should merge options into manifest', async () => {
      mockPackageData.current = {
        name: 'my-service',
        version: '1.0.0',
        author: 'Test Author',
      }

      const manifest = await createC8yManifest('/project', {
        requiredRoles: ['ROLE_INVENTORY_READ', 'ROLE_INVENTORY_ADMIN'],
        resources: {
          cpu: '500m',
          memory: '512M',
        },
      })

      expect(manifest.requiredRoles).toEqual(['ROLE_INVENTORY_READ', 'ROLE_INVENTORY_ADMIN'])
      expect(manifest.resources).toEqual({ cpu: '500m', memory: '512M' })
    })

    it('should throw error when a setting default value is empty', async () => {
      mockPackageData.current = {
        name: 'my-service',
        version: '1.0.0',
        author: 'Test Author',
      }

      await expect(createC8yManifest('/project', {
        settings: [
          { key: 'valid.setting', defaultValue: 'configured' },
          { key: 'credentials.secret', defaultValue: '' },
        ],
      }))
        .rejects
        .toThrow('manifest.settings entries must define a non-empty defaultValue. Invalid keys: "credentials.secret"')
    })

    it('should throw error when a setting default value is missing', async () => {
      mockPackageData.current = {
        name: 'my-service',
        version: '1.0.0',
        author: 'Test Author',
      }

      await expect(createC8yManifest('/project', {
        settings: [
          { key: 'credentials.secret' } as never,
        ],
      }))
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

        const manifest = await createC8yManifest('/project', {
          settings: [{ key: 'credentials.mySecret', defaultValue: 'default' }],
        })

        expect(manifest.requiredRoles).toContain('ROLE_OPTION_MANAGEMENT_READ')
      })

      it('should add ROLE_OPTION_MANAGEMENT_READ alongside existing requiredRoles', async () => {
        mockPackageData.current = {
          name: 'my-service',
          version: '1.0.0',
          author: 'Test Author',
        }

        const manifest = await createC8yManifest('/project', {
          settings: [{ key: 'credentials.mySecret', defaultValue: 'default' }],
          requiredRoles: ['ROLE_INVENTORY_READ'],
        })

        expect(manifest.requiredRoles).toEqual(['ROLE_INVENTORY_READ', 'ROLE_OPTION_MANAGEMENT_READ'])
      })

      it('should NOT add ROLE_OPTION_MANAGEMENT_READ when user already has it', async () => {
        mockPackageData.current = {
          name: 'my-service',
          version: '1.0.0',
          author: 'Test Author',
        }

        const manifest = await createC8yManifest('/project', {
          settings: [{ key: 'credentials.mySecret', defaultValue: 'default' }],
          requiredRoles: ['ROLE_OPTION_MANAGEMENT_READ'],
        })

        expect(manifest.requiredRoles?.filter((r) => r === 'ROLE_OPTION_MANAGEMENT_READ')).toHaveLength(1)
      })

      it('should NOT add ROLE_OPTION_MANAGEMENT_READ when user has ROLE_OPTION_MANAGEMENT_ADMIN', async () => {
        mockPackageData.current = {
          name: 'my-service',
          version: '1.0.0',
          author: 'Test Author',
        }

        const manifest = await createC8yManifest('/project', {
          settings: [{ key: 'credentials.mySecret', defaultValue: 'default' }],
          requiredRoles: ['ROLE_OPTION_MANAGEMENT_ADMIN'],
        })

        expect(manifest.requiredRoles).not.toContain('ROLE_OPTION_MANAGEMENT_READ')
        expect(manifest.requiredRoles).toContain('ROLE_OPTION_MANAGEMENT_ADMIN')
      })

      it('should NOT add ROLE_OPTION_MANAGEMENT_READ when no settings are defined', async () => {
        mockPackageData.current = {
          name: 'my-service',
          version: '1.0.0',
          author: 'Test Author',
        }

        const manifest = await createC8yManifest('/project', {})

        expect(manifest.requiredRoles).toBeUndefined()
      })

      it('should NOT add ROLE_OPTION_MANAGEMENT_READ when settings array is empty', async () => {
        mockPackageData.current = {
          name: 'my-service',
          version: '1.0.0',
          author: 'Test Author',
        }

        const manifest = await createC8yManifest('/project', {
          settings: [],
        })

        expect(manifest.requiredRoles).toBeUndefined()
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

      const manifest = await createC8yManifest('/project', {
        requiredRoles: ['ROLE_APPLICATION_MANAGEMENT_ADMIN'],
        isolation: 'MULTI_TENANT',
      })

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
})
