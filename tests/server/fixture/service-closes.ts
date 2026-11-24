// How often Nitro's `close` hook ran (plugins/close-counter.ts), and how many
// slow close hooks ended (plugins/02-slow-close.ts). A module of its own:
// tests import it, and importing a plugin may load c8y-nitro/utils before
// Nitro created the app.
export const serviceCloses = { count: 0, slowDone: 0 }
