import type { C8YKnownRole } from './roles.generated'

export type { C8YKnownRole } from './roles.generated'

/**
 * Roles your microservice provides. Populated at runtime from the manifest's
 * `roles` field (see the module's generated `c8y-nitro.d.ts`).
 */
export interface C8YRoles {}

/**
 * A Cumulocity role usable in the manifest. Autocompletes the platform roles
 * known from the OpenAPI spec ({@link C8YKnownRole}) while still accepting any
 * other string (custom roles, or roles not yet in the generated list).
 */
export type C8YRole = C8YKnownRole | (string & {})
