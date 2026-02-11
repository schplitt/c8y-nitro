import { defineHandler, HTTPError } from 'nitro/h3'
import type { EventHandler } from 'nitro/h3'
import type { C8YRoles } from 'c8y-nitro/types'
import { useUserRoles } from './resources'
import { useUserClient } from './client'
import process from 'node:process'

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
 *  middleware: [hasUserRequiredRole('ROLE_INVENTORY_ADMIN')],
 *  handler: async () => {
 *   return { message: 'You have access' }
 *  }
 * })
 *
 */
export function hasUserRequiredRole(role: UserRole): EventHandler
/**
 * Middleware to check if the current user has at least one of the required roles.\
 * If the user doesn't have any of the required roles, throws a 403 Forbidden error.\
 * Must be used within a request handler context.\
 * @param roles - Array of role IDs to check for
 * @returns Event handler that validates user roles
 * @example
 * // Multiple roles:
 * export default defineHandler({
 *  middleware: [hasUserRequiredRole(['ROLE_INVENTORY_ADMIN', 'ROLE_DEVICE_CONTROL'])],
 *  handler: async () => {
 *   return { message: 'You have access' }
 *  }
 * })
 */
export function hasUserRequiredRole(roles: UserRole[]): EventHandler
export function hasUserRequiredRole(roleOrRoles: UserRole | UserRole[]): EventHandler {
  return defineHandler(async (event) => {
    // TODO: rename to userHasOneOfRoles and create a separate userHasAllRoles

    const requiredRoles = Array.isArray(roleOrRoles) ? roleOrRoles : [roleOrRoles]
    const userRoles = await useUserRoles(event)

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

/**
 * Middleware to check if the current user belongs to a specific allowed tenant.\
 * If the user's tenant doesn't match, throws a 403 Forbidden error.\
 * Must be used within a request handler context.\
 * @param tenantId - Single tenant ID to allow
 * @returns Event handler that validates user tenant
 * @example
 * // Single tenant:
 * export default defineHandler({
 *  middleware: [isUserFromAllowedTenant('t123456')],
 *  handler: async () => {
 *   return { message: 'You have access' }
 *  }
 * })
 *
 */
export function isUserFromAllowedTenant(tenantId: string): EventHandler
/**
 * Middleware to check if the current user belongs to one of the allowed tenants.\
 * If the user's tenant doesn't match any of the allowed tenants, throws a 403 Forbidden error.\
 * Must be used within a request handler context.\
 * @param tenantIds - Array of tenant IDs to allow
 * @returns Event handler that validates user tenant
 * @example
 * // Multiple tenants:
 * export default defineHandler({
 *  middleware: [isUserFromAllowedTenant(['t123456', 't789012'])],
 *  handler: async () => {
 *   return { message: 'You have access' }
 *  }
 * })
 */
export function isUserFromAllowedTenant(tenantIds: string[]): EventHandler
export function isUserFromAllowedTenant(tenantIdOrIds: string | string[]): EventHandler {
  return defineHandler(async (event) => {
    const allowedTenants = Array.isArray(tenantIdOrIds) ? tenantIdOrIds : [tenantIdOrIds]
    const userClient = useUserClient(event)
    const userTenantId = userClient.core.tenant

    const isAllowed = allowedTenants.includes(userTenantId)

    if (!isAllowed) {
      throw new HTTPError({
        status: 403,
        statusText: 'Forbidden',
        message: `User's tenant '${userTenantId}' is not allowed to access this resource. Allowed tenants: ${allowedTenants.join(', ')}`,
      })
    }
  })
}

/**
 * Middleware to check if the current user belongs to the deployed tenant.\
 * The deployed tenant is where this microservice is hosted (C8Y_BOOTSTRAP_TENANT).\
 * If the user's tenant doesn't match the deployed tenant, throws a 403 Forbidden error.\
 * Must be used within a request handler context.\
 * @returns Event handler that validates user is from deployed tenant
 * @example
 * // Only allow users from the deployed tenant:
 * export default defineHandler({
 *  middleware: [isUserFromDeployedTenant()],
 *  handler: async () => {
 *   return { message: 'You have access' }
 *  }
 * })
 */
export function isUserFromDeployedTenant(): EventHandler {
  return defineHandler(async (event) => {
    const userClient = useUserClient(event)
    const userTenantId = userClient.core.tenant
    const deployedTenantId = process.env.C8Y_BOOTSTRAP_TENANT

    if (!deployedTenantId) {
      throw new HTTPError({
        status: 500,
        statusText: 'Internal Server Error',
        message: 'C8Y_BOOTSTRAP_TENANT environment variable is not set',
      })
    }

    if (userTenantId !== deployedTenantId) {
      throw new HTTPError({
        status: 403,
        statusText: 'Forbidden',
        message: `Only users from tenant '${deployedTenantId}' can access this resource.`,
      })
    }
  })
}
