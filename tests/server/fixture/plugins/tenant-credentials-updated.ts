import type { TenantCredentials } from 'c8y-nitro/types'
import { consola } from 'consola'
import { definePlugin } from 'nitro'

export interface CredentialHookEvent {
  prevTenants: string[] | null
  nextTenants: string[]
}

const credentialHookEvents: CredentialHookEvent[] = []

export function recordCredentialHookEvent(
  prev: TenantCredentials | null,
  next: TenantCredentials,
): CredentialHookEvent {
  const event: CredentialHookEvent = {
    prevTenants: prev ? Object.keys(prev).sort() : null,
    nextTenants: Object.keys(next).sort(),
  }

  credentialHookEvents.push(event)

  return event
}

export function getCredentialHookEvents(): CredentialHookEvent[] {
  return credentialHookEvents.map((event) => ({
    prevTenants: event.prevTenants ? [...event.prevTenants] : null,
    nextTenants: [...event.nextTenants],
  }))
}

export function clearCredentialHookEvents(): void {
  credentialHookEvents.length = 0
}

export default definePlugin((nitroApp) => {
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore -- VS Code does not always pick up the c8y-nitro Nitro hook augmentation in this fixture plugin.
  nitroApp.hooks.hook('c8y:tenantCredentialsUpdated', (prev, next) => {
    const event = recordCredentialHookEvent(prev, next)

    consola.info(
      `[test-hook] c8y:tenantCredentialsUpdated prev=${event.prevTenants?.join(',') ?? 'null'} next=${event.nextTenants.join(',')}`,
    )
  })
})
