import type { TenantData } from '../store'
import { CHILD_KINDS, childIds } from '../store'

/**
 * The Cumulocity inventory query language (OData 2.0 style), as documented in
 * "Query language" of the Cumulocity REST API docs and verified against a
 * real tenant:
 *
 * - `eq`, `gt`, `ge`, `lt`, `le`, `and`, `or`, `not(...)`, parentheses
 * - `has(fragment)`, `hasany(a, b)`, `bygroupid(id, …)`, `isinhierarchyof(id, …)`
 * - strings in single quotes; `*` wildcards match case-insensitively, exact
 *   matches are case-sensitive
 * - numbers: integers; decimals need an `f`/`d` suffix (`3.5d`), otherwise
 *   they are compared as strings
 * - `null`, and date-times via `.date` (`creationTime.date gt '2026-…'`)
 * - `eq` on array properties matches any element (`customers.id eq '1'`)
 * - `$orderby=field [asc|desc], …`
 *
 * Anything else (e.g. `ne`) is rejected with 422 like on the platform.
 */
export interface ParsedQuery {
  filter: (document: Record<string, unknown>) => boolean
  orderBy: Array<{ field: string, descending: boolean }>
}

/**
 * A query the platform would reject (answered with 422).
 */
export class QuerySyntaxError extends Error {}

type Literal = string | number | null
interface Token { kind: 'word' | 'string' | 'punct', value: string }

const COMPARISONS = new Set(['eq', 'gt', 'ge', 'lt', 'le'])

function tokenize(input: string): Token[] {
  const tokens: Token[] = []
  let i = 0
  while (i < input.length) {
    const char = input[i]!
    if (/\s/.test(char)) {
      i++
    } else if (char === '(' || char === ')' || char === ',') {
      tokens.push({ kind: 'punct', value: char })
      i++
    } else if (char === '\'') {
      let value = ''
      i++
      while (i < input.length) {
        if (input[i] === '\'' && input[i + 1] === '\'') {
          value += '\''
          i += 2
        } else if (input[i] === '\'') {
          break
        } else {
          value += input[i++]
        }
      }
      if (i >= input.length) {
        throw new QuerySyntaxError('unterminated string')
      }
      i++
      tokens.push({ kind: 'string', value })
    } else {
      const value = /^[^\s(),']+/.exec(input.slice(i))![0]
      tokens.push({ kind: 'word', value })
      i += value.length
    }
  }
  return tokens
}

function literal(token: Token): Literal {
  if (token.kind === 'string') {
    return token.value
  }
  if (token.value === 'null') {
    return null
  }
  if (/^-?\d+$/.test(token.value)) {
    return Number(token.value)
  }
  const decimal = /^(-?\d+\.\d+)[fd]$/i.exec(token.value)
  if (decimal) {
    return Number(decimal[1])
  }
  // decimals without a suffix (and other bare words) are compared as strings
  return token.value
}

/**
 * Reads a dotted path from a document. Arrays on the way are flattened, so the
 * result is a list of all values at that path.
 * @param document - The document
 * @param path - e.g. `c8y_Hardware.serialNumber` or `customers.id`
 */
export function readValues(document: unknown, path: string): unknown[] {
  let values: unknown[] = [document]
  for (const key of path.split('.')) {
    values = values.flatMap((value) => {
      const items = Array.isArray(value) ? value : [value]
      return items.flatMap((item) => (item && typeof item === 'object' && key in item) ? [(item as Record<string, unknown>)[key]] : [])
    })
  }
  return values.flatMap((value) => Array.isArray(value) ? value : [value])
}

/**
 * Reads a single value from a dotted path (first match).
 * @param document - The document
 * @param path - Dotted path
 */
export function readPath(document: Record<string, unknown>, path: string): unknown {
  return readValues(document, path)[0]
}

function compareOne(actual: unknown, operator: string, expected: Literal, asDate: boolean): boolean {
  if (expected === null) {
    return operator === 'eq' && (actual === null || actual === undefined)
  }
  if (actual === null || actual === undefined || typeof actual === 'object') {
    return false
  }
  if (operator === 'eq') {
    if (typeof expected === 'string' && expected.includes('*')) {
      const pattern = expected.split('*').map((part) => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*')
      return new RegExp(`^${pattern}$`, 'i').test(String(actual))
    }
    return typeof expected === 'number' ? Number(actual) === expected : String(actual) === expected
  }
  let left: number | string = typeof expected === 'number' ? Number(actual) : String(actual)
  let right: number | string = expected
  if (asDate) {
    left = Date.parse(String(actual))
    right = Date.parse(String(expected))
  }
  switch (operator) {
    case 'gt': return left > right
    case 'ge': return left >= right
    case 'lt': return left < right
    default: return left <= right
  }
}

function descendants(data: TenantData, roots: string[]): Set<string> {
  const result = new Set<string>()
  const queue = [...roots]
  while (queue.length > 0) {
    const id = queue.shift()!
    if (result.has(id)) {
      continue
    }
    result.add(id)
    for (const kind of CHILD_KINDS) {
      queue.push(...childIds(data, id, kind))
    }
  }
  return result
}

function parseFilter(input: string, data: TenantData): ParsedQuery['filter'] {
  const tokens = tokenize(input)
  let position = 0
  const peek = () => tokens[position]
  const next = () => {
    const token = tokens[position++]
    if (!token) {
      throw new QuerySyntaxError('unexpected end')
    }
    return token
  }
  const expect = (value: string) => {
    if (next().value !== value) {
      throw new QuerySyntaxError(`expected "${value}"`)
    }
  }
  const argumentList = () => {
    expect('(')
    const args: string[] = []
    while (peek()?.value !== ')') {
      args.push(next().value)
      if (peek()?.value === ',') {
        next()
      }
    }
    expect(')')
    if (args.length === 0) {
      throw new QuerySyntaxError('missing function argument')
    }
    return args
  }

  function parseOr(): ParsedQuery['filter'] {
    let left = parseAnd()
    while (peek()?.kind === 'word' && peek()!.value === 'or') {
      next()
      const a = left
      const b = parseAnd()
      left = (document) => a(document) || b(document)
    }
    return left
  }

  function parseAnd(): ParsedQuery['filter'] {
    let left = parseUnary()
    while (peek()?.kind === 'word' && peek()!.value === 'and') {
      next()
      const a = left
      const b = parseUnary()
      left = (document) => a(document) && b(document)
    }
    return left
  }

  function parseUnary(): ParsedQuery['filter'] {
    const token = next()
    if (token.value === '(') {
      const inner = parseOr()
      expect(')')
      return inner
    }
    if (token.kind !== 'word') {
      throw new QuerySyntaxError(`unexpected "${token.value}"`)
    }
    if (token.value === 'not') {
      expect('(')
      const inner = parseOr()
      expect(')')
      return (document) => !inner(document)
    }
    if (peek()?.value === '(') {
      const args = argumentList()
      switch (token.value) {
        case 'has':
          if (args.length !== 1) {
            throw new QuerySyntaxError('has() accepts one argument')
          }
          return (document) => readValues(document, args[0]!).length > 0
        case 'hasany':
          return (document) => args.some((fragment) => readValues(document, fragment).length > 0)
        case 'bygroupid': {
          // direct members (child assets) of the given groups
          return (document) => args.some((group) => childIds(data, group, 'childAssets').includes(String(document.id)))
        }
        case 'isinhierarchyof': {
          // the given objects and all their children (assets, devices, additions), recursively
          return (document) => descendants(data, args).has(String(document.id))
        }
        default:
          throw new QuerySyntaxError(`unknown function ${token.value}()`)
      }
    }
    const operator = next()
    if (!COMPARISONS.has(operator.value)) {
      throw new QuerySyntaxError(`unknown operator "${operator.value}"`)
    }
    const value = literal(next())
    const asDate = token.value.endsWith('.date')
    const path = asDate ? token.value.slice(0, -'.date'.length) : token.value
    return (document) => {
      const values = readValues(document, path)
      return values.length === 0
        ? compareOne(undefined, operator.value, value, asDate)
        : values.some((actual) => compareOne(actual, operator.value, value, asDate))
    }
  }

  const filter = parseOr()
  if (position < tokens.length) {
    throw new QuerySyntaxError(`unexpected "${tokens[position]!.value}"`)
  }
  return filter
}

/**
 * Parses a `query`/`q` parameter value.
 * @param raw - e.g. `$filter=(name eq 'Pump*') $orderby=name asc`
 * @param data - Tenant data (for `bygroupid()` and `isinhierarchyof()`)
 */
export function parseQuery(raw: string, data: TenantData): ParsedQuery {
  const orderByMatch = /\$orderby=(.*)$/.exec(raw)
  const filterSource = (/\$filter=(.*?)(?:\s*\$orderby=.*)?$/.exec(raw)?.[1] ?? (orderByMatch ? raw.slice(0, orderByMatch.index) : raw)).trim()
  const orderBy = (orderByMatch?.[1] ?? '')
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const [field, direction] = part.split(/\s+/)
      return { field: field!, descending: direction?.toLowerCase() === 'desc' }
    })
  return {
    filter: filterSource ? parseFilter(filterSource, data) : () => true,
    orderBy,
  }
}

/**
 * Sorts documents by `$orderby` fields.
 * @param items - Documents
 * @param orderBy - Sort fields
 */
export function applyOrderBy<T extends Record<string, unknown>>(items: T[], orderBy: ParsedQuery['orderBy']): T[] {
  if (orderBy.length === 0) {
    return items
  }
  const key = (value: unknown) => (typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : value) as string | number
  return [...items].sort((a, b) => {
    for (const { field, descending } of orderBy) {
      const left = readPath(a, field)
      const right = readPath(b, field)
      if (left === right) {
        continue
      }
      const result = left === undefined ? 1 : right === undefined ? -1 : key(left) < key(right) ? -1 : 1
      return descending ? -result : result
    }
    return 0
  })
}
