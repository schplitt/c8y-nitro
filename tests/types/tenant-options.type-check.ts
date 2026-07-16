import type { Client } from '@c8y/client'
import { useTenantOption, useTenantOptions } from 'c8y-nitro/utils'
import type { ForeignTenantOptionCategory } from 'c8y-nitro/utils'

/**
 * Compile-time (type-level) tests for the tenant option API.
 *
 * This file is type-checked by `tsc --noEmit` but is not executed by the runtime
 * test suite (its name does not match the vitest `*.test.ts` glob). Each
 * `@ts-expect-error` asserts the following line *must* be a type error — `tsc`
 * fails if any of them stops erroring, so the guarantees can't silently regress.
 * @param client - Any Cumulocity client (only its type matters here)
 */
export function tenantOptionTypeChecks(client: Client) {
  // --- Own category: manifest keys autocomplete, dynamic keys allowed, credentials allowed ---
  const own = [
    useTenantOption(client, 'anyDynamicKey'),
    useTenantOptions(client).option('anyDynamicKey'),
    useTenantOptions(client).option('credentials.secret'),
  ]

  // --- Foreign category with an explicit key set: autocompletes the provided keys ---
  const foreignTyped = useTenantOptions<'featureA' | 'featureB'>(client, 'other-service').option('featureA')

  // Foreign category rejects credentials.* keys.
  // @ts-expect-error credentials.* cannot be accessed from a foreign category
  const foreignCredentials = useTenantOptions<'featureA'>(client, 'other-service').option('credentials.secret')

  // Foreign category with a declared key set rejects keys outside that set.
  // @ts-expect-error 'nope' is not part of the declared foreign key set
  const foreignUnknown = useTenantOptions<'featureA'>(client, 'other-service').option('nope')

  // --- Foreign handle with the default key set (any non-credentials string) ---
  const foreign: ForeignTenantOptionCategory = useTenantOptions(client, 'other-service')
  const foreignDynamic = foreign.option('anyForeignKey')
  // @ts-expect-error credentials.* cannot be accessed from a foreign category
  const foreignDefaultCredentials = foreign.option('credentials.secret')

  return { own, foreignTyped, foreignCredentials, foreignUnknown, foreignDynamic, foreignDefaultCredentials }
}
