import { definePlugin } from 'nitro'

// Counts the service instances (Nitro apps) started in this test file: every
// new instance runs its plugins again, while module state stays.
let started = 0
let current = 0

export default definePlugin(() => {
  started += 1
  current = started
})

export function currentInstance(): number {
  return current
}
