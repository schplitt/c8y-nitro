import { beforeEach, TestRunner } from 'vitest'

/**
 * Scope-aware arrange calls.
 *
 * While Vitest collects a file, `c8y.*` calls do not change state. They
 * register a `beforeEach` in the scope they were called in (file top level or
 * a `describe`), so Vitest's own hook order replays them before every test:
 * outer scopes first, then inner ones, after the reset to the plugin baseline.
 * Inside a test (or a `beforeEach`), calls apply immediately and are undone by
 * the reset before the next test.
 */
let phase: 'collect' | 'run' = 'collect'

/**
 * Called from the setup file's `beforeAll`, which runs after collection.
 */
export function markRunning(): void {
  phase = 'run'
}

/**
 * Runs an arrange operation in the scope it was called from.
 * @param name - API name for error messages, e.g. `c8y.user()`
 * @param operation - Applies the change to the fake tenant
 */
export function arrange(name: string, operation: () => void): void {
  if (phase === 'collect') {
    beforeEach((context) => {
      if (context.task.concurrent) {
        throw new Error(`${name} cannot be used in concurrent tests ("${context.task.name}"): the fake Cumulocity tenant is shared by all tests of a file. Run these tests sequentially.`)
      }
      operation()
    })
    return
  }
  assertActiveTest(name)
  operation()
}

/**
 * Throws when a test-time API is used outside a running test, or in a
 * concurrent test (the fake tenant is shared by the tests of a file).
 * @param name - API name for error messages
 */
export function assertActiveTest(name: string): void {
  const test = TestRunner.getCurrentTest()
  if (!test) {
    throw new Error(`${name} cannot be used in beforeAll() or afterAll(). Call it at file or describe level, in beforeEach(), or inside a test.`)
  }
  if (test.concurrent) {
    throw new Error(`${name} cannot be used in concurrent tests ("${test.name}"): the fake Cumulocity tenant is shared by all tests of a file. Run these tests sequentially.`)
  }
}
