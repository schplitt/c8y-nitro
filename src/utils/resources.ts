import type { ICurrentUser } from '@c8y/client'
import type { H3Event } from 'nitro/h3'
import { HTTPError } from 'nitro/h3'
import type { ServerRequest } from 'nitro/types'
import { useUserClient } from './client'

/**
 * Fetches the current user from Cumulocity using credentials extracted from the current request's headers.
 * This is a non-cached version - fetches fresh data on every call.
 * @param requestOrEvent - The H3Event or ServerRequest from the current request
 * @returns The current user object from Cumulocity
 * @example
 * // In a request handler:
 * const user = await useUser(event)
 * console.log(user.userName, user.email)
 */
export async function useUser(requestOrEvent: ServerRequest | H3Event) {
  const request = 'req' in requestOrEvent ? requestOrEvent.req : requestOrEvent

  // check if we have cached user in request context
  if (request.context?.['c8y_user']) {
    return request.context['c8y_user'] as ICurrentUser
  }

  const client = useUserClient(requestOrEvent)

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
 * @param requestOrEvent - The H3Event or ServerRequest from the current request
 * @returns Array of role ID strings assigned to the current user
 * @example
 * // In a request handler:
 * const roles = await useUserRoles(event)
 * console.log(roles) // ['ROLE_INVENTORY_READ', 'ROLE_INVENTORY_ADMIN']
 */
export async function useUserRoles(requestOrEvent: ServerRequest | H3Event) {
  const request = 'req' in requestOrEvent ? requestOrEvent.req : requestOrEvent

  // check if we have cached roles in request context
  if (request.context?.['c8y_user_roles']) {
    return request.context['c8y_user_roles'] as string[]
  }

  // fetch current user
  const user = await useUser(requestOrEvent)
  // extract roles from user
  const userRoles = user.effectiveRoles?.map((role) => role.name) ?? []

  // cache roles in request context for subsequent calls
  request.context ??= {}
  request.context['c8y_user_roles'] = userRoles

  return userRoles
}
