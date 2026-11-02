/**
 * Generates `src/testing/capabilities.generated.ts` — the parts of the
 * Cumulocity core OpenAPI spec the fake tenant of `c8y-nitro/testing` derives
 * instead of assuming:
 *
 * - the query parameters each emulated endpoint accepts (unknown parameters are
 *   rejected like the real API would, supported-but-unemulated ones fail loudly)
 * - required fields of request bodies (e.g. an alarm needs source, type, …)
 * - enum values (alarm severity/status, operation status)
 * - read-only (server-assigned) fields
 *
 * Behavior (paging, deduplication, relations, …) is hand-written in
 * `src/testing/api/` and documented in `docs/guide/testing.md`.
 *
 * Usage:
 *   node scripts/generate-testing-capabilities.ts            # fetch the live spec
 *   node scripts/generate-testing-capabilities.ts --file x   # parse a local spec
 */
import { readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { consola } from 'consola'

const SPEC_URL = 'https://cumulocity.com/api/core/dist/c8y-oas.json'

/**
 * Endpoints the fake tenant emulates.
 */
const ENDPOINTS = [
  'GET /inventory/managedObjects',
  'POST /inventory/managedObjects',
  'GET /inventory/managedObjects/{id}',
  'PUT /inventory/managedObjects/{id}',
  'DELETE /inventory/managedObjects/{id}',
  'GET /inventory/managedObjects/{id}/childDevices',
  'POST /inventory/managedObjects/{id}/childDevices',
  'GET /inventory/managedObjects/{id}/childAssets',
  'POST /inventory/managedObjects/{id}/childAssets',
  'GET /inventory/managedObjects/{id}/childAdditions',
  'POST /inventory/managedObjects/{id}/childAdditions',
  'DELETE /inventory/managedObjects/{id}/childDevices/{childId}',
  'DELETE /inventory/managedObjects/{id}/childAssets/{childId}',
  'DELETE /inventory/managedObjects/{id}/childAdditions/{childId}',
  'GET /identity/externalIds/{type}/{externalId}',
  'DELETE /identity/externalIds/{type}/{externalId}',
  'GET /identity/globalIds/{id}/externalIds',
  'POST /identity/globalIds/{id}/externalIds',
  'GET /measurement/measurements',
  'POST /measurement/measurements',
  'GET /measurement/measurements/{id}',
  'DELETE /measurement/measurements/{id}',
  'GET /event/events',
  'POST /event/events',
  'GET /event/events/{id}',
  'PUT /event/events/{id}',
  'DELETE /event/events/{id}',
  'GET /alarm/alarms',
  'POST /alarm/alarms',
  'PUT /alarm/alarms',
  'GET /alarm/alarms/{id}',
  'PUT /alarm/alarms/{id}',
  'GET /devicecontrol/operations',
  'POST /devicecontrol/operations',
  'GET /devicecontrol/operations/{id}',
  'PUT /devicecontrol/operations/{id}',
] as const

interface Schema {
  $ref?: string
  allOf?: Schema[]
  required?: string[]
  properties?: Record<string, Schema & { enum?: string[], readOnly?: boolean }>
}

interface Spec {
  info?: { version?: string }
  paths: Record<string, Record<string, {
    parameters?: Array<{ $ref?: string, name?: string, in?: string }>
    requestBody?: { content?: Record<string, { schema?: Schema }> }
  }>>
  components: { parameters: Record<string, { name: string, in: string }>, schemas: Record<string, Schema> }
}

function parseArgs(argv: string[]): { file?: string } {
  const index = argv.indexOf('--file')
  return index === -1 ? {} : { file: argv[index + 1] }
}

async function loadSpec(file?: string): Promise<{ spec: Spec, source: string }> {
  if (file) {
    return { spec: JSON.parse(await readFile(file, 'utf8')) as Spec, source: file }
  }
  const response = await fetch(SPEC_URL)
  if (!response.ok) {
    throw new Error(`Failed to download spec: ${response.status} ${response.statusText}`)
  }
  return { spec: await response.json() as Spec, source: SPEC_URL }
}

function resolveSchema(spec: Spec, schema: Schema | undefined): Schema {
  if (!schema) {
    return {}
  }
  if (schema.$ref) {
    return resolveSchema(spec, spec.components.schemas[schema.$ref.split('/').at(-1)!])
  }
  if (schema.allOf) {
    const parts = schema.allOf.map((part) => resolveSchema(spec, part))
    return {
      required: [...new Set(parts.flatMap((part) => part.required ?? []))],
      properties: Object.assign({}, ...parts.map((part) => part.properties ?? {})),
    }
  }
  return schema
}

function describeEndpoint(spec: Spec, endpoint: string) {
  const [method, path] = endpoint.split(' ') as [string, string]
  const operation = spec.paths[path]?.[method.toLowerCase()]
  if (!operation) {
    throw new Error(`${endpoint} is not in the spec`)
  }
  const query = (operation.parameters ?? [])
    .map((parameter) => parameter.$ref ? spec.components.parameters[parameter.$ref.split('/').at(-1)!]! : parameter)
    .filter((parameter) => parameter.in === 'query')
    .map((parameter) => parameter.name!)
    .sort()

  // Use the single-object content type (not the collection variant)
  const content = Object.entries(operation.requestBody?.content ?? {})
    .find(([type]) => !type.includes('collection') && !type.includes('reference'))?.[1]
  const body = content ? resolveSchema(spec, content.schema) : undefined

  return {
    query,
    ...(body?.required?.length ? { required: [...body.required].sort() } : {}),
  }
}

function enumOf(spec: Spec, schema: string, property: string): string[] {
  const values = resolveSchema(spec, spec.components.schemas[schema]).properties?.[property]?.enum
  if (!values) {
    throw new Error(`No enum for ${schema}.${property}`)
  }
  return values
}

async function main() {
  const { spec, source } = await loadSpec(parseArgs(process.argv.slice(2)).file)
  const endpoints = Object.fromEntries(ENDPOINTS.map((endpoint) => [endpoint, describeEndpoint(spec, endpoint)]))
  const enums = {
    alarmSeverity: enumOf(spec, 'alarm', 'severity'),
    alarmStatus: enumOf(spec, 'alarm', 'status'),
    operationStatus: enumOf(spec, 'operation', 'status'),
  }

  const output = `// Generated by scripts/generate-testing-capabilities.ts — do not edit by hand.
// Source: ${SPEC_URL}${source === SPEC_URL ? '' : ' (local copy)'} (version: ${spec.info?.version ?? 'unknown'})
// Regenerate: pnpm gen:testing-capabilities

/** Query parameters and required body fields of the endpoints the fake tenant emulates. */
export const C8Y_ENDPOINTS = ${JSON.stringify(endpoints, null, 2)} as const satisfies Record<string, { query: readonly string[], required?: readonly string[] }>

/** Enum values from the spec. */
export const C8Y_ENUMS = ${JSON.stringify(enums, null, 2)} as const

export type C8yEndpoint = keyof typeof C8Y_ENDPOINTS
export type C8yAlarmSeverity = typeof C8Y_ENUMS.alarmSeverity[number]
export type C8yAlarmStatus = typeof C8Y_ENUMS.alarmStatus[number]
export type C8yOperationStatus = typeof C8Y_ENUMS.operationStatus[number]
`
  const outputPath = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'testing', 'capabilities.generated.ts')
  await writeFile(outputPath, output)
  consola.success(`Wrote ${ENDPOINTS.length} endpoints to ${outputPath}`)
}

await main()
