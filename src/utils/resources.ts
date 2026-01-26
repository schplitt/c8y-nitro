import { useRequest } from 'nitro/context'
import type { ICurrentUser } from '@c8y/client'
import { HTTPError } from 'nitro/h3'
import { useUserClient } from './client'

/**
 * Fetches the current user from Cumulocity using credentials extracted from the current request's headers.
 * This is a non-cached version - fetches fresh data on every call.
 * Must be called within a request handler context.
 * @returns The current user object from Cumulocity
 * @example
 * // In a request handler:
 * const user = await useUser()
 * console.log(user.userName, user.email)
 */
export async function useUser() {
  const request = useRequest()

  // check if we have cached user in request context
  if (request.context?.['c8y_user']) {
    return request.context['c8y_user'] as ICurrentUser
  }

  // TODO: ensure base url has not trailing slash

  // C8Y_BASEURL is enforced to be set
  const client = useUserClient()

  const {
    res,
    data: user,
  } = await client.user.currentWithEffectiveRoles()

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
 * Internally calls `useUser()` and extracts role IDs from the user object.
 * This is a non-cached version - fetches fresh data on every call.
 * Must be called within a request handler context.
 * @returns Array of role ID strings assigned to the current user
 * @example
 * // In a request handler:
 * const roles = await useUserRoles()
 * console.log(roles) // ['ROLE_INVENTORY_READ', 'ROLE_INVENTORY_ADMIN']
 */
export async function useUserRoles() {
  const request = useRequest()

  // check if we have cached roles in request context
  if (request.context?.['c8y_user_roles']) {
    return request.context['c8y_user_roles'] as string[]
  }

  // fetch current user
  const user = await useUser()
  // extract roles from user
  const userRoles = user.effectiveRoles?.map((role) => role.name) ?? []

  // cache roles in request context for subsequent calls
  request.context ??= {}
  request.context['c8y_user_roles'] = userRoles

  return userRoles
}
