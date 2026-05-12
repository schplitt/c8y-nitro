import * as c8yClient from '@c8y/client'
import { defineEventHandler, getQuery } from 'nitro/h3'

const mockTenantOptionApi = c8yClient as unknown as {
  __setMockTenantOption: (key: string, value: string) => void
  __deleteMockTenantOption: (key: string) => void
  __getMockTenantOption: (key: string) => string | undefined
}

export default defineEventHandler((event) => {
  const query = getQuery(event)
  const key = String(query.key ?? '')

  if (!key) {
    return {
      message: 'Missing key',
    }
  }

  if (query.value === undefined) {
    mockTenantOptionApi.__deleteMockTenantOption(key)
  } else {
    mockTenantOptionApi.__setMockTenantOption(key, String(query.value))
  }

  return {
    key,
    value: mockTenantOptionApi.__getMockTenantOption(key) ?? null,
  }
})
