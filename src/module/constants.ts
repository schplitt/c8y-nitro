export const GENERATED_LIVENESS_ROUTE = '/_c8y_nitro/liveness'
export const GENERATED_READINESS_ROUTE = '/_c8y_nitro/readiness'
export const GENERATED_INVALIDATE_TENANT_OPTIONS_ROUTE = '/_c8y_nitro/invalidate-tenant-options'

/**
 * Directory the module writes its generated type declarations into, relative to
 * the project root. Consumers add `node_modules/.c8y-nitro/*.d.ts` to their
 * tsconfig `include` — nitro no longer generates a tsconfig to inherit from.
 */
export const C8Y_NITRO_TYPES_DIR = 'node_modules/.c8y-nitro'

/**
 * File name of the generated declarations inside {@link C8Y_NITRO_TYPES_DIR}.
 */
export const C8Y_NITRO_TYPES_FILE = 'types.d.ts'
