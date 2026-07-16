import { defineEventHandler, getQuery } from 'nitro/h3'
import { useDeployedTenantClient, useTenantOption } from 'c8y-nitro/utils'

/**
 * Exercises the single-option handle (own category), including a dynamic
 * (non-manifest) key to cover issue #63.
 */
export default defineEventHandler(async (event) => {
  const query = getQuery(event)
  const key = String(query.key ?? 'myOption')
  const client = await useDeployedTenantClient()
  const option = useTenantOption(client, key)

  const before = await option.read()
  await option.set('crud-value')
  const afterSet = await option.read()

  const seeded = await useTenantOption(client, `${key}.seeded`).getOrInsert('seeded-default')
  const seededAgain = await useTenantOption(client, `${key}.seeded`).getOrInsert('ignored-default')

  await option.delete()
  const afterDelete = await option.read()

  return {
    key,
    before: before ?? null,
    afterSet: afterSet ?? null,
    seeded,
    seededAgain,
    afterDelete: afterDelete ?? null,
  }
})
