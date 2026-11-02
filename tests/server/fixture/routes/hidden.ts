import { defineEventHandler } from 'nitro/h3'

// Listed in `c8y.openapi.excludeRoutes`, so it must not show up in the OpenAPI document.
export default defineEventHandler(() => ({ hidden: true }))
