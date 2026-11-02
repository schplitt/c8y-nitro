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
}

export function useTestingHooks(): C8yNitroTestingHooks | undefined {
  return (globalThis as Record<symbol, C8yNitroTestingHooks | undefined>)[TESTING_HOOKS]
}

export function setTestingHooks(hooks: C8yNitroTestingHooks): void {
  (globalThis as Record<symbol, C8yNitroTestingHooks | undefined>)[TESTING_HOOKS] = hooks
}
