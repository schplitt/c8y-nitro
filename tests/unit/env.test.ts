import { describe, expect, it } from 'vitest'
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { loadDotenv } from 'c12'
import { applyC8yNitroEnvVars, resolveEnvFileNames, toPrefixedEnvVar } from '../../src/cli/utils/env'

async function makeTempDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'c8y-nitro-env-test-'))
}

describe('env', () => {
  describe('toPrefixedEnvVar', () => {
    it('maps C8Y_* names to C8Y_NITRO_*', () => {
      expect(toPrefixedEnvVar('C8Y_DEVELOPMENT_USER')).toBe('C8Y_NITRO_DEVELOPMENT_USER')
      expect(toPrefixedEnvVar('C8Y_BASEURL')).toBe('C8Y_NITRO_BASEURL')
    })
  })

  describe('resolveEnvFileNames', () => {
    it('defaults to the local .env and .env.local', () => {
      expect(resolveEnvFileNames('/project')).toEqual(['.env', '.env.local'])
    })

    it('accepts a single file entry and puts it before the local files', async () => {
      const root = await makeTempDir()
      const project = join(root, 'apps', 'service')
      await mkdir(project, { recursive: true })
      await writeFile(join(root, '.env'), 'A=1\n')

      expect(resolveEnvFileNames(project, '../../.env')).toEqual([
        join(root, '.env'),
        '.env',
        '.env.local',
      ])
    })

    it('expands a directory entry to its .env and .env.local', async () => {
      const root = await makeTempDir()
      const project = join(root, 'apps', 'service')
      await mkdir(project, { recursive: true })

      expect(resolveEnvFileNames(project, '../..')).toEqual([
        join(root, '.env'),
        join(root, '.env.local'),
        '.env',
        '.env.local',
      ])
    })

    it('keeps a non-existing file entry as-is (c12 skips missing files)', () => {
      expect(resolveEnvFileNames('/project', '/nowhere/.env.shared')).toEqual([
        '/nowhere/.env.shared',
        '.env',
        '.env.local',
      ])
    })
  })

  describe('applyC8yNitroEnvVars', () => {
    it('copies prefixed variables onto their unprefixed counterparts', () => {
      const env: Record<string, string | undefined> = {
        C8Y_NITRO_DEVELOPMENT_USER: 'nitro-user',
        C8Y_NITRO_BASEURL: 'https://nitro.example.com',
      }

      applyC8yNitroEnvVars(env)

      expect(env.C8Y_DEVELOPMENT_USER).toBe('nitro-user')
      expect(env.C8Y_BASEURL).toBe('https://nitro.example.com')
    })

    it('prefers the prefixed variant over an existing unprefixed value', () => {
      const env: Record<string, string | undefined> = {
        C8Y_DEVELOPMENT_USER: 'other-tool-user',
        C8Y_NITRO_DEVELOPMENT_USER: 'nitro-user',
      }

      applyC8yNitroEnvVars(env)

      expect(env.C8Y_DEVELOPMENT_USER).toBe('nitro-user')
    })

    it('leaves unprefixed values alone when no prefixed variant is set', () => {
      const env: Record<string, string | undefined> = {
        C8Y_DEVELOPMENT_USER: 'plain-user',
      }

      applyC8yNitroEnvVars(env)

      expect(env.C8Y_DEVELOPMENT_USER).toBe('plain-user')
      expect(env.C8Y_NITRO_DEVELOPMENT_USER).toBeUndefined()
    })
  })

  describe('loading order (via c12 loadDotenv)', () => {
    it('lets the local .env override a shared monorepo .env', async () => {
      const root = await makeTempDir()
      const project = join(root, 'apps', 'service')
      await mkdir(project, { recursive: true })
      await writeFile(join(root, '.env'), 'C8Y_DEVELOPMENT_TENANT=shared\nC8Y_BASEURL=https://shared.example.com\n')
      await writeFile(join(project, '.env'), 'C8Y_DEVELOPMENT_TENANT=local\n')

      const env = await loadDotenv({
        cwd: project,
        fileName: resolveEnvFileNames(project, '../../.env'),
      })

      expect(env.C8Y_DEVELOPMENT_TENANT).toBe('local')
      expect(env.C8Y_BASEURL).toBe('https://shared.example.com')
    })

    it('resolves prefixed variables from a shared env file', async () => {
      const root = await makeTempDir()
      const project = join(root, 'apps', 'service')
      await mkdir(project, { recursive: true })
      await writeFile(join(root, '.env'), 'C8Y_DEVELOPMENT_USER=go-c8y-cli-user\nC8Y_NITRO_DEVELOPMENT_USER=nitro-user\n')

      const env = await loadDotenv({
        cwd: project,
        fileName: resolveEnvFileNames(project, '../../.env'),
      })
      applyC8yNitroEnvVars(env)

      expect(env.C8Y_DEVELOPMENT_USER).toBe('nitro-user')
    })
  })
})
