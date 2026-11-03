// docs/reference/platform-behavior.md lists the platform behaviors the fake
// emulates that differ from (or go beyond) the API docs. Every id there is
// verified by a contract scenario, and every id a scenario or the spec test
// names is documented there.
import { readFileSync } from 'node:fs'
import { expect, it } from 'vitest'
import { DEVIATIONS, EMPTY_BODY_DEVIATIONS, SCHEMA_DEVIATIONS } from '../contract/deviations'
import { scenarios } from '../contract/scenarios'

const page = readFileSync(new URL('../../docs/reference/platform-behavior.md', import.meta.url), 'utf8')
const documented = [...page.matchAll(/^\| `([a-z0-9-]+)`/gm)].map((match) => match[1]!)
const verified = new Set(scenarios.flatMap((scenario) => scenario.verifies ?? []))
const deviations: string[] = [...[...Object.values(DEVIATIONS), ...Object.values(EMPTY_BODY_DEVIATIONS)].flatMap((statuses) => Object.values(statuses ?? {})), ...SCHEMA_DEVIATIONS.map((deviation) => deviation.id)]

it('documents every behavior id once', () => {
  expect(documented.length).toBeGreaterThan(0)
  expect([...new Set(documented)]).toEqual(documented)
})

it('verifies every documented behavior with a contract scenario', () => {
  expect(documented.filter((id) => !verified.has(id))).toEqual([])
})

it('documents every behavior the scenarios and the spec test name', () => {
  expect([...verified, ...deviations].filter((id) => !documented.includes(id))).toEqual([])
})
