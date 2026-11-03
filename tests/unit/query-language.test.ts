/**
 * Property test of the fake tenant's inventory query language: random worlds
 * and random expressions, checked against a small oracle that evaluates the
 * expression tree directly (with the platform's documented semantics). Fixed
 * seeds, plus a fresh one outside CI; a failure names its seed, reproduce it
 * with `C8Y_QUERY_SEED=<n> pnpm vitest run tests/unit/query-language.test.ts`.
 */
import process from 'node:process'
import { describe, expect, it } from 'vitest'
import { applyOrderBy, parseQuery, QuerySyntaxError } from '../../src/testing/api/query'
import { addChild, store } from '../../src/testing/store'
import type { StoredDocument } from '../../src/testing/store'

// ── random source ────────────────────────────────────────────────────────────

function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6D2B79F5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

class Random {
  next: () => number
  constructor(seed: number) {
    this.next = mulberry32(seed)
  }

  int(max: number): number {
    return Math.floor(this.next() * max)
  }

  pick<T>(items: readonly T[]): T {
    return items[this.int(items.length)]!
  }

  chance(probability: number): boolean {
    return this.next() < probability
  }
}

const WORDS = ['Pump', 'pump', 'Valve', 'Ventil', 'Motor Ä', 'AH-VW-10', 'AH-VW-100', 'it\'s', 'a*b', '5', '05', '2.5', 'ø', '', 'Zebra', 'zebra', '(x)', 'x,y', 'true', 'null']
const TYPES = ['c8y_Device', 'c8y_Group', 'ACME_Machine']
const NUMBERS = [0, 1, 5, 7, 10, 42, -3, 2.5, 6.5, 100]

// ── random world ─────────────────────────────────────────────────────────────

function randomValue(random: Random, depth = 0): unknown {
  switch (random.int(depth > 1 ? 5 : 8)) {
    case 0: return random.pick(WORDS)
    case 1: return random.pick(NUMBERS)
    case 2: return random.chance(0.5)
    case 3: return null
    case 4: return random.pick(WORDS)
    case 5: return Array.from({ length: random.int(4) }, () => randomValue(random, depth + 1))
    case 6: return { v: randomValue(random, depth + 1), w: randomValue(random, depth + 1) }
    default: return [{ id: random.pick(WORDS) }, { id: random.pick(NUMBERS) }]
  }
}

function randomWorld(random: Random, size: number) {
  store.reset()
  const data = store.tenant('t1')
  for (let i = 0; i < size; i++) {
    const document: StoredDocument = { id: store.newId(), name: random.pick(WORDS), type: random.pick(TYPES), creationTime: new Date(Date.UTC(2026, 0, 1 + random.int(30))).toISOString() }
    for (const field of ['num', 'flag', 'nested', 'tags', 'c8y_Position', 'c8y_IsDevice']) {
      if (random.chance(0.6)) {
        document[field] = field === 'c8y_IsDevice' ? {} : randomValue(random)
      }
    }
    data.managedObjects.set(document.id, document)
  }
  const ids = [...data.managedObjects.keys()]
  for (let i = 0; i < size / 3; i++) {
    const parent = random.pick(ids)
    const child = random.pick(ids)
    if (parent !== child) {
      addChild(data, parent, random.pick(['childAssets', 'childDevices', 'childAdditions'] as const), child)
    }
  }
  return { data, documents: [...data.managedObjects.values()] }
}

// ── random expressions and their oracle ──────────────────────────────────────

// a `bare` literal is an unquoted word that is not a number: compared as a string
type Literal = { kind: 'string' | 'bare', value: string } | { kind: 'number', value: number } | { kind: 'boolean', value: boolean } | { kind: 'null' }
type Node
  = | { kind: 'compare', path: string, operator: string, literal: Literal, date?: boolean }
    | { kind: 'literal-left', left: string, operator: string, literal: Literal }
    | { kind: 'and' | 'or', left: Node, right: Node }
    | { kind: 'not', operand: Node }
    | { kind: 'has', fragments: string[] }
    | { kind: 'group', ids: string[], hierarchy: boolean }

// `constructor` and `toString` exist on every object's prototype but on no document
const PATHS = ['name', 'type', 'num', 'flag', 'nested.v', 'nested.w', 'tags', 'tags.id', 'c8y_Position', 'missing', 'nested', 'owner', 'constructor', 'toString']
// quoted left sides: properties, and words the parser must not read as keywords
const LEFT_SIDES = [...PATHS, 'not', 'has', 'and', 'or', 'bygroupid', 'a*b', 'it\'s']
const BARE_WORDS = ['2.5', '6.5', '1.0', 'Pump', 'ø', 'x']
const OPERATORS = ['eq', 'eq', 'eq', 'gt', 'ge', 'lt', 'le']

function randomLiteral(random: Random): Literal {
  switch (random.int(6)) {
    case 0: return { kind: 'number', value: random.pick(NUMBERS) }
    case 1: return { kind: 'boolean', value: random.chance(0.5) }
    case 2: return { kind: 'null' }
    case 3: return { kind: 'bare', value: random.pick(BARE_WORDS) }
    default: {
      const value = random.pick(WORDS)
      // wildcards somewhere in the word
      return { kind: 'string', value: random.chance(0.3) ? `${value.slice(0, random.int(value.length + 1))}*` : random.chance(0.2) ? `*${value}*` : value }
    }
  }
}

function randomNode(random: Random, ids: string[], depth = 0): Node {
  const roll = random.int(depth > 2 ? 4 : 9)
  switch (roll) {
    case 0: return { kind: 'has', fragments: Array.from({ length: 1 + random.int(2) }, () => random.pick(PATHS)) }
    case 1: return { kind: 'literal-left', left: random.pick(LEFT_SIDES), operator: random.pick(OPERATORS), literal: randomLiteral(random) }
    case 2: return { kind: 'group', ids: Array.from({ length: 1 + random.int(2) }, () => random.pick(ids)), hierarchy: random.chance(0.5) }
    case 4: return { kind: 'and', left: randomNode(random, ids, depth + 1), right: randomNode(random, ids, depth + 1) }
    case 5: return { kind: 'or', left: randomNode(random, ids, depth + 1), right: randomNode(random, ids, depth + 1) }
    case 6: return { kind: 'not', operand: randomNode(random, ids, depth + 1) }
    case 7: return { kind: 'compare', path: 'creationTime', operator: random.pick(OPERATORS), literal: { kind: 'string', value: randomDateLiteral(random) }, date: true }
    default: return { kind: 'compare', path: random.pick(PATHS), operator: random.pick(OPERATORS), literal: randomLiteral(random) }
  }
}

// the shapes a `.date` literal can take: full ISO, no seconds, one-digit fields,
// a zone, and two that are no date-time at all (they match nothing)
function randomDateLiteral(random: Random): string {
  const day = 1 + random.int(30)
  const hour = random.int(24)
  switch (random.int(6)) {
    case 0: return `2026-1-${day}T${hour}:0`
    case 1: return `2026-01-${String(day).padStart(2, '0')}T${String(hour).padStart(2, '0')}:00:00+01:00`
    case 2: return `2026-01-${String(day).padStart(2, '0')}`
    case 3: return new Date(Date.UTC(2026, 0, day, hour)).toISOString().toLowerCase()
    default: return new Date(Date.UTC(2026, 0, day, hour)).toISOString()
  }
}

/**
 * The oracle's reading of a `.date` literal: a date, `T`, hours and minutes;
 * seconds, a fraction, and a zone (`Z` or `±hh:mm`) are optional.
 * @param literal
 */
function oracleDate(literal: string): number {
  const match = /^(\d{4})-(\d{1,2})-(\d{1,2})T(\d{1,2}):(\d{1,2})(?::(\d{1,2})(?:\.(\d+))?)?(Z|[+-]\d{2}:\d{2})?$/.exec(literal)
  if (!match) {
    return Number.NaN
  }
  const [year, month, day, hour, minute, second = 0] = match.slice(1, 7).map((field) => Number(field ?? 0))
  const zone = match[8] ?? 'Z'
  const offset = zone === 'Z' ? 0 : (zone.startsWith('-') ? -1 : 1) * (Number(zone.slice(1, 3)) * 60 + Number(zone.slice(4, 6)))
  return Date.UTC(year!, month! - 1, day!, hour!, minute!, second!, Number(`0.${match[7] ?? '0'}`) * 1000) - offset * 60_000
}

function renderLiteral(random: Random, literal: Literal): string {
  switch (literal.kind) {
    case 'string': return `'${literal.value.replaceAll('\'', '\'\'')}'`
    case 'bare': return literal.value
    case 'boolean': return String(literal.value)
    case 'null': return 'null'
    case 'number': {
      const suffix = random.pick(['', 'd', 'f', 'D'])
      // a decimal is only a number with a suffix
      return Number.isInteger(literal.value) ? `${literal.value}${suffix}` : `${literal.value}${suffix || 'd'}`
    }
  }
}

function render(random: Random, node: Node): string {
  const wrap = (text: string) => random.chance(0.5) ? `(${text})` : text
  switch (node.kind) {
    case 'compare': return wrap(`${node.path}${node.date ? '.date' : ''} ${node.operator} ${renderLiteral(random, node.literal)}`)
    case 'literal-left': return wrap(`'${node.left.replaceAll('\'', '\'\'')}' ${node.operator} ${renderLiteral(random, node.literal)}`)
    case 'and': return wrap(`${render(random, node.left)} and ${render(random, node.right)}`)
    case 'or': return `(${render(random, node.left)} or ${render(random, node.right)})`
    case 'not': return `not(${render(random, node.operand)})`
    case 'has': return node.fragments.length === 1 && random.chance(0.7) ? `has(${node.fragments[0]})` : `hasany(${node.fragments.join(random.pick([',', ', ']))})`
    case 'group': return `${node.hierarchy ? 'isinhierarchyof' : 'bygroupid'}(${node.ids.join(',')})`
  }
}

// The oracle: the documented semantics, written independently of the parser.

function valuesAt(value: unknown, path: string[]): unknown[] {
  if (path.length === 0) {
    return Array.isArray(value) ? value : [value]
  }
  if (Array.isArray(value)) {
    // arrays inside arrays are not entered (MongoDB semantics)
    return value.filter((item) => !Array.isArray(item)).flatMap((item) => valuesAt(item, path))
  }
  if (value && typeof value === 'object' && Object.hasOwn(value, path[0]!)) {
    return valuesAt((value as Record<string, unknown>)[path[0]!], path.slice(1))
  }
  return []
}

function wildcardMatch(pattern: string, text: string): boolean {
  // backtracking matcher for `*`, case-insensitive
  const p = pattern.toLowerCase()
  const t = text.toLowerCase()
  const match = (i: number, j: number): boolean => {
    if (i === p.length) {
      return j === t.length
    }
    if (p[i] === '*') {
      for (let k = j; k <= t.length; k++) {
        if (match(i + 1, k)) {
          return true
        }
      }
      return false
    }
    return j < t.length && p[i] === t[j] && match(i + 1, j + 1)
  }
  return match(0, 0)
}

function compareValue(actual: unknown, operator: string, literal: Literal, date: boolean | undefined): boolean {
  if (literal.kind === 'null') {
    return operator === 'eq' && actual === null
  }
  if (actual === null || actual === undefined || typeof actual === 'object') {
    return false
  }
  if (date) {
    const left = Date.parse(String(actual))
    const right = oracleDate((literal as { value: string }).value)
    return { eq: left === right, gt: left > right, ge: left >= right, lt: left < right, le: left <= right }[operator]!
  }
  if (literal.kind === 'boolean') {
    return operator === 'eq' && actual === literal.value
  }
  if (literal.kind === 'number' ? typeof actual !== 'number' : typeof actual !== 'string') {
    return false
  }
  if (operator === 'eq') {
    return literal.kind !== 'number' && literal.value.includes('*') ? wildcardMatch(literal.value, actual as string) : actual === literal.value
  }
  const left = actual as number | string
  const right = literal.value as number | string
  return { gt: left > right, ge: left >= right, lt: left < right, le: left <= right }[operator]!
}

const STANDARD = new Set(['id', 'self', 'name', 'type', 'owner', 'creationTime', 'lastUpdated', 'childDevices', 'childAssets', 'childAdditions', 'deviceParents', 'assetParents', 'additionParents'])

function oracle(node: Node, document: StoredDocument, world: ReturnType<typeof randomWorld>): boolean {
  switch (node.kind) {
    case 'compare': {
      const values = valuesAt(document, node.path.split('.'))
      return values.length === 0 ? compareValue(undefined, node.operator, node.literal, node.date) : values.some((value) => compareValue(value, node.operator, node.literal, node.date))
    }
    case 'literal-left': {
      // a quoted left side names the property
      const values = valuesAt(document, node.left.split('.'))
      return values.length === 0 ? compareValue(undefined, node.operator, node.literal, false) : values.some((value) => compareValue(value, node.operator, node.literal, false))
    }
    case 'and': return oracle(node.left, document, world) && oracle(node.right, document, world)
    case 'or': return oracle(node.left, document, world) || oracle(node.right, document, world)
    case 'not': return !oracle(node.operand, document, world)
    case 'has': return node.fragments.some((fragment) => !STANDARD.has(fragment.split('.')[0]!) && valuesAt(document, fragment.split('.')).length > 0)
    case 'group': {
      const members = new Set<string>()
      const visit = (id: string) => {
        if (members.has(id)) {
          return
        }
        members.add(id)
        const children = world.data.children.get(id)
        for (const kind of ['childAssets', 'childDevices', 'childAdditions'] as const) {
          for (const child of children?.[kind] ?? []) {
            visit(child)
          }
        }
      }
      for (const id of node.ids) {
        if (node.hierarchy) {
          visit(id)
        } else {
          for (const child of world.data.children.get(id)?.childAssets ?? []) {
            members.add(child)
          }
        }
      }
      return members.has(document.id)
    }
  }
}

// ── ordering oracle ──────────────────────────────────────────────────────────

// MongoDB's order of types: missing, numbers, strings, booleans
function rank(value: unknown): number {
  return value === undefined || value === null ? 0 : typeof value === 'number' ? 1 : typeof value === 'string' ? 2 : 3
}

function sortValue(document: StoredDocument, field: string, descending: boolean): unknown {
  const values = valuesAt(document, field.split('.')).filter((value) => typeof value !== 'object' || value === null)
  if (field === 'id') {
    return Number(values[0])
  }
  let best: unknown
  for (const value of values) {
    if (best === undefined) {
      best = value
    } else {
      const less = rank(value) !== rank(best) ? rank(value) < rank(best) : (value as number | string) < (best as number | string)
      if (descending ? !less && value !== best : less) {
        best = value
      }
    }
  }
  return best
}

function inOrder(left: unknown, right: unknown, descending: boolean): boolean {
  const l = rank(left)
  const r = rank(right)
  if (l === 0 && r === 0) {
    return true
  }
  const result = l !== r ? l - r : left === right ? 0 : (left as number | string) < (right as number | string) ? -1 : 1
  return descending ? result >= 0 : result <= 0
}

// ── the properties ───────────────────────────────────────────────────────────

// Fixed seeds, plus a fresh one locally (its number is in the test title;
// `C8Y_QUERY_SEED=<n>` reruns it). CI stays reproducible.
const envSeed = process.env.C8Y_QUERY_SEED
const SEEDS = envSeed !== undefined && envSeed !== ''
  ? [Number(envSeed)]
  : [11, 23, 37, 53, ...(process.env.CI ? [] : [Math.floor(Math.random() * 1_000_000)])]

describe.each(SEEDS)('query language (seed %i)', (seed) => {
  const world = randomWorld(new Random(seed), 40)
  const ids = world.documents.map((document) => document.id)
  // one stream per test, so a single test reproduces by seed (`-t`)
  const streams = [1, 2, 3].map((index) => new Random(seed * 31 + index))

  it('filters like the oracle for 300 random expressions', () => {
    const random = streams[0]!
    for (let i = 0; i < 300; i++) {
      const node = randomNode(random, ids)
      const text = render(random, node)
      const query = random.chance(0.5) ? `$filter=${text}` : text
      const parsed = parseQuery(query, world.data)
      for (const document of world.documents) {
        expect(parsed.filter(document), `seed ${seed}: ${query} on ${JSON.stringify(document)}`).toBe(oracle(node, document, world))
      }
    }
  })

  it('orders like the oracle for 100 random $orderby clauses', () => {
    const random = streams[1]!
    for (let i = 0; i < 100; i++) {
      const orderBy = Array.from({ length: 1 + random.int(3) }, () => ({ field: random.pick([...PATHS, 'id']), descending: random.chance(0.5) }))
      const text = `$orderby=${orderBy.map(({ field, descending }) => `${field}${descending ? ' desc' : random.pick(['', ' asc'])}`).join(random.pick([',', ', ']))}`
      const parsed = parseQuery(text, world.data)
      expect(parsed.orderBy).toEqual(orderBy)
      const sorted = applyOrderBy(world.documents, parsed.orderBy)
      expect(sorted).toHaveLength(world.documents.length)
      for (let j = 1; j < sorted.length; j++) {
        for (const { field, descending } of orderBy) {
          const left = sortValue(sorted[j - 1]!, field, descending)
          const right = sortValue(sorted[j]!, field, descending)
          expect(inOrder(left, right, descending), `seed ${seed}: ${text}: ${JSON.stringify(left)} before ${JSON.stringify(right)}`).toBe(true)
          if (!inOrder(right, left, descending)) {
            break // strictly ordered by this field, the next fields do not matter
          }
        }
      }
    }
  })

  it('answers garbage with a syntax error, never with another exception', () => {
    const random = streams[2]!
    const pieces = ['name', 'eq', '\'', '(', ')', 'and', 'or', 'not', 'has', '*', ',', '5d', 'null', '$filter=', '$orderby=', ' ', 'bygroupid', 'ne', '/', '"', 'AND']
    for (let i = 0; i < 300; i++) {
      const text = Array.from({ length: 1 + random.int(8) }, () => random.pick(pieces)).join(random.pick(['', ' ']))
      try {
        const parsed = parseQuery(text, world.data)
        for (const document of world.documents) {
          expect(typeof parsed.filter(document)).toBe('boolean')
        }
      } catch (error) {
        expect(error, `seed ${seed}: ${text}`).toBeInstanceOf(QuerySyntaxError)
      }
    }
  })
})
