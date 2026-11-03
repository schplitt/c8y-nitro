/**
 * Generates `src/testing/capabilities.generated.ts` — the parts of the
 * Cumulocity core OpenAPI spec the fake tenant of `c8y-nitro/testing` derives
 * instead of assuming:
 *
 * - the query parameters each emulated endpoint accepts (unknown parameters are
 *   rejected like the real API would, supported-but-unemulated ones fail loudly)
 * - required fields of request bodies (e.g. an alarm needs source, type, …)
 * - enum values (alarm severity/status, operation status)
 * - every `METHOD /path` of the spec, so a request for an endpoint the platform
 *   does not have answers 404 (405 for a wrong method) instead of "not emulated"
 *
 * It also writes `tests/contract/spec.generated.json`: the documented query
 * parameter facts (type, enum, default, limits) and response schemas of the
 * emulated endpoints, checked by tests/server/contract-spec.test.ts (kept out
 * of the package).
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
  'DELETE /measurement/measurements',
  'GET /measurement/measurements/series',
  'DELETE /event/events',
  'POST /event/events/{id}/binaries',
  'GET /event/events/{id}/binaries',
  'PUT /event/events/{id}/binaries',
  'DELETE /event/events/{id}/binaries',
  'POST /inventory/binaries',
  'GET /inventory/binaries',
  'GET /inventory/binaries/{id}',
  'PUT /inventory/binaries/{id}',
  'DELETE /inventory/binaries/{id}',
  'POST /notification2/subscriptions',
  'GET /notification2/subscriptions',
  'DELETE /notification2/subscriptions',
  'GET /notification2/subscriptions/{id}',
  'DELETE /notification2/subscriptions/{id}',
  'POST /notification2/token',
  'POST /notification2/unsubscribe',
] as const

interface Schema {
  $ref?: string
  allOf?: Schema[]
  required?: string[]
  properties?: Record<string, Schema & { enum?: string[], readOnly?: boolean }>
  [key: string]: unknown
}

interface Parameter {
  name: string
  in: string
  required?: boolean
  schema?: { type?: string, enum?: string[], default?: unknown, minimum?: number, maximum?: number, items?: { type?: string } }
}

interface Spec {
  info?: { version?: string }
  paths: Record<string, Record<string, any>>
  components: { parameters: Record<string, Parameter>, responses: Record<string, any>, schemas: Record<string, Schema> }
}

/**
 * Documented facts about a query parameter.
 */
interface ParameterInfo {
  type: string
  enum?: string[]
  default?: unknown
  minimum?: number
  maximum?: number
}

const METHODS = ['get', 'post', 'put', 'delete', 'patch']
/**
 * Read-only properties the platform does not always write (verified: a fresh
 * alarm has no `firstOccurrenceTime`, an operation created on its own has no
 * `bulkOperationId`). Every other read-only property is required in a response.
 */
const OPTIONAL_READ_ONLY = new Set(['firstOccurrenceTime', 'bulkOperationId'])
const SCHEMA_KEYS = ['type', 'format', 'enum', 'nullable', 'required', 'minimum', 'maximum', 'minLength', 'maxLength', 'additionalProperties']

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

function operationOf(spec: Spec, endpoint: string) {
  const [method, path] = endpoint.split(' ') as [string, string]
  const operation = spec.paths[path]?.[method.toLowerCase()]
  if (!operation) {
    throw new Error(`${endpoint} is not in the spec`)
  }
  return { path, operation }
}

function queryParameters(spec: Spec, endpoint: string): Parameter[] {
  const { path, operation } = operationOf(spec, endpoint)
  // parameters can be declared on the operation or on the path item
  return [...(spec.paths[path]!.parameters ?? []), ...(operation.parameters ?? [])]
    .map((parameter: { $ref?: string } & Partial<Parameter>) => parameter.$ref ? spec.components.parameters[parameter.$ref.split('/').at(-1)!]! : parameter as Parameter)
    .filter((parameter) => parameter.in === 'query')
    .sort((a, b) => a.name.localeCompare(b.name))
}

function describeEndpoint(spec: Spec, endpoint: string) {
  const { operation } = operationOf(spec, endpoint)
  const parameters = queryParameters(spec, endpoint)

  // Use the single-object content type (not the collection variant)
  const content = Object.entries((operation.requestBody?.content ?? {}) as Record<string, { schema?: Schema }>)
    .find(([type]) => !type.includes('collection') && !type.includes('reference'))?.[1]
  const body = content ? resolveSchema(spec, content.schema) : undefined

  return {
    query: parameters.map((parameter) => parameter.name),
    ...(body?.required?.length ? { required: [...body.required].sort() } : {}),
  }
}

/**
 * The documented facts (type, enum, default, limits) of an endpoint's query
 * parameters, for the spec contract test.
 * @param spec
 * @param endpoint
 */
function describeParameters(spec: Spec, endpoint: string): Record<string, ParameterInfo> {
  const params: Record<string, ParameterInfo> = {}
  for (const { name, schema = {} } of queryParameters(spec, endpoint)) {
    params[name] = {
      type: schema.type ?? 'string',
      ...(schema.enum ? { enum: schema.enum } : {}),
      ...(schema.default !== undefined ? { default: schema.default } : {}),
      ...(schema.minimum !== undefined ? { minimum: schema.minimum } : {}),
      ...(schema.maximum !== undefined ? { maximum: schema.maximum } : {}),
    }
  }
  return params
}

/**
 * Every `METHOD /path` the spec documents.
 * @param spec
 */
function specPaths(spec: Spec): string[] {
  // a few keys carry a query string (`/versions?version=1.0`); the path is what matters
  const paths = Object.entries(spec.paths)
    .flatMap(([path, item]) => METHODS.filter((method) => item[method]).map((method) => `${method.toUpperCase()} ${path.split('?')[0]}`))
  return [...new Set(paths)].sort()
}

/**
 * A response schema without prose: types, enums, required fields, and nesting,
 * with references resolved and cycles cut.
 * @param spec
 * @param node
 * @param seen - Reference names on the current path
 */
function stripSchema(spec: Spec, node: unknown, seen: string[] = []): unknown {
  if (!node || typeof node !== 'object') {
    return node
  }
  const schema = node as Schema
  if (schema.$ref) {
    const name = schema.$ref.split('/').at(-1)!
    if (seen.includes(name)) {
      return {}
    }
    return stripSchema(spec, spec.components.schemas[name], [...seen, name])
  }
  if (schema.allOf) {
    return mergeSchemas(schema.allOf.map((part) => stripSchema(spec, part, seen) as Record<string, unknown>))
  }
  const result: Record<string, unknown> = {}
  for (const key of SCHEMA_KEYS) {
    if (schema[key] !== undefined) {
      result[key] = schema[key]
    }
  }
  for (const key of ['oneOf', 'anyOf']) {
    if (Array.isArray(schema[key])) {
      result[key] = (schema[key] as unknown[]).map((part) => stripSchema(spec, part, seen))
    }
  }
  if (schema.properties) {
    result.properties = Object.fromEntries(Object.entries(schema.properties).map(([name, property]) => [name, stripSchema(spec, property, seen)]))
    // these are response schemas: a read-only property is one the platform always writes
    const readOnly = Object.entries(schema.properties).filter(([name, property]) => property.readOnly && !OPTIONAL_READ_ONLY.has(name)).map(([name]) => name)
    if (readOnly.length > 0) {
      result.required = [...new Set([...(schema.required ?? []), ...readOnly])].sort()
    }
  }
  if (schema.items) {
    result.items = stripSchema(spec, schema.items, seen)
  }
  if (schema.additionalProperties && typeof schema.additionalProperties === 'object') {
    result.additionalProperties = stripSchema(spec, schema.additionalProperties, seen)
  }
  return result
}

/**
 * Merges the parts of an `allOf`: scalar facts from the first part that states
 * them, `required` unioned, and properties merged recursively where parts
 * overlap (an example-only part must not erase a typed one).
 * @param parts - Stripped schemas
 */
function mergeSchemas(parts: Array<Record<string, unknown>>): Record<string, unknown> {
  const merged: Record<string, unknown> = {}
  for (const key of [...SCHEMA_KEYS, 'items', 'oneOf', 'anyOf']) {
    const part = parts.find((item) => item[key] !== undefined)
    if (part && key !== 'required') {
      merged[key] = part[key]
    }
  }
  const required = [...new Set(parts.flatMap((part) => (part.required as string[] | undefined) ?? []))].sort()
  if (required.length > 0) {
    merged.required = required
  }
  const withProperties = parts.filter((part) => part.properties)
  if (withProperties.length > 0) {
    merged.type ??= 'object'
    const names = [...new Set(withProperties.flatMap((part) => Object.keys(part.properties as object)))]
    merged.properties = Object.fromEntries(names.map((name) => {
      const definitions = withProperties.map((part) => (part.properties as Record<string, Record<string, unknown>>)[name]).filter((definition) => definition !== undefined)
      return [name, definitions.length === 1 ? definitions[0] : mergeSchemas(definitions)]
    }))
  }
  return merged
}

function responsesOf(spec: Spec, endpoint: string): Record<string, Record<string, unknown>> {
  const { operation } = operationOf(spec, endpoint)
  const result: Record<string, Record<string, unknown>> = {}
  for (const [status, value] of Object.entries(operation.responses ?? {}) as Array<[string, { $ref?: string, content?: Record<string, { schema?: unknown }> }]>) {
    const response = value.$ref ? spec.components.responses[value.$ref.split('/').at(-1)!] : value
    result[status] = {}
    for (const [mediaType, content] of Object.entries((response?.content ?? {}) as Record<string, { schema?: unknown }>)) {
      if (content.schema) {
        result[status]![mediaType] = stripSchema(spec, content.schema)
      }
    }
  }
  return result
}

function parameterEnum(spec: Spec, name: string): string[] {
  const parameter = Object.values(spec.components.parameters).find((item) => item.name === name && item.schema?.enum)
  if (!parameter?.schema?.enum) {
    throw new Error(`No enum for query parameter ${name}`)
  }
  return parameter.schema.enum
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
    seriesAggregationType: parameterEnum(spec, 'aggregationType'),
    seriesAggregationFunction: parameterEnum(spec, 'aggregationFunction'),
  }

  const paths = specPaths(spec)

  const output = `// Generated by scripts/generate-testing-capabilities.ts — do not edit by hand.
// Source: ${SPEC_URL}${source === SPEC_URL ? '' : ' (local copy)'} (version: ${spec.info?.version ?? 'unknown'})
// Regenerate: pnpm gen:testing-capabilities

/** Query parameters and required body fields of the endpoints the fake tenant emulates. */
export const C8Y_ENDPOINTS = ${JSON.stringify(endpoints, null, 2)} as const satisfies Record<string, { query: readonly string[], required?: readonly string[] }>

/** Enum values from the spec. */
export const C8Y_ENUMS = ${JSON.stringify(enums, null, 2)} as const

/** Every \`METHOD /path\` the spec documents (path parameters as \`{name}\`). */
export const C8Y_SPEC_PATHS = ${JSON.stringify(paths, null, 2)} as const

export type C8yEndpoint = keyof typeof C8Y_ENDPOINTS
export type C8yAlarmSeverity = typeof C8Y_ENUMS.alarmSeverity[number]
export type C8yAlarmStatus = typeof C8Y_ENUMS.alarmStatus[number]
export type C8yOperationStatus = typeof C8Y_ENUMS.operationStatus[number]
`
  const root = join(dirname(fileURLToPath(import.meta.url)), '..')
  const outputPath = join(root, 'src', 'testing', 'capabilities.generated.ts')
  await writeFile(outputPath, output)
  consola.success(`Wrote ${ENDPOINTS.length} endpoints and ${paths.length} spec paths to ${outputPath}`)

  const responses = Object.fromEntries(ENDPOINTS.map((endpoint) => [endpoint, responsesOf(spec, endpoint)]))
  const parameters = Object.fromEntries(ENDPOINTS.map((endpoint) => [endpoint, describeParameters(spec, endpoint)]))
  const specPath = join(root, 'tests', 'contract', 'spec.generated.json')
  await writeFile(specPath, `${JSON.stringify({ $comment: 'Generated by scripts/generate-testing-capabilities.ts from the Cumulocity OpenAPI spec: the documented query parameters (type, enum, default, limits) and responses (status, media type, schema without prose, read-only properties as required) of the endpoints the fake tenant emulates. Do not edit by hand.', version: spec.info?.version ?? 'unknown', parameters, responses }, null, 2)}\n`)
  consola.success(`Wrote the response schemas to ${specPath}`)
}

await main()
