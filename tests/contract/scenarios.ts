/**
 * All contract scenarios, one file per API area in ./scenarios.
 * They run against the fake (tests/server/contract.test.ts) and a real tenant
 * (tests/contract/real-tenant.test.ts, `pnpm test:contract`).
 */
import type { ContractScenario } from './helpers'
import { alarmsScenarios } from './scenarios/alarms'
import { binariesScenarios } from './scenarios/binaries'
import { eventsScenarios } from './scenarios/events'
import { identityScenarios } from './scenarios/identity'
import { inventoryScenarios } from './scenarios/inventory'
import { measurementsScenarios } from './scenarios/measurements'
import { notificationsScenarios } from './scenarios/notifications'
import { operationsScenarios } from './scenarios/operations'
import { optionsScenarios } from './scenarios/options'
import { platformScenarios } from './scenarios/platform'

export type { ContractContext, ContractScenario } from './helpers'

export const scenarios: ContractScenario[] = [
  ...alarmsScenarios,
  ...binariesScenarios,
  ...eventsScenarios,
  ...identityScenarios,
  ...inventoryScenarios,
  ...measurementsScenarios,
  ...notificationsScenarios,
  ...operationsScenarios,
  ...optionsScenarios,
  ...platformScenarios,
]
