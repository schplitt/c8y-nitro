/**
 * Test seam for `c8y-nitro/testing`. Its setup file stores replacements here
 * (on `globalThis`, so the server's copy of c8y-nitro sees them); in
 * production nothing is set and every helper returns `undefined`.
 */
const TESTING_HOOKS = Symbol.for('c8y-nitro.testing')

export interface C8yNitroTestingHooks {
  /**
   * WebSocket implementation for Notification 2.0 consumers.
   */
  WebSocket?: unknown
  /**
   * c8y-nitro's realtime client pool (tenant id to client), set by the
   * realtime utilities when they create the first client. The test layer
   * closes clients created during a test.
   */
  realtimePool?: Map<string, { close: () => Promise<void> }>
  /**
   * Stops the jobs of every `c8yTasks()` registry; registries add themselves
   * here when they are created. The test layer calls them when a service
   * instance stops, so its jobs do not run on into the next instance.
   */
  taskRegistries?: Set<() => void>
  /**
   * Resets module state that belongs to one app instance (realtime pool
   * wiring, the previous credentials of `c8y:tenantCredentialsUpdated`).
   * Modules add theirs; the test layer calls them when a service instance
   * stops and before the next one starts.
   */
  instanceState?: Set<() => void>
}

export function useTestingHooks(): C8yNitroTestingHooks | undefined {
  return (globalThis as Record<symbol, C8yNitroTestingHooks | undefined>)[TESTING_HOOKS]
}

export function setTestingHooks(hooks: C8yNitroTestingHooks): void {
  (globalThis as Record<symbol, C8yNitroTestingHooks | undefined>)[TESTING_HOOKS] = hooks
}
