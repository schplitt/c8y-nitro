import { defineEventHandler, getQuery } from 'nitro/h3'
import { useDeployedTenantClient, useTenantOptions } from 'c8y-nitro/utils'

/**
 * Exercises the foreign-category handle: read/write/list against another
 * category, including a single option via `.option(key)`. (The `credentials.*`
 * cross-category restriction is enforced purely at the type level — see
 * tests/types/tenant-options.type-check.ts.)
 */
export default defineEventHandler(async (event) => {
  const query = getQuery(event)
  const category = String(query.category ?? 'other-service')
  const client = await useDeployedTenantClient()

  const foreign = useTenantOptions(client, category)

  const initial = await foreign.option('foreignKey').read()
  await foreign.option('foreignKey').set('foreign-updated')
  const afterSet = await foreign.option('foreignKey').read()
  const listed = await foreign.list()

  // Single option in a foreign category goes through the category handle.
  const single = await useTenantOptions(client, category).option('extraKey').read()

  return {
    category,
    initial: initial ?? null,
    afterSet: afterSet ?? null,
    listed,
    single: single ?? null,
  }
})
