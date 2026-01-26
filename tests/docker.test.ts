import { describe, expect, it } from 'vitest'
import { getDockerfileContent } from '../src/module/docker'

describe('docker', () => {
  describe('getDockerfileContent', () => {
    it('should generate Dockerfile with .output directory', () => {
      const content = getDockerfileContent('.output')

      expect(content).toMatchInlineSnapshot(`
        "FROM node:22-slim AS runtime

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
        "FROM node:22-slim AS runtime

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
  })
})
