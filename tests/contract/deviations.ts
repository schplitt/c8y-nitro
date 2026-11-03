import type { C8yEndpoint } from '../../src/testing/capabilities.generated'

/**
 * Where the platform deviates from its OpenAPI spec, by the id of its row in
 * docs/reference/platform-behavior.md. Used by tests/server/contract-spec.test.ts
 * (to allow the response) and tests/unit/platform-behavior.test.ts (every id
 * must be documented).
 */

/**
 * Statuses the platform answers although the spec does not document them.
 */
export const DEVIATIONS: Partial<Record<C8yEndpoint, Record<number, string>>> = {
  'GET /measurement/measurements/{id}': { 405: 'measurement-by-id-405' },
  'GET /measurement/measurements/series': { 400: 'series-validation-statuses', 422: 'series-validation-statuses' },
  'GET /measurement/measurements': { 422: 'date-parameters-lenient' },
  'POST /measurement/measurements': { 400: 'time-unparsable-400' },
  'GET /event/events': { 404: 'source-unknown', 422: 'date-parameters-lenient' },
  'GET /alarm/alarms': { 404: 'source-unknown', 422: 'date-parameters-lenient' },
  'POST /alarm/alarms': { 400: 'time-unparsable-400', 404: 'alarm-unknown-source-404' },
  'POST /event/events': { 400: 'time-unparsable-400' },
  'POST /identity/globalIds/{id}/externalIds': { 422: 'required-fields-422' },
  'GET /devicecontrol/operations': { 422: 'operations-status-filter-422' },
  'GET /inventory/binaries/{id}': { 404: 'binaries-unknown-404' },
  'DELETE /inventory/binaries/{id}': { 404: 'binaries-unknown-404' },
  'POST /notification2/unsubscribe': { 422: 'unsubscribe-statuses', 500: 'unsubscribe-statuses' },
}

/**
 * Documented statuses the platform answers with an empty body instead of the documented one.
 */
export const EMPTY_BODY_DEVIATIONS: Partial<Record<C8yEndpoint, Record<number, string>>> = {
  'PUT /inventory/binaries/{id}': { 201: 'binary-replace-empty-body' },
}

/**
 * Schema problems the platform itself has (the spec is wrong there).
 */
export const SCHEMA_DEVIATIONS: Array<{ id: string, problem: RegExp }> = [
  { id: 'binary-fragment-empty-string', problem: /c8y_IsBinary: expected an object, got ""/ },
]
