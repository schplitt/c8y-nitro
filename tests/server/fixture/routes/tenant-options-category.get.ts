import { defineEventHandler } from 'nitro/h3'
import { useDeployedTenantClient, useTenantOptions } from 'c8y-nitro/utils'

/**
 * Exercises the own-category handle: bulk `setAll()` followed by `list()`.
 */
export default defineEventHandler(async () => {
  const client = await useDeployedTenantClient()
  const category = useTenantOptions(client)

  await category.setAll({
    bulkA: 'value-a',
    bulkB: 'value-b',
  })

  const listed = await category.list()

  return {
    listed,
    message: 'Category options listed successfully',
  }
})
