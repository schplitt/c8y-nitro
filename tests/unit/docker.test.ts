import { describe, expect, it } from 'vitest'
import { getDockerfileContent } from '../../src/module/docker'

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
})
