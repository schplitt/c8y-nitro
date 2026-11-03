import type { TenantData } from '../store'
import { childIds, descendants } from '../store'
import { parsePlatformDate } from './http'

/**
 * The Cumulocity inventory query language (OData 2.0 style), as documented in
 * "Query language" of the Cumulocity REST API docs and verified against a
 * real tenant:
 *
 * - `eq`, `gt`, `ge`, `lt`, `le`, `and`, `or`, `not(...)`, parentheses
 * - `has(fragment)`, `hasany(a, b)`, `bygroupid(id, …)`, `isinhierarchyof(id, …)`
 * - strings in single quotes; `*` wildcards match case-insensitively, exact
 *   matches are case-sensitive
 * - numbers: integers (`5`, `05`, `5d`); decimals need an `f`/`d` suffix
 *   (`3.5d`), otherwise they are strings. Values are typed: a number never
 *   matches a string property and a quoted value never matches a number
 * - `true`/`false` match booleans only; `null` matches a stored `null` only,
 *   never a missing property
 * - date-times via `.date` (`creationTime.date gt '2026-…'`): the literal
 *   needs a date and a time; anything else matches nothing
 * - `eq` on array properties matches any element (`customers.id eq '1'`)
 * - `has()`/`hasany()` on a standard property (`name`, `type`, …) match nothing
 * - a quoted left side (`'name' eq 'x'`) is accepted and read as the property
 * - `$orderby=field [asc|desc], …`; arrays sort by their smallest element
 *   ascending and their largest descending
 *
 * Function arguments are not validated: a non-numeric group id matches nothing
 * and a quoted fragment name works like an unquoted one. Anything else (`ne`,
 * upper-case operators, paths with `/` or `[`) is rejected with 422 like on the
 * platform.
 */
export interface ParsedQuery {
  filter: (document: Record<string, unknown>) => boolean
  orderBy: Array<{ field: string, descending: boolean }>
}

/**
 * A query the platform would reject (answered with 422).
 */
export class QuerySyntaxError extends Error {}

type Literal = string | number | boolean | null
interface Token { kind: 'word' | 'string' | 'punct', value: string }

const COMPARISONS = new Set(['eq', 'gt', 'ge', 'lt', 'le'])
// A property path or fragment name. The platform rejects `groups/id` and
// `externalIds["x"].id` (verified); other characters are left alone.
const PATH = /^[^/[\]]+$/
/**
 * Standard managed object properties, for which `has()` is "not supported"
 * (verified against the platform: the query matches nothing).
 */
const STANDARD_PROPERTIES = new Set(['id', 'self', 'name', 'type', 'owner', 'creationTime', 'lastUpdated', 'childDevices', 'childAssets', 'childAdditions', 'deviceParents', 'assetParents', 'additionParents'])

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
  if (token.value === 'true' || token.value === 'false') {
    return token.value === 'true'
  }
  if (/^-?\d+[fd]?$/i.test(token.value)) {
    return Number.parseInt(token.value, 10)
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
      return items.flatMap((item) => (item && typeof item === 'object' && Object.hasOwn(item, key)) ? [(item as Record<string, unknown>)[key]] : [])
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

/**
 * The regular expression of a `*` wildcard literal (case-insensitive), or
 * undefined for a literal without wildcards.
 * @param expected - The literal
 */
function wildcard(expected: Literal): RegExp | undefined {
  if (typeof expected !== 'string' || !expected.includes('*')) {
    return undefined
  }
  const pattern = expected.split('*').map((part) => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*')
  return new RegExp(`^${pattern}$`, 'i')
}

function compareOne(actual: unknown, operator: string, expected: Literal, asDate: boolean, pattern?: RegExp): boolean {
  if (expected === null) {
    // verified: only a stored null, never a missing property
    return operator === 'eq' && actual === null
  }
  if (actual === null || actual === undefined || typeof actual === 'object') {
    return false
  }
  if (asDate) {
    const left = Date.parse(String(actual))
    const right = expected as number
    switch (operator) {
      case 'eq': return left === right
      case 'gt': return left > right
      case 'ge': return left >= right
      case 'lt': return left < right
      default: return left <= right
    }
  }
  // verified: values are typed (numbers, strings, booleans never match each other)
  if (typeof actual !== typeof expected) {
    return false
  }
  if (operator === 'eq') {
    return pattern ? pattern.test(String(actual)) : actual === expected
  }
  if (typeof expected === 'boolean') {
    return false
  }
  const left = actual as number | string
  const right = expected
  switch (operator) {
    case 'gt': return left > right
    case 'ge': return left >= right
    case 'lt': return left < right
    default: return left <= right
  }
}

// A `.date` literal needs a date and a time (seconds, fraction, and zone optional)
const QUERY_DATE = /^\d{4}-\d{1,2}-\d{1,2}T\d{1,2}:\d{1,2}(:\d{1,2}(\.\d+)?)?(Z|[+-]\d{1,2}(:?\d{2})?)?$/

/**
 * Parses a `.date` literal the way the platform does (verified): a value
 * without a date and a time (`'2020-01-01'`, `'yesterday'`, lower-case `t`/`z`)
 * matches nothing, one with the right shape but impossible fields
 * (`'2020-13-01T00:00:00Z'`, a fraction longer than nine digits) is rejected
 * with 422.
 * @param value - The literal
 * @returns Epoch milliseconds, `NaN` (matches nothing), or `'invalid'` (422)
 */
function queryDate(value: string): number | 'invalid' {
  if (!QUERY_DATE.test(value)) {
    return Number.NaN
  }
  const withSeconds = value.replace(/^(\d{4}-\d{1,2}-\d{1,2}T\d{1,2}:\d{1,2})(?![:\d])/, '$1:00')
  const time = parsePlatformDate(withSeconds)
  return Number.isNaN(time) ? 'invalid' : time
}

/**
 * `has(fragment)`: the property exists. Standard properties are "not
 * supported": the platform matches nothing for them.
 * @param document
 * @param fragment
 */
function hasFragment(document: Record<string, unknown>, fragment: string): boolean {
  return !STANDARD_PROPERTIES.has(fragment.split('.')[0]!) && readValues(document, fragment).length > 0
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
    // verified: arguments are not validated (`bygroupid(abc)`, `has('x')` are
    // accepted), but they are separated by commas, without a trailing one
    while (true) {
      const token = next()
      if (token.kind === 'punct' || (token.kind === 'word' && !PATH.test(token.value))) {
        throw new QuerySyntaxError(`invalid function argument "${token.value}"`)
      }
      args.push(token.value)
      if (next().value === ')') {
        return args
      }
    }
  }
  const comparison = (): [string, Literal] => {
    const operator = next()
    if (operator.kind !== 'word' || !COMPARISONS.has(operator.value)) {
      throw new QuerySyntaxError(`unknown operator "${operator.value}"`)
    }
    return [operator.value, literal(next())]
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
    if (token.kind === 'punct') {
      throw new QuerySyntaxError(`unexpected "${token.value}"`)
    }
    // verified: a quoted left side ('name' eq 'x') is accepted and names the
    // property; keywords and functions are only recognized unquoted
    if (token.kind === 'word' && token.value === 'not') {
      expect('(')
      const inner = parseOr()
      expect(')')
      return (document) => !inner(document)
    }
    if (token.kind === 'word' && peek()?.value === '(') {
      switch (token.value) {
        case 'has': {
          const args = argumentList()
          if (args.length !== 1) {
            throw new QuerySyntaxError('has() accepts one argument')
          }
          return (document) => hasFragment(document, args[0]!)
        }
        case 'hasany': {
          const args = argumentList()
          return (document) => args.some((fragment) => hasFragment(document, fragment))
        }
        case 'bygroupid': {
          // direct members (child assets) of the given groups (the set is
          // built once per query, not per document)
          const args = argumentList()
          let members: Set<string> | undefined
          return (document) => (members ??= new Set(args.flatMap((group) => childIds(data, group, 'childAssets')))).has(String(document.id))
        }
        case 'isinhierarchyof': {
          // the given objects and all their children (assets, devices, additions), recursively
          const args = argumentList()
          let members: Set<string> | undefined
          return (document) => (members ??= descendants(data, args)).has(String(document.id))
        }
        default:
          throw new QuerySyntaxError(`unknown function ${token.value}()`)
      }
    }
    if (!PATH.test(token.value)) {
      throw new QuerySyntaxError(`invalid property path "${token.value}"`)
    }
    const [operator, value] = comparison()
    const asDate = token.value.endsWith('.date')
    const path = asDate ? token.value.slice(0, -'.date'.length) : token.value
    const date = asDate ? queryDate(String(value)) : undefined
    if (date === 'invalid') {
      throw new QuerySyntaxError(`invalid date "${String(value)}"`)
    }
    const expected = date ?? value
    const pattern = wildcard(expected)
    return (document) => {
      const values = readValues(document, path)
      return values.length === 0
        ? compareOne(undefined, operator, expected, asDate, pattern)
        : values.some((actual) => compareOne(actual, operator, expected, asDate, pattern))
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
  // verified against the platform: missing values first (ascending), then
  // numbers, then strings (by character code), then booleans (MongoDB's order).
  // Ids are numeric on the platform. An array sorts by its smallest element
  // ascending and its largest descending.
  const rank = (value: unknown) => value === undefined || value === null ? 0 : typeof value === 'number' ? 1 : typeof value === 'string' ? 2 : 3
  const compare = (left: unknown, right: unknown) => rank(left) !== rank(right)
    ? rank(left) - rank(right)
    : (left as number | string) < (right as number | string) ? -1 : 1
  const sortKey = (document: T, field: string, descending: boolean): unknown => {
    const values = readValues(document, field).filter((value) => typeof value !== 'object' || value === null)
    if (field === 'id') {
      const id = Number(values[0])
      return Number.isNaN(id) ? undefined : id
    }
    return values.reduce<unknown>((best, value) => best === undefined ? value : (descending ? compare(value, best) > 0 : compare(value, best) < 0) ? value : best, undefined)
  }
  // keys once per document, not per comparison
  const keyed = items.map((item) => ({ item, keys: orderBy.map(({ field, descending }) => sortKey(item, field, descending)) }))
  keyed.sort((a, b) => {
    for (const [index, { descending }] of orderBy.entries()) {
      const left = a.keys[index]
      const right = b.keys[index]
      if (left === right || (rank(left) === 0 && rank(right) === 0)) {
        continue
      }
      const result = compare(left, right)
      return descending ? -result : result
    }
    return 0
  })
  return keyed.map(({ item }) => item)
}
