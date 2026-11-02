import { fileURLToPath } from 'node:url'
import { nitro } from 'nitro/vite'
import { configDefaults, defineConfig } from 'vitest/config'

const fixtureDir = fileURLToPath(new URL('./tests/server/fixture', import.meta.url))

// keep git worktrees (e.g. .claude/worktrees/*) out of test collection
const exclude = [...configDefaults.exclude, '**/.claude/**']

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'unit',
          include: ['tests/unit/**/*.test.ts'],
          exclude,
        },
      },
      // Server tests run in Nitro's Vitest environment: every test file gets its
      // own Nitro app built from `tests/server/fixture`, without a dev server.
      {
        plugins: [nitro({ rootDir: fixtureDir })],
        test: {
          name: 'server',
          environment: 'nitro',
          include: ['tests/server/**/*.test.ts'],
          exclude: [...exclude, 'tests/server/**/*.no-dev-user.test.ts'],
        },
      },
      // Same fixture with dev user injection disabled (a module option, so it
      // needs its own Nitro app config rather than a per-file override).
      {
        plugins: [nitro({ rootDir: fixtureDir, c8y: { dev: { injectUser: false } } })],
        test: {
          name: 'server-no-dev-user',
          environment: 'nitro',
          include: ['tests/server/**/*.no-dev-user.test.ts'],
          exclude,
        },
      },
    ],
  },
})
