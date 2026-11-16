import { TestRunner } from 'vitest'

/**
 * Scope-aware arrange calls.
 *
 * While Vitest collects a file, `c8y.*` calls do not change state. They are
 * recorded for the scope they were called in (file top level or a
 * `describe`), and the setup file replays them before every test, outer
 * scopes first (see `world.ts`): the scopes that share a service instance
 * before it starts, the deeper ones before each test. Inside a test (or a
 * `beforeEach`), calls apply immediately and are undone by the reset before
 * the next test.
 */
let phase: 'collect' | 'run' = 'collect'

/**
 * Called from the setup file's `beforeAll`, which runs after collection.
 */
export function markRunning(): void {
  phase = 'run'
}

/**
 * The error for test-time APIs in a concurrent test. Vitest 5 has no
 * `.sequential` modifier: a test opts out with `{ concurrent: false }`.
 * @param name - API name for error messages
 * @param test - Name of the concurrent test
 */
export function concurrentError(name: string, test: string): Error {
  return new Error(`${name} cannot be used in concurrent tests ("${test}"): the fake Cumulocity tenant is shared by all tests of a file. Remove \`.concurrent\`, or pass \`{ concurrent: false }\` to the test or describe (for example when \`sequence.concurrent\` is on).`)
}

export interface Arrangement {
  /**
   * API name for error messages, e.g. `c8y.device()`
   */
  name: string
  operation: () => void
}

/**
 * The arrange calls of each scope (suite or file task), in call order.
 */
const arrangements = new WeakMap<object, Arrangement[]>()

/**
 * The arrange calls recorded for a scope.
 * @param scope - A suite or file task
 */
export function arrangementsOf(scope: object): readonly Arrangement[] {
  return arrangements.get(scope) ?? []
}

/**
 * Runs an arrange operation in the scope it was called from.
 * @param name - API name for error messages, e.g. `c8y.device()`
 * @param operation - Applies the change to the fake tenant
 */
export function arrange(name: string, operation: () => void): void {
  if (phase === 'collect') {
    const scope = currentScope()
    arrangements.set(scope, [...arrangementsOf(scope), { name, operation }])
    return
  }
  assertActiveTest(name)
  operation()
}

/**
 * Names of the concurrent tests that run right now (set by the setup file).
 */
const runningConcurrent = new Set<string>()

/**
 * Records that a test starts or ends, for the concurrency checks.
 * @param test - The test
 * @param test.name - Its name
 * @param test.concurrent - Whether it runs concurrently
 * @param running - Whether it starts (`true`) or ends
 */
export function trackTest(test: { name: string, concurrent?: boolean }, running: boolean): void {
  if (!test.concurrent) {
    return
  }
  if (running) {
    runningConcurrent.add(test.name)
  } else {
    runningConcurrent.delete(test.name)
  }
}

/**
 * Whether concurrent tests run right now.
 */
export function isConcurrentRunning(): boolean {
  return runningConcurrent.size > 0
}

/**
 * Throws when a test-time API is used outside a running test, or in a
 * concurrent test (the fake tenant is shared by the tests of a file).
 * @param name - API name for error messages
 * @param where
 */
export function assertActiveTest(name: string, where = 'at file or describe level, in beforeEach(), or inside a test'): void {
  const test = TestRunner.getCurrentTest()
  if (!test && runningConcurrent.size > 0) {
    // Vitest has no single current test while concurrent tests run
    throw concurrentError(name, [...runningConcurrent][0]!)
  }
  if (!test) {
    throw new Error(`${name} cannot be used in beforeAll() or afterAll(). Call it ${where}.`)
  }
  if (test.concurrent) {
    throw concurrentError(name, test.name)
  }
}

/**
 * Whether Vitest is collecting the file (top level or `describe` callbacks),
 * not running tests.
 */
export function isCollecting(): boolean {
  return phase === 'collect'
}

/**
 * The suites (and the file) that run right now, outermost first (tracked by
 * the setup file through Vitest's runner).
 */
const runningSuites: object[] = []

/**
 * Records that Vitest starts or finishes running a suite.
 * @param suite - The suite or file task
 * @param running - Whether it starts (`true`) or finishes
 */
export function trackSuite(suite: object, running: boolean): void {
  if (running) {
    runningSuites.push(suite)
  } else {
    const index = runningSuites.lastIndexOf(suite)
    if (index !== -1) {
      runningSuites.splice(index, 1)
    }
  }
}

/**
 * The innermost suite (or the file) that runs right now, e.g. the one whose
 * `beforeAll` hook runs.
 */
export function runningSuite(): object | undefined {
  return runningSuites.at(-1)
}

/**
 * The Vitest suite being collected, or the file at the top level: the object
 * tests find as `task.suite` (or `task.file`) when they run.
 */
export function currentScope(): object {
  const collector = TestRunner.getCurrentSuite() as unknown as { suite?: object, file?: object }
  const scope = collector.suite ?? collector.file
  if (!scope) {
    throw new Error('c8y-nitro/testing: no Vitest suite is being collected')
  }
  return scope
}
