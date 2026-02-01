import type { C8YManifest } from '../../types/manifest'
import { Buffer } from 'node:buffer'

/**
 * Creates a Basic Auth header for Cumulocity API requests.
 * Format: base64(tenant/user:password)
 * @param tenant - The Cumulocity tenant ID
 * @param user - The username
 * @param password - The password
 */
export function createBasicAuthHeader(tenant: string, user: string, password: string): string {
  const credentials = `${tenant}/${user}:${password}`
  const encoded = Buffer.from(credentials).toString('base64')
  return `Basic ${encoded}`
}

export interface C8yApplication {
  id: string
  name: string
  key: string
  type: string
}

export interface C8yApplicationsResponse {
  applications: C8yApplication[]
}

export interface C8yBootstrapCredentials {
  tenant: string
  name: string
  password: string
}

export interface C8yUserRole {
  id: string
  name: string
  self: string
}

export interface C8yUserRoleReference {
  self: string
  role: C8yUserRole
}

export interface C8yUserRolesResponse {
  roles: C8yUserRoleReference[]
}

/**
 * Checks if a microservice with the given name already exists.
 * @param baseUrl - The Cumulocity base URL
 * @param name - The microservice name to search for
 * @param authHeader - The Basic Auth header
 * @returns The application if found, undefined otherwise
 */
export async function findMicroserviceByName(
  baseUrl: string,
  name: string,
  authHeader: string,
): Promise<C8yApplication | undefined> {
  const url = `${baseUrl}/application/applications?name=${encodeURIComponent(name)}`

  const response = await fetch(url, {
    method: 'GET',
    headers: {
      Authorization: authHeader,
      Accept: 'application/json',
    },
  })

  if (!response.ok) {
    throw new Error(`Failed to query microservices: ${response.status} ${response.statusText}`, {
      cause: response,
    })
  }

  const data = (await response.json()) as C8yApplicationsResponse

  // Find exact match by name
  return data.applications.find((app) => app.name === name)
}

/**
 * Creates a new microservice in Cumulocity.
 * @param baseUrl - The Cumulocity base URL
 * @param manifest - The microservice manifest
 * @param authHeader - The Basic Auth header
 * @returns The created application
 */
export async function createMicroservice(
  baseUrl: string,
  manifest: C8YManifest,
  authHeader: string,
): Promise<C8yApplication> {
  const url = `${baseUrl}/application/applications`

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': authHeader,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    },
    body: JSON.stringify(manifest),
  })

  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(`Failed to create microservice: ${response.status} ${response.statusText}\n${errorText}`, {
      cause: response,
    })
  }

  return (await response.json()) as C8yApplication
}

/**
 * Updates an existing microservice in Cumulocity.
 * @param baseUrl - The Cumulocity base URL
 * @param appId - The application ID to update
 * @param manifest - The microservice manifest
 * @param authHeader - The Basic Auth header
 * @returns The updated application
 */
export async function updateMicroservice(
  baseUrl: string,
  appId: string,
  manifest: C8YManifest,
  authHeader: string,
): Promise<C8yApplication> {
  const url = `${baseUrl}/application/applications/${appId}`

  // type cannot be updated, so exclude it from the payload
  const {
    type,
    ...manifestWithoutType
  } = manifest

  const response = await fetch(url, {
    method: 'PUT',
    headers: {
      'Authorization': authHeader,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    },
    body: JSON.stringify(manifestWithoutType),
  })

  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(`Failed to update microservice: ${response.status} ${response.statusText}\n${errorText}`, {
      cause: response,
    })
  }

  return (await response.json()) as C8yApplication
}

/**
 * Subscribes a tenant to an application.
 * @param baseUrl - The Cumulocity base URL
 * @param tenantId - The tenant ID to subscribe
 * @param appId - The application ID
 * @param authHeader - The Basic Auth header
 */
export async function subscribeToApplication(
  baseUrl: string,
  tenantId: string,
  appId: string,
  authHeader: string,
): Promise<void> {
  const url = `${baseUrl}/tenant/tenants/${tenantId}/applications`

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': authHeader,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    },
    body: JSON.stringify({
      application: {
        self: `${baseUrl}/application/applications/${appId}`,
      },
    }),
  })

  // 409 means already subscribed, which is fine
  if (response.status === 409) {
    return
  }

  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(`Failed to subscribe tenant to application: ${response.status} ${response.statusText}\n${errorText}`, {
      cause: response,
    })
  }
}

/**
 * Fetches the bootstrap credentials for a microservice.
 * @param baseUrl - The Cumulocity base URL
 * @param appId - The application ID
 * @param authHeader - The Basic Auth header
 */
export async function getBootstrapCredentials(
  baseUrl: string,
  appId: string,
  authHeader: string,
): Promise<C8yBootstrapCredentials> {
  const url = `${baseUrl}/application/applications/${appId}/bootstrapUser`

  const response = await fetch(url, {
    method: 'GET',
    headers: {
      Authorization: authHeader,
      Accept: 'application/json',
    },
  })

  if (!response.ok) {
    throw new Error(`Failed to get bootstrap credentials: ${response.status} ${response.statusText}`, {
      cause: response,
    })
  }

  return (await response.json()) as C8yBootstrapCredentials
}

/**
 * Gets all roles assigned to a user in a tenant.
 * @param baseUrl - The Cumulocity base URL
 * @param tenantId - The tenant ID
 * @param userId - The user ID
 * @param authHeader - The Basic Auth header
 * @returns Array of role IDs assigned to the user
 */
export async function getUserRoles(
  baseUrl: string,
  tenantId: string,
  userId: string,
  authHeader: string,
): Promise<string[]> {
  const url = `${baseUrl}/user/${tenantId}/users/${userId}/roles`

  const response = await fetch(url, {
    method: 'GET',
    headers: {
      Authorization: authHeader,
      Accept: 'application/json',
    },
  })

  if (!response.ok) {
    throw new Error(`Failed to get user roles: ${response.status} ${response.statusText}`, {
      cause: response,
    })
  }

  const data = (await response.json()) as C8yUserRolesResponse
  return data.roles.map((r) => r.role.id)
}

/**
 * Assigns a role to a user in a tenant.
 * @param baseUrl - The Cumulocity base URL
 * @param tenantId - The tenant ID
 * @param userId - The user ID
 * @param roleId - The role ID to assign
 * @param authHeader - The Basic Auth header
 */
export async function assignUserRole(
  baseUrl: string,
  tenantId: string,
  userId: string,
  roleId: string,
  authHeader: string,
): Promise<void> {
  const url = `${baseUrl}/user/${tenantId}/users/${userId}/roles`

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': authHeader,
      'Content-Type': 'application/vnd.com.nsn.cumulocity.rolereference+json',
      'Accept': 'application/json',
    },
    body: JSON.stringify({
      role: {
        self: `${baseUrl}/user/roles/${roleId}`,
      },
    }),
  })

  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(`Failed to assign role ${roleId}: ${response.status} ${response.statusText}\n${errorText}`, {
      cause: response,
    })
  }
}

/**
 * Unassigns a role from a user in a tenant.
 * @param baseUrl - The Cumulocity base URL
 * @param tenantId - The tenant ID
 * @param userId - The user ID
 * @param roleId - The role ID to unassign
 * @param authHeader - The Basic Auth header
 */
export async function unassignUserRole(
  baseUrl: string,
  tenantId: string,
  userId: string,
  roleId: string,
  authHeader: string,
): Promise<void> {
  const url = `${baseUrl}/user/${tenantId}/users/${userId}/roles/${roleId}`

  const response = await fetch(url, {
    method: 'DELETE',
    headers: {
      Authorization: authHeader,
    },
  })

  // if its 404, the user didn't have the role assigned, so we can ignore
  if (response.status === 404) {
    return
  }

  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(`Failed to unassign role ${roleId}: ${response.status} ${response.statusText}\n${errorText}`, {
      cause: response,
    })
  }
}

/**
 * Gets all tenant options for a specific category.
 * @param baseUrl - The Cumulocity base URL
 * @param category - The category to fetch options for
 * @param authHeader - The Basic Auth header
 * @returns Record of key-value pairs for the category
 */
export async function getTenantOptionsByCategory(
  baseUrl: string,
  category: string,
  authHeader: string,
): Promise<Record<string, string>> {
  const url = `${baseUrl}/tenant/options/${encodeURIComponent(category)}`

  const response = await fetch(url, {
    method: 'GET',
    headers: {
      Authorization: authHeader,
      Accept: 'application/json',
    },
  })

  if (response.status === 404) {
    // Category doesn't exist yet, return empty object
    return {}
  }

  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(`Failed to get tenant options for category ${category}: ${response.status} ${response.statusText}\n${errorText}`, {
      cause: response,
    })
  }

  const data = (await response.json()) as Record<string, string>
  return data
}

/**
 * Gets a specific tenant option value.
 * @param baseUrl - The Cumulocity base URL
 * @param category - The category of the option
 * @param key - The option key
 * @param authHeader - The Basic Auth header
 * @returns The option value, or undefined if not set
 */
export async function getTenantOption(
  baseUrl: string,
  category: string,
  key: string,
  authHeader: string,
): Promise<string | undefined> {
  const url = `${baseUrl}/tenant/options/${encodeURIComponent(category)}/${encodeURIComponent(key)}`

  const response = await fetch(url, {
    method: 'GET',
    headers: {
      Authorization: authHeader,
      Accept: 'application/json',
    },
  })

  if (response.status === 404) {
    // Option doesn't exist, return undefined
    return undefined
  }

  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(`Failed to get tenant option ${category}/${key}: ${response.status} ${response.statusText}\n${errorText}`, {
      cause: response,
    })
  }

  const data = (await response.json()) as { value: string }
  return data.value
}

/**
 * Updates or creates a tenant option.
 * @param baseUrl - The Cumulocity base URL
 * @param category - The category of the option
 * @param key - The option key
 * @param value - The new value to set
 * @param authHeader - The Basic Auth header
 */
export async function updateTenantOption(
  baseUrl: string,
  category: string,
  key: string,
  value: string,
  authHeader: string,
): Promise<void> {
  const url = `${baseUrl}/tenant/options/${encodeURIComponent(category)}/${encodeURIComponent(key)}`

  const response = await fetch(url, {
    method: 'PUT',
    headers: {
      'Authorization': authHeader,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    },
    body: JSON.stringify({ value }),
  })

  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(`Failed to update tenant option ${category}/${key}: ${response.status} ${response.statusText}\n${errorText}`, {
      cause: response,
    })
  }
}

/**
 * Deletes a tenant option.
 * @param baseUrl - The Cumulocity base URL
 * @param category - The category of the option
 * @param key - The option key to delete
 * @param authHeader - The Basic Auth header
 */
export async function deleteTenantOption(
  baseUrl: string,
  category: string,
  key: string,
  authHeader: string,
): Promise<void> {
  const url = `${baseUrl}/tenant/options/${encodeURIComponent(category)}/${encodeURIComponent(key)}`

  const response = await fetch(url, {
    method: 'DELETE',
    headers: {
      Authorization: authHeader,
    },
  })

  // if it's 404, the option didn't exist, so we can ignore
  if (response.status === 404) {
    return
  }

  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(`Failed to delete tenant option ${category}/${key}: ${response.status} ${response.statusText}\n${errorText}`, {
      cause: response,
    })
  }
}
