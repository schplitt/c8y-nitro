import type { ICredentials } from '@c8y/client'
import { Buffer } from 'buffer'
import { HTTPError } from 'nitro/h3'

/**
 * Extracts user credentials from the Authorization header of a request.\
 * Supports both Basic Auth (format: `tenant/user:password`) and Bearer token authentication.\
 * @param request - The HTTP request containing the Authorization header
 * @returns The extracted credentials (tenant, user, password for Basic Auth or token for Bearer)
 */
export function extractUserCredentialsFromHeaders(request: Request): ICredentials {
  const authorization = request.headers.get('authorization')

  if (!authorization) {
    throw new HTTPError({
      status: 401,
      statusText: 'Unauthorized',
      message: 'Missing Authorization header',
    })
  }

  if (authorization.startsWith('Basic ')) {
    const encoded = authorization.slice(6) // Remove 'Basic ' prefix
    const decoded = Buffer.from(encoded, 'base64').toString('utf-8')
    const colonIndex = decoded.indexOf(':')

    if (colonIndex === -1) {
      throw new HTTPError({
        status: 401,
        statusText: 'Unauthorized',
        message: 'Invalid Basic auth format',
      })
    }

    const username = decoded.slice(0, colonIndex)
    const password = decoded.slice(colonIndex + 1)

    // Extract tenant and user from username at the FIRST '/'
    const slashIndex = username.indexOf('/')
    if (slashIndex === -1) {
      throw new HTTPError({
        status: 401,
        statusText: 'Unauthorized',
        message: 'Invalid username format, expected tenant/user',
      })
    }

    const tenant = username.slice(0, slashIndex)
    const user = username.slice(slashIndex + 1)

    return {
      user,
      password,
      tenant,
    }
  } else if (authorization.startsWith('Bearer ')) {
    const token = authorization.slice(7) // Remove 'Bearer ' prefix

    if (!token) {
      throw new HTTPError({
        status: 401,
        statusText: 'Unauthorized',
        message: 'Empty Bearer token',
      })
    }

    return {
      token,
    }
  }
  throw new HTTPError({
    status: 401,
    statusText: 'Unauthorized',
    message: 'Unsupported Authorization header format',
  })
}
