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
    throw new Error(`Failed to query microservices: ${response.status} ${response.statusText}`)
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
    body: JSON.stringify({
      ...manifest,
      type: 'MICROSERVICE',
    }),
  })

  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(`Failed to create microservice: ${response.status} ${response.statusText}\n${errorText}`)
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

  const response = await fetch(url, {
    method: 'PUT',
    headers: {
      'Authorization': authHeader,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    },
    body: JSON.stringify({
      ...manifest,
      type: 'MICROSERVICE',
    }),
  })

  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(`Failed to update microservice: ${response.status} ${response.statusText}\n${errorText}`)
  }

  return (await response.json()) as C8yApplication
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
    throw new Error(`Failed to get bootstrap credentials: ${response.status} ${response.statusText}`)
  }

  return (await response.json()) as C8yBootstrapCredentials
}
