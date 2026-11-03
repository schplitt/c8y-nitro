/**
 * Minimal route matcher for `c8y.override()` patterns.
 *
 * Patterns are `"[METHOD ]/path"`. Segments can be literals, `:name` (one
 * segment, captured as a param), `*` (one segment), or `**` (any rest, also
 * empty). Without a method, the pattern matches every method.
 */
export interface CompiledRoute {
  method: string | undefined
  segments: string[]
}

export function compileRoute(pattern: string): CompiledRoute {
  const trimmed = pattern.trim()
  const spaceIndex = trimmed.indexOf(' ')
  const method = spaceIndex === -1 ? undefined : trimmed.slice(0, spaceIndex).toUpperCase()
  const path = spaceIndex === -1 ? trimmed : trimmed.slice(spaceIndex + 1).trim()
  return { method, segments: splitPath(path) }
}

export function splitPath(path: string): string[] {
  return path.split('?')[0]!.split('/').filter(Boolean)
}

/**
 * Matches a request against a compiled route.
 * @param route - Compiled route
 * @param method - Request method (upper case)
 * @param segments - Request path segments (decoded)
 * @returns Captured params, or `undefined` when the route does not match
 */
export function matchRoute(route: CompiledRoute, method: string, segments: string[]): Record<string, string> | undefined {
  if (route.method && route.method !== method) {
    return undefined
  }
  const params: Record<string, string> = {}
  for (let i = 0; i < route.segments.length; i++) {
    const part = route.segments[i]!
    if (part === '**') {
      params._ = segments.slice(i).join('/')
      return params
    }
    const value = segments[i]
    if (value === undefined) {
      return undefined
    }
    if (part === '*') {
      continue
    }
    if (part.startsWith(':')) {
      params[part.slice(1)] = value
      continue
    }
    if (part !== value) {
      return undefined
    }
  }
  return segments.length === route.segments.length ? params : undefined
}
