import { defineHandler, HTTPError } from 'nitro/h3'
import type { EventHandler } from 'nitro/h3'
import type { C8YRoles } from '../types'
import { getUserRoles } from './cached'

// allow any string as role for extensibility
type UserRole = keyof C8YRoles | (string & {})

/**
 * Middleware to check if the current user has the required role.\
 * If the user doesn't have the required role, throws a 403 Forbidden error.\
 * Must be used within a request handler context.\
 * @param role - Single role ID to check for
 * @returns Event handler that validates user roles
 * @example
 * // Single role:
 * export default defineHandler({
 *  middleware: [userHasRequiredRole('ROLE_INVENTORY_ADMIN')],
 *  handler: async () => {
 *   return { message: 'You have access' }
 *  }
 * })
 *
 */
export function userHasRequiredRole(role: UserRole): EventHandler
/**
 * Middleware to check if the current user has at least one of the required roles.\
 * If the user doesn't have any of the required roles, throws a 403 Forbidden error.\
 * Must be used within a request handler context.\
 * @param roles - Array of role IDs to check for
 * @returns Event handler that validates user roles
 * @example
 * // Multiple roles:
 * export default defineHandler({
 *  middleware: [userHasRequiredRole(['ROLE_INVENTORY_ADMIN', 'ROLE_DEVICE_CONTROL'])],
 *  handler: async () => {
 *   return { message: 'You have access' }
 *  }
 * })
 */
export function userHasRequiredRole(roles: UserRole[]): EventHandler
export function userHasRequiredRole(roleOrRoles: UserRole | UserRole[]): EventHandler {
  return defineHandler(async () => {
    const requiredRoles = Array.isArray(roleOrRoles) ? roleOrRoles : [roleOrRoles]
    const userRoles = await getUserRoles()

    const hasRole = requiredRoles.some((role) => userRoles.includes(role))

    if (!hasRole) {
      throw new HTTPError({
        status: 403,
        statusText: 'Forbidden',
        message: `User does not have required role(s) to access this resource: ${requiredRoles.join(', ')}`,
      })
    }
  })
}
