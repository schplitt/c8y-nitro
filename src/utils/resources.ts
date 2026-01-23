import { useRequest } from 'nitro/context'
import { BasicAuth, Client } from '@c8y/client'
import type { IUser } from '@c8y/client'
import { useRuntimeConfig } from 'nitro/runtime-config'
import { HTTPError } from 'nitro/h3'
import { extractUserCredentialsFromHeaders } from './common'

/**
 * Fetches the current user from Cumulocity using credentials extracted from the current request's headers.
 * This is a non-cached version - fetches fresh data on every call.
 * Must be called within a request handler context.
 * @returns The current user object from Cumulocity
 * @example
 * // In a request handler:
 * const user = await getUser()
 * console.log(user.userName, user.email)
 */
export async function getUser() {
  const request = useRequest()

  // check if we have cached user in request context
  if (request.context?.['c8y_user']) {
    return request.context['c8y_user'] as IUser
  }

  // TODO: cache the user credentials in the request context as well
  const creds = extractUserCredentialsFromHeaders(request)

  // TODO: ensure base url has not trailing slash

  // C8Y_BASE_URL is enforced to be set
  const client = new Client(new BasicAuth(creds), useRuntimeConfig().C8Y_BASE_URL)
  const {
    res,
    data: user,
  } = await client.user.current()

  if (!res.ok) {
    throw new HTTPError({
      message: `Failed to fetch current user`,
      status: res.status,
      statusText: res.statusText,
    })
  }

  // cache user in request context for subsequent calls
  request.context ??= {}
  request.context['c8y_user'] = user

  return user
}

/**
 * Fetches the roles of the current user from Cumulocity.
 * Internally calls `getUser()` and extracts role IDs from the user object.
 * This is a non-cached version - fetches fresh data on every call.
 * Must be called within a request handler context.
 * @returns Array of role ID strings assigned to the current user
 * @example
 * // In a request handler:
 * const roles = await getUserRoles()
 * console.log(roles) // ['ROLE_INVENTORY_READ', 'ROLE_INVENTORY_ADMIN']
 */
export async function getUserRoles() {
  const request = useRequest()

  // check if we have cached roles in request context
  if (request.context?.['c8y_user_roles']) {
    return request.context['c8y_user_roles'] as string[]
  }

  // fetch current user
  const user = await getUser()
  // extract roles from user
  const userRoles = (user.roles?.references.map((roleRef) => roleRef.id?.toString() ?? null).filter((id) => !!id) ?? []) as string[]

  // cache roles in request context for subsequent calls
  request.context ??= {}
  request.context['c8y_user_roles'] = userRoles

  return userRoles
}
