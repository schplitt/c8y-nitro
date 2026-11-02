import { UnsupportedRequestError } from './http'

/**
 * A subset of the Cumulocity inventory query language:
 * `eq` (with `*` wildcards), `ne`, `gt`, `ge`, `lt`, `le`, `and`, `or`,
 * `not(...)`, `has(fragment)`, parentheses, and `$orderby=field [asc|desc], …`.
 * Other functions (`bygroupid`, `isinhierarchyof`, …) are not emulated and fail
 * loudly.
 */
export interface ParsedQuery {
  filter: (document: Record<string, unknown>) => boolean
  orderBy: Array<{ field: string, descending: boolean }>
}

interface Token { kind: 'word' | 'string' | 'number' | 'punct', value: string }

const COMPARISONS = new Set(['eq', 'ne', 'gt', 'ge', 'lt', 'le'])

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
      i++
      tokens.push({ kind: 'string', value })
    } else {
      const match = /^-?\d+(?:\.\d+)?(?![\w.])/.exec(input.slice(i)) ?? /^[^\s(),']+/.exec(input.slice(i))
      const value = match![0]
      tokens.push({ kind: /^-?\d/.test(value) && !Number.isNaN(Number(value)) ? 'number' : 'word', value })
      i += value.length
    }
  }
  return tokens
}

/**
 * Reads a dotted path from a document.
 * @param document - The document
 * @param path - e.g. `c8y_Hardware.serialNumber`
 */
export function readPath(document: Record<string, unknown>, path: string): unknown {
  return path.split('.').reduce<unknown>((value, key) => (value && typeof value === 'object') ? (value as Record<string, unknown>)[key] : undefined, document)
}

function compare(actual: unknown, operator: string, expected: string | number | boolean): boolean {
  if (operator === 'eq' || operator === 'ne') {
    let equal: boolean
    if (typeof expected === 'string' && expected.includes('*')) {
      const pattern = new RegExp(`^${expected.split('*').map((part) => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*')}$`)
      equal = typeof actual === 'string' && pattern.test(actual)
    } else {
      equal = actual === expected || (typeof actual === 'number' && actual === Number(expected)) || (actual !== undefined && actual !== null && String(actual) === String(expected))
    }
    return operator === 'eq' ? equal : !equal
  }
  if (actual === undefined || actual === null) {
    return false
  }
  const left = typeof expected === 'number' ? Number(actual) : String(actual)
  const right = expected
  switch (operator) {
    case 'gt': return left > right
    case 'ge': return left >= right
    case 'lt': return left < right
    default: return left <= right
  }
}

function parseFilter(input: string): ParsedQuery['filter'] {
  const tokens = tokenize(input)
  let position = 0
  const peek = () => tokens[position]
  const next = () => tokens[position++]
  const expect = (value: string) => {
    const token = next()
    if (token?.value !== value) {
      throw new UnsupportedRequestError(`could not parse inventory query "${input}" (expected "${value}")`)
    }
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
    if (!token) {
      throw new UnsupportedRequestError(`could not parse inventory query "${input}" (unexpected end)`)
    }
    if (token.value === '(') {
      const inner = parseOr()
      expect(')')
      return inner
    }
    if (token.kind === 'word' && token.value === 'not') {
      expect('(')
      const inner = parseOr()
      expect(')')
      return (document) => !inner(document)
    }
    if (token.kind === 'word' && peek()?.value === '(') {
      next()
      if (token.value !== 'has') {
        throw new UnsupportedRequestError(`inventory query function "${token.value}()" is not emulated (supported: has())`)
      }
      const fragment = next()
      expect(')')
      return (document) => readPath(document, fragment!.value) !== undefined
    }
    if (token.kind === 'word') {
      const operator = next()
      if (!operator || !COMPARISONS.has(operator.value)) {
        throw new UnsupportedRequestError(`inventory query operator "${operator?.value}" is not emulated (supported: ${[...COMPARISONS].join(', ')})`)
      }
      const literal = next()
      if (!literal) {
        throw new UnsupportedRequestError(`could not parse inventory query "${input}"`)
      }
      const value: string | number | boolean = literal.kind === 'number'
        ? Number(literal.value)
        : literal.kind === 'word' && (literal.value === 'true' || literal.value === 'false')
          ? literal.value === 'true'
          : literal.value
      return (document) => compare(readPath(document, token.value), operator.value, value)
    }
    throw new UnsupportedRequestError(`could not parse inventory query "${input}" (unexpected "${token.value}")`)
  }

  const filter = parseOr()
  if (position < tokens.length) {
    throw new UnsupportedRequestError(`could not parse inventory query "${input}" (unexpected "${tokens[position]!.value}")`)
  }
  return filter
}

/**
 * Parses a `query`/`q` parameter value.
 * @param raw - e.g. `$filter=(name eq 'Pump*') $orderby=name asc`
 */
export function parseQuery(raw: string): ParsedQuery {
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
    filter: filterSource ? parseFilter(filterSource) : () => true,
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
  return [...items].sort((a, b) => {
    for (const { field, descending } of orderBy) {
      const left = readPath(a, field)
      const right = readPath(b, field)
      if (left === right) {
        continue
      }
      const result = left === undefined ? 1 : right === undefined ? -1 : left! < right! ? -1 : 1
      return descending ? -result : result
    }
    return 0
  })
}
