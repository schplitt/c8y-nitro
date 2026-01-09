import { relative, join, dirname } from 'node:path'
import { writeFile, mkdir } from 'node:fs/promises'
import type { Nitro, NitroTypes } from 'nitro/types'
import type { C8YAPIClientOptions } from '../types'

/**
 * Parsed route information from Nitro types.
 */
interface ParsedRoute {
  /**
   * Original route path (e.g., "/api/[id]")
   */
  path: string
  /**
   * HTTP method (get, post, put, delete, etc.)
   */
  method: string
  /**
   * Generated function name (e.g., "GetApiById")
   */
  functionName: string
  /**
   * Route parameters extracted from [param] syntax
   */
  params: string[]
  /**
   * TypeScript return type from Nitro types
   */
  returnType: string
}

/**
 * Converts route path to PascalCase function name.
 * Examples:
 * - /health + get -> GetHealth
 * - /health + post -> PostHealth
 * - /someRoute -> SomeRoute (default)
 * - /[id] or /:id + get -> GetById
 * - /api/[multiple]/[params] -> GetApiByMultipleByParams
 * @param path - The route path (e.g., "/api/[id]" or "/api/:id")
 * @param method - HTTP method (get, post, put, delete, etc.)
 */
export function generateFunctionName(path: string, method: string): string {
  // Remove leading slash and split by /
  const segments = path.replace(/^\//, '').split('/')

  // Convert each segment to PascalCase, handling [params] and :params
  const pascalSegments = segments
    .map((seg) => {
      // Handle route parameters [id] -> ById
      if (seg.startsWith('[') && seg.endsWith(']')) {
        const paramName = seg.slice(1, -1)
        return `By${capitalize(paramName)}`
      }
      // Handle route parameters :id -> ById
      if (seg.startsWith(':')) {
        const paramName = seg.slice(1)
        return `By${capitalize(paramName)}`
      }
      // Regular segment
      return capitalize(seg)
    })
    .join('')

  // Prefix with method name (Get for get, nothing for default)
  const prefix = method === 'default' ? '' : capitalize(method)

  return `${prefix}${pascalSegments || 'Index'}`
}

/**
 * Extracts route parameters from path.
 * Example: "/api/[id]/items/[itemId]" or "/api/:id/items/:itemId" -> [{name: "id", type: "string"}, {name: "itemId", type: "string"}]
 * @param path - The route path to extract parameters from
 */
export function extractParams(path: string): string[] {
  const params: string[] = []
  const segments = path.split('/')

  for (const seg of segments) {
    // Handle [param] syntax
    if (seg.startsWith('[') && seg.endsWith(']')) {
      const name = seg.slice(1, -1)
      params.push(name)
    } else if (seg.startsWith(':')) {
      // Handle :param syntax
      const name = seg.slice(1)
      params.push(name)
    }
  }

  return params
}

/**
 * Capitalizes first letter of a string.
 * @param str - The string to capitalize
 */
export function capitalize(str: string): string {
  return str.charAt(0).toUpperCase() + str.slice(1)
}

/**
 * Adjusts import paths in return type strings to be relative to output directory.
 * Import paths in types are relative to the types directory (e.g., node_modules/.nitro/types/).
 * We need to resolve them and create new paths relative to the output directory.
 * Example: "import('../../../routes/[id].get')" from types dir -> "import('../../routes/[id].get')" from output dir
 * @param returnTypeStr - The return type string containing import paths
 * @param outputDir - The output directory where the API client will be generated
 * @param typesDir - The directory where Nitro types are generated (e.g., node_modules/.nitro/types/)
 */
function adjustImportPaths(returnTypeStr: string, outputDir: string, typesDir: string): string {
  // Match import paths in the type string
  const importRegex = /import\(['"]([^'"]+)['"]\)/g

  return returnTypeStr.replace(importRegex, (_match, importPath) => {
    // Resolve the absolute path from the types directory
    const absolutePath = join(typesDir, importPath)

    // Calculate new relative path from output directory
    const newRelativePath = relative(outputDir, absolutePath).replace(/\\/g, '/')

    // Ensure it starts with ./ or ../
    const adjustedPath = newRelativePath.startsWith('.') ? newRelativePath : `./${newRelativePath}`

    return `import('${adjustedPath}')`
  })
}

/**
 * Parses Nitro routes from the type system.
 * @param types - Nitro types object containing route definitions
 * @param outputDir - The output directory where the API client will be generated
 * @param typesDir - The directory where Nitro types are generated
 */
export function parseRoutes(types: NitroTypes, outputDir: string, typesDir: string): ParsedRoute[] {
  const routes: ParsedRoute[] = []

  // Routes are in types.routes object
  if (!types.routes) {
    return routes
  }

  for (const [path, methods] of Object.entries(types.routes)) {
    if (typeof methods !== 'object' || methods === null)
      continue

    for (const [method, returnType] of Object.entries(methods)) {
      const params = extractParams(path)
      const functionName = generateFunctionName(path, method)

      // Extract return type - it's an array where first element contains the type string
      let typeString = 'unknown'
      if (Array.isArray(returnType) && returnType.length > 0) {
        typeString = returnType[0] as string
        // Adjust import paths to be relative to output directory
        typeString = adjustImportPaths(typeString, outputDir, typesDir)
      }

      // Normalize path: convert :param to [param] for consistency in generated code
      const normalizedPath = path.replace(/:([^/]+)/g, '[$1]')

      routes.push({
        path: normalizedPath,
        method,
        functionName,
        params,
        returnType: typeString,
      })
    }
  }

  return routes
}

/**
 * Generates TypeScript method code for a route in an Angular service.
 * @param route - Parsed route information including path, method, params, and return type
 */
export function generateMethod(route: ParsedRoute): string {
  const hasParams = route.params.length > 0

  // Generate inline params type
  let inlineParamsType = ''
  if (hasParams) {
    const paramFields = route.params
      .map((name) => `${name}: string | number`)
      .join('; ')
    inlineParamsType = `{ ${paramFields} }`
  }

  // Generate method signature with inline params
  const methodParam = hasParams ? `params: ${inlineParamsType}` : ''
  const returnTypeAnnotation = `Promise<${route.returnType}>`

  // Build path with param interpolation (will be prefixed with service base in template)
  let pathExpression = `\`\${this.BASE_PATH}${route.path}\``
  if (hasParams) {
    // Replace [param] with ${params.param}
    pathExpression = `\`\${this.BASE_PATH}${route.path.replace(/\[([^\]]+)\]/g, (_, paramName) => `\${params.${paramName}}`)}\``
  }

  // Generate fetch options
  const method = route.method === 'default' ? 'GET' : route.method.toUpperCase()
  const fetchOptions = `{ method: '${method}', headers: { 'Content-Type': 'application/json' } }`

  return `  async ${route.functionName}(${methodParam}): ${returnTypeAnnotation} {
    const response = await this.fetchClient.fetch(${pathExpression}, ${fetchOptions});
    return response.json();
  }`
}

/**
 * Helper types for proper type serialization from Nitro.
 * https://github.com/nitrojs/nitro/blob/67b43f2692a41728a2759462b6982c6872ed3a81/src/types/fetch/_serialize.ts
 */
const serializationTypes
  = `type JsonPrimitive = string | number | boolean | string | number | boolean | null;
type NonJsonPrimitive = undefined | Function | symbol;
type IsAny<T> = 0 extends 1 & T ? true : false;
type FilterKeys<TObj extends object, TFilter> = { [TKey in keyof TObj]: TObj[TKey] extends TFilter ? TKey : never }[keyof TObj];
type Serialize<T> = IsAny<T> extends true ? any : T extends JsonPrimitive | undefined ? T : T extends Map<any, any> | Set<any> ? Record<string, never> : T extends NonJsonPrimitive ? never : T extends {
  toJSON: () => infer U;
} ? U : T extends [] ? [] : T extends [unknown, ...unknown[]] ? SerializeTuple<T> : T extends ReadonlyArray<infer U> ? (U extends NonJsonPrimitive ? null : Serialize<U>)[] : T extends object ? SerializeObject<T> : never;
type SerializeTuple<T extends [unknown, ...unknown[]]> = { [k in keyof T]: T[k] extends NonJsonPrimitive ? null : Serialize<T[k]> };
type SerializeObject<T extends object> = { [k in keyof Omit<T, FilterKeys<T, NonJsonPrimitive>>]: Serialize<T[k]> };
type Simplify<TType> = TType extends any[] | Date ? TType : { [K in keyof TType]: Simplify<TType[K]> };
type Awaited<T> = T extends PromiseLike<infer U> ? Awaited<U> : T;
`

/**
 * Generates complete Angular API client service.
 * @param routes - Array of parsed routes to generate methods for
 * @param msBase - The microservice base name (e.g., "my-service")
 */
export function generateAPIClient(routes: ParsedRoute[], msBase: string): string {
  const methods = routes.map((route) => generateMethod(route)).join('\n\n')

  return `/**
 * Auto-generated Cumulocity API Client
 * Generated by c8y-nitro
 *
 * This Angular service provides typed methods for all Nitro routes.
 * Each method corresponds to a route handler and returns properly typed responses.
 */
import { Injectable, inject } from '@angular/core'
import { FetchClient } from '@c8y/ngx-components'

// Type helpers for proper serialization
${serializationTypes}

@Injectable({ providedIn: 'root' })
export class C8yApiClient {
  private readonly BASE_PATH = '/service/${msBase}';
  private readonly fetchClient: FetchClient = inject(FetchClient)

  constructor() {}

${methods}
}
`
}

/**
 * Calculates relative import path from output file to Nitro types.
 * @param outputPath - Absolute path to the output API client file
 * @param importsPath - Absolute path to the Nitro types file
 */
export function getRelativeImportPath(outputPath: string, importsPath: string): string {
  const rel = relative(dirname(outputPath), dirname(importsPath))
  const fileName = 'nitro-routes'

  // Normalize path separators and ensure it starts with ./
  let relativePath = join(rel, fileName).replace(/\\/g, '/')
  if (!relativePath.startsWith('.')) {
    relativePath = `./${relativePath}`
  }

  return relativePath
}

/**
 * Writes the generated API client to disk.
 * @param nitro - Nitro instance
 * @param options - API client generation options
 * @param types - Nitro types object containing route definitions
 */
export async function writeAPIClient(nitro: Nitro, options: C8YAPIClientOptions, types: NitroTypes) {
  const rootDir = nitro.options.rootDir

  // Determine paths - types are generated in this directory
  const typesDir = nitro.options.typescript.generatedTypesDir
    ? join(rootDir, nitro.options.typescript.generatedTypesDir)
    : join(rootDir, 'node_modules/.nitro/types')

  const outputDir = join(rootDir, options.dir)
  const fileName = options.name ?? 'c8y-api-client'
  const outputFile = join(outputDir, `${fileName}.ts`)

  // Parse routes from Nitro type system (pass typesDir for import path adjustment)
  const routes = parseRoutes(types, outputDir, typesDir)

  if (routes.length === 0) {
    nitro.logger.warn('No routes found to generate API client')
    return
  }

  // TODO: automatically use contextPath from manifest (which is either set or from package.json)
  // Generate API client code with microservice base path
  const code = generateAPIClient(routes, options.msBase)

  // Ensure output directory exists
  await mkdir(outputDir, { recursive: true })

  // Write to file
  await writeFile(outputFile, code, 'utf-8')

  nitro.logger.success(`Generated API client with ${routes.length} routes at: ${relative(rootDir, outputFile)}`)
}
