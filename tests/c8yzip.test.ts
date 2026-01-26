import { vol, fs as memFs } from 'memfs'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Buffer } from 'node:buffer'
import JSZip from 'jszip'
import type { C8YManifest } from '../src/types/manifest'
import { createC8yZip, resolveZipOutputPath } from '../src/module/c8yzip'

// Mock spinnies to silence output
vi.mock('spinnies', () => ({
  default: class {
    add() {}
    update() {}
    remove() {}
    stopAll() {}
  },
}))

// Mock docker module to return fake tar path
vi.mock('../src/module/docker', () => ({
  createDockerImage: vi.fn(() => Promise.resolve('/fake/.c8y/image.tar')),
}))

// Mock manifest module to return test manifest
const mockManifest = vi.hoisted(() => ({
  current: {
    name: 'test-service',
    version: '1.0.0',
    apiVersion: 'v2',
    key: 'test-service-key',
    type: 'MICROSERVICE',
  } as C8YManifest,
}))

vi.mock('../src/module/manifest', () => ({
  createC8yManifestFromNitro: vi.fn(() => Promise.resolve(mockManifest.current)),
}))

// Mock fs/promises with memfs
vi.mock('fs/promises', () => memFs.promises)

// Create a minimal mock Nitro instance
function createMockNitro(overrides: Record<string, unknown> = {}) {
  return {
    options: {
      rootDir: '/project',
      output: { dir: '/project/.output' },
      c8y: {},
      ...overrides,
    },
    logger: {
      success: vi.fn(),
      log: vi.fn(),
      info: vi.fn(),
      debug: vi.fn(),
    },
  } as unknown as Parameters<typeof createC8yZip>[0]
}

describe('c8yzip', () => {
  beforeEach(() => {
    vol.reset()
    // Set up fake image.tar in memfs
    vol.fromJSON({
      '/fake/.c8y/image.tar': 'fake docker image content',
    })
    // Reset mock manifest
    mockManifest.current = {
      name: 'test-service',
      version: '1.0.0',
      apiVersion: 'v2',
      key: 'test-service-key',
      type: 'MICROSERVICE',
      provider: { name: 'Test Provider' },
    }
  })

  describe('resolveZipOutputPath', () => {
    it('should generate default filename pattern', () => {
      const manifest: C8YManifest = {
        name: 'my-service',
        version: '1.2.3',
        apiVersion: 'v2',
        key: 'my-service-key',
        type: 'MICROSERVICE',
        provider: { name: 'Test Provider' },
      }

      const path = resolveZipOutputPath('/project', {}, manifest)

      expect(path).toBe('/project/my-service-1.2.3.zip')
    })

    it('should use custom string name', () => {
      const manifest: C8YManifest = {
        name: 'my-service',
        version: '1.2.3',
        apiVersion: 'v2',
        key: 'my-service-key',
        type: 'MICROSERVICE',
        provider: { name: 'Test Provider' },
      }

      const path = resolveZipOutputPath('/project', { name: 'custom.zip' }, manifest)

      expect(path).toBe('/project/custom.zip')
    })

    it('should use custom function name', () => {
      const manifest: C8YManifest = {
        name: 'my-service',
        version: '1.2.3',
        apiVersion: 'v2',
        key: 'my-service-key',
        type: 'MICROSERVICE',
        provider: { name: 'Test Provider' },
      }

      const path = resolveZipOutputPath(
        '/project',
        { name: (name, version) => `${name}_v${version}.zip` },
        manifest,
      )

      expect(path).toBe('/project/my-service_v1.2.3.zip')
    })

    it('should use custom output directory with default name', () => {
      const manifest: C8YManifest = {
        name: 'my-service',
        version: '1.2.3',
        apiVersion: 'v2',
        key: 'my-service-key',
        type: 'MICROSERVICE',
        provider: { name: 'Test Provider' },
      }

      const path = resolveZipOutputPath('/project', { outputDir: 'dist' }, manifest)

      expect(path).toBe('/project/dist/my-service-1.2.3.zip')
    })

    it('should use custom output directory with custom name', () => {
      const manifest: C8YManifest = {
        name: 'my-service',
        version: '1.2.3',
        apiVersion: 'v2',
        key: 'my-service-key',
        type: 'MICROSERVICE',
        provider: { name: 'Test Provider' },
      }

      const path = resolveZipOutputPath(
        '/project',
        { outputDir: 'build/zips', name: 'release.zip' },
        manifest,
      )

      expect(path).toBe('/project/build/zips/release.zip')
    })

    it('should handle nested output directories', () => {
      const manifest: C8YManifest = {
        name: 'my-service',
        version: '1.2.3',
        apiVersion: 'v2',
        key: 'my-service-key',
        type: 'MICROSERVICE',
        provider: { name: 'Test Provider' },
      }

      const path = resolveZipOutputPath(
        '/project',
        { outputDir: 'dist/production/v1' },
        manifest,
      )

      expect(path).toBe('/project/dist/production/v1/my-service-1.2.3.zip')
    })

    it('should handle function name with multiple manifest fields', () => {
      const manifest: C8YManifest = {
        name: 'my-service',
        version: '2.0.0-beta.1',
        apiVersion: 'v2',
        key: 'my-service-key',
        type: 'MICROSERVICE',
        provider: { name: 'Test Provider' },
      }

      const path = resolveZipOutputPath(
        '/project',
        {
          name: (name, version) => {
            const sanitizedVersion = version.replace(/[^0-9.a-zA-Z]/g, '_')
            return `${name}-${sanitizedVersion}-bundle.zip`
          },
        },
        manifest,
      )

      expect(path).toBe('/project/my-service-2.0.0_beta.1-bundle.zip')
    })
  })

  describe('createC8yZip', () => {
    it('should create a zip file with default name', async () => {
      const nitro = createMockNitro()

      await createC8yZip(nitro, {})

      const zipPath = '/project/test-service-1.0.0.zip'
      expect(vol.existsSync(zipPath)).toBe(true)
    })

    it('should verify zip contains exactly 2 files', async () => {
      const nitro = createMockNitro()

      await createC8yZip(nitro, {})

      const zipPath = '/project/test-service-1.0.0.zip'
      const zipBuffer = vol.readFileSync(zipPath) as Buffer
      const zip = await JSZip.loadAsync(zipBuffer)

      const fileNames = Object.keys(zip.files)
      expect(fileNames).toHaveLength(2)
      expect(fileNames).toContain('image.tar')
      expect(fileNames).toContain('cumulocity.json')
    })

    it('should verify zip content matches inputs', async () => {
      const nitro = createMockNitro()

      await createC8yZip(nitro, {})

      const zipPath = '/project/test-service-1.0.0.zip'
      const zipBuffer = vol.readFileSync(zipPath) as Buffer
      const zip = await JSZip.loadAsync(zipBuffer)

      // Verify image.tar content matches input
      const imageTarContent = await zip.file('image.tar')!.async('string')
      expect(imageTarContent).toBe('fake docker image content')

      // Verify cumulocity.json content matches manifest
      const manifestContent = await zip.file('cumulocity.json')!.async('string')
      const parsedManifest = JSON.parse(manifestContent)
      expect(parsedManifest).toEqual({
        name: 'test-service',
        version: '1.0.0',
        apiVersion: 'v2',
        key: 'test-service-key',
        type: 'MICROSERVICE',
        provider: { name: 'Test Provider' },
      })
    })

    it('should handle manifest with special characters', async () => {
      mockManifest.current = {
        name: 'test-service-ñ',
        version: '1.0.0-beta',
        apiVersion: 'v2',
        key: 'test-service-ñ-key',
        type: 'MICROSERVICE',
        provider: {
          name: 'Company™ Corp',
          domain: 'https://example.com',
        },
      }
      const nitro = createMockNitro()

      await createC8yZip(nitro, {})

      const zipPath = '/project/test-service-ñ-1.0.0-beta.zip'
      expect(vol.existsSync(zipPath)).toBe(true)

      const zipBuffer = vol.readFileSync(zipPath) as Buffer
      const zip = await JSZip.loadAsync(zipBuffer)

      const manifestContent = await zip.file('cumulocity.json')!.async('string')
      const parsedManifest = JSON.parse(manifestContent)
      expect(parsedManifest.name).toBe('test-service-ñ')
      expect(parsedManifest.provider.name).toBe('Company™ Corp')
    })

    it('should handle large tar buffer', async () => {
      const largeTarContent = Buffer.alloc(1024, 'x')
      vol.fromJSON({
        '/fake/.c8y/image.tar': largeTarContent,
      })

      const nitro = createMockNitro()

      await createC8yZip(nitro, {})

      const zipPath = '/project/test-service-1.0.0.zip'
      const zipBuffer = vol.readFileSync(zipPath) as Buffer
      const zip = await JSZip.loadAsync(zipBuffer)

      const imageTarContent = await zip.file('image.tar')!.async('nodebuffer')
      expect(imageTarContent.length).toBe(1024)
    })

    it('should create output directory if it does not exist', async () => {
      const nitro = createMockNitro()

      await createC8yZip(nitro, { outputDir: 'build/dist/zips' })

      expect(vol.existsSync('/project/build/dist/zips/test-service-1.0.0.zip')).toBe(true)
    })

    it('should handle complex manifest with all fields', async () => {
      mockManifest.current = {
        name: 'advanced-service',
        version: '3.2.1',
        apiVersion: 'v2',
        key: 'advanced-service-key',
        type: 'MICROSERVICE',
        contextPath: 'advanced-service',
        provider: {
          name: 'Test Corp',
          domain: 'https://testcorp.com',
          support: 'support@testcorp.com',
        },
        requiredRoles: ['ROLE_INVENTORY_READ', 'ROLE_INVENTORY_ADMIN'],
        resources: {
          cpu: '500m',
          memory: '512M',
        },
        isolation: 'MULTI_TENANT',
        livenessProbe: {
          httpGet: {
            path: '/_c8y_nitro/liveness',
          },
        },
        readinessProbe: {
          httpGet: {
            path: '/_c8y_nitro/readiness',
          },
        },
      }
      const nitro = createMockNitro()

      await createC8yZip(nitro, {})

      const zipPath = '/project/advanced-service-3.2.1.zip'
      const zipBuffer = vol.readFileSync(zipPath) as Buffer
      const zip = await JSZip.loadAsync(zipBuffer)

      const manifestContent = await zip.file('cumulocity.json')!.async('string')
      const parsedManifest = JSON.parse(manifestContent)

      expect(parsedManifest.requiredRoles).toEqual(['ROLE_INVENTORY_READ', 'ROLE_INVENTORY_ADMIN'])
      expect(parsedManifest.resources).toEqual({ cpu: '500m', memory: '512M' })
      expect(parsedManifest.isolation).toBe('MULTI_TENANT')
      expect(parsedManifest.livenessProbe.httpGet.path).toBe('/_c8y_nitro/liveness')
    })
  })
})
