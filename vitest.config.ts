import { configDefaults, defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // keep git worktrees (e.g. .claude/worktrees/*) out of test collection
    exclude: [...configDefaults.exclude, '**/.claude/**'],
  },
})
