import { describe, expect, it } from 'vitest'
import { mkdtemp, writeFile, readFile, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { getDockerfileContent, writeDockerfile } from '../../src/module/docker'

describe('docker', () => {
  describe('getDockerfileContent', () => {
    it('should generate Dockerfile with .output directory', () => {
      const content = getDockerfileContent('.output')

      expect(content).toMatchInlineSnapshot(`
        "FROM node:24-slim AS runtime

        WORKDIR /app

        # Copy the Nitro build output
        COPY .output/ .output/

        ENV NODE_ENV=production
        ENV PORT=80

        EXPOSE 80

        # Run the Nitro server entrypoint. Use source maps to aid debugging if present.
        CMD ["node", "--enable-source-maps", ".output/server/index.mjs"]"
      `)
    })

    it('should generate Dockerfile with custom output directory', () => {
      const content = getDockerfileContent('dist')

      expect(content).toMatchInlineSnapshot(`
        "FROM node:24-slim AS runtime

        WORKDIR /app

        # Copy the Nitro build output
        COPY dist/ dist/

        ENV NODE_ENV=production
        ENV PORT=80

        EXPOSE 80

        # Run the Nitro server entrypoint. Use source maps to aid debugging if present.
        CMD ["node", "--enable-source-maps", "dist/server/index.mjs"]"
      `)
    })

    it('should use a custom base image', () => {
      const content = getDockerfileContent('.output', { baseImage: 'node:24-bookworm-slim' })

      expect(content).toContain('FROM node:24-bookworm-slim AS runtime')
      expect(content).not.toContain('node:24-slim AS runtime')
    })

    it('should insert extra instructions before the build output copy', () => {
      const content = getDockerfileContent('.output', {
        extraInstructions: [
          'RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates && rm -rf /var/lib/apt/lists/*',
          'RUN update-ca-certificates',
        ],
      })

      expect(content).toMatchInlineSnapshot(`
        "FROM node:24-slim AS runtime

        WORKDIR /app

        RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates && rm -rf /var/lib/apt/lists/*
        RUN update-ca-certificates

        # Copy the Nitro build output
        COPY .output/ .output/

        ENV NODE_ENV=production
        ENV PORT=80

        EXPOSE 80

        # Run the Nitro server entrypoint. Use source maps to aid debugging if present.
        CMD ["node", "--enable-source-maps", ".output/server/index.mjs"]"
      `)
    })

    it('should keep the default template for an empty extraInstructions array', () => {
      expect(getDockerfileContent('.output', { extraInstructions: [] }))
        .toBe(getDockerfileContent('.output'))
    })
  })

  describe('writeDockerfile', () => {
    async function setupDirs() {
      const base = await mkdtemp(join(tmpdir(), 'c8y-nitro-docker-test-'))
      const outputDir = join(base, '.output')
      await mkdir(outputDir, { recursive: true })
      return { base, outputDir }
    }

    it('should write a generated Dockerfile when no custom dockerfile is set', async () => {
      const { base, outputDir } = await setupDirs()

      await writeDockerfile(outputDir, base, {})

      const written = await readFile(join(base, '.c8y', 'Dockerfile'), 'utf-8')
      expect(written).toBe(getDockerfileContent('.output'))
    })

    it('should copy the custom Dockerfile when dockerfile option is set', async () => {
      const { base, outputDir } = await setupDirs()

      const customContent = 'FROM custom-image\nCMD ["node", "server.mjs"]'
      const customDockerfilePath = join(base, 'MyDockerfile')
      await writeFile(customDockerfilePath, customContent, 'utf-8')

      await writeDockerfile(outputDir, base, { dockerfile: 'MyDockerfile' })

      const written = await readFile(join(base, '.c8y', 'Dockerfile'), 'utf-8')
      expect(written).toBe(customContent)
    })

    it('should resolve the custom dockerfile path relative to rootDir', async () => {
      const { base, outputDir } = await setupDirs()

      const subDir = join(base, 'docker')
      await mkdir(subDir, { recursive: true })
      const customContent = 'FROM custom-image'
      await writeFile(join(subDir, 'Dockerfile'), customContent, 'utf-8')

      await writeDockerfile(outputDir, base, { dockerfile: 'docker/Dockerfile' })

      const written = await readFile(join(base, '.c8y', 'Dockerfile'), 'utf-8')
      expect(written).toBe(customContent)
    })

    it('should not use baseImage or extraInstructions when a custom dockerfile is provided', async () => {
      const { base, outputDir } = await setupDirs()

      const customContent = 'FROM custom-image'
      await writeFile(join(base, 'Dockerfile'), customContent, 'utf-8')

      await writeDockerfile(outputDir, base, {
        dockerfile: 'Dockerfile',
        baseImage: 'node:22-slim',
        extraInstructions: ['RUN echo ignored'],
      })

      const written = await readFile(join(base, '.c8y', 'Dockerfile'), 'utf-8')
      expect(written).toBe(customContent)
      expect(written).not.toContain('node:22-slim')
      expect(written).not.toContain('RUN echo ignored')
    })
  })
})
