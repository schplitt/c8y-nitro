import { c8yTenantOptionKeys } from 'c8y-nitro/runtime'
import { createError } from '../../../utils/logging'
import { useDeployedTenantClient } from '../../../utils/client'
import { useTenantOption, useTenantOptions } from '../../../utils/tenantOptions'
import { defineEventHandler, getQuery } from 'nitro/h3'

export default defineEventHandler(async (event) => {
  const query = getQuery(event)

  if ('all' in query) {
    await useTenantOptions.invalidateAll()

    return {
      message: 'success',
    }
  }

  const key = Array.isArray(query.key) ? query.key[0] : query.key

  if (!key) {
    throw createError({
      status: 400,
      message: 'Provide either the all or key query parameter',
      why: 'The tenant option invalidation route requires an explicit target',
      fix: 'Use ?all to invalidate all created tenant option caches or ?key=<manifest setting key> to invalidate one created cache entry',
    })
  }

  if (!c8yTenantOptionKeys.includes(key)) {
    throw createError({
      status: 400,
      message: 'Invalid tenant option invalidation request',
      why: 'Only tenant option keys declared in manifest.settings can be invalidated via this route',
      fix: 'Use ?all to invalidate all created tenant option caches or provide a valid manifest-defined key in ?key',
    })
  }

  // Invalidate the deployed tenant's own-category cache entry for this key
  // (no-op if it was never read).
  await useTenantOption(await useDeployedTenantClient(), key).invalidate()

  return {
    message: 'success',
  }
})
