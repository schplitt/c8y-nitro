import { Buffer } from 'node:buffer'
import process from 'node:process'
import { definePlugin } from 'nitro'

// Sends an unsupported platform request synchronously while the app is
// created (it runs before any async plugin), only when a test sets
// FIXTURE_SYNC_STARTUP_REQUEST (service-instance.test.ts).
export default definePlugin(() => {
  if (!process.env.FIXTURE_SYNC_STARTUP_REQUEST) {
    return
  }
  const { C8Y_BASEURL, C8Y_BOOTSTRAP_TENANT, C8Y_BOOTSTRAP_USER, C8Y_BOOTSTRAP_PASSWORD } = process.env
  const credentials = Buffer.from(`${C8Y_BOOTSTRAP_TENANT}/${C8Y_BOOTSTRAP_USER}:${C8Y_BOOTSTRAP_PASSWORD}`).toString('base64')
  fetch(`${C8Y_BASEURL}/features`, { headers: { authorization: `Basic ${credentials}` } }).catch(() => {})
})
