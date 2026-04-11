import { createError } from '../../../utils/logging'
import { defineMiddleware } from 'nitro'
import process from 'node:process'

interface C8yClientThrownResponse {
  res: {
    status: number
    statusText?: string
    url?: string
  }
  data?: {
    message?: string
    error?: string
    info?: string
  }
}

function isC8yClientThrownResponse(error: unknown): error is C8yClientThrownResponse {
  if (!error || typeof error !== 'object') {
    return false
  }

  if (!('res' in error) || !error.res || typeof error.res !== 'object') {
    return false
  }

  const response = error.res as Record<string, unknown>
  if (typeof response.status !== 'number') {
    return false
  }

  const responseUrl = typeof response.url === 'string' ? response.url : undefined
  const baseUrl = process.env.C8Y_BASEURL?.replace(/\/+$/, '')
  const matchesConfiguredTenant = Boolean(baseUrl && responseUrl?.startsWith(baseUrl))

  if ('data' in error && error.data && typeof error.data === 'object') {
    const data = error.data as Record<string, unknown>
    if (typeof data.info === 'string' && data.info.startsWith('https://cumulocity.com/')) {
      return true
    }
  }

  return matchesConfiguredTenant
}

export default defineMiddleware(async (_event, next) => {
  try {
    return await next()
  } catch (error) {
    if (!isC8yClientThrownResponse(error)) {
      throw error
    }

    const upstreamMessage = error.data?.message || error.res.statusText || 'Cumulocity request failed'
    const upstreamCode = error.data?.error

    // TODO: Replace this middleware interception with a dedicated evlog error handler once evlog exposes a stable runtime hook for normalizing thrown errors.
    throw createError({
      message: 'Internal Server Error',
      status: 500,
      internal: {
        help: 'An error occurred while processing a request to Cumulocity from the @c8y/client library.',
        upstream: '@c8y/client',
        message: upstreamMessage,
        code: upstreamCode,
        status: error.res.status,
        statusText: error.res.statusText,
        url: error.res.url,
        data: error.data,
      },
    })
  }
})
