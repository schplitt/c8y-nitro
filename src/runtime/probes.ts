import type { Nitro } from 'nitro/types'
import type { C8YManifestOptions } from '../types'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { HTTPGetAction } from '../types/manifest'

export const GENERATED_LIVENESS_ROUTE = '/_c8y_nitro/liveness'
export const GENERATED_READINESS_ROUTE = '/_c8y_nitro/readiness'

const probeHandler
  = `import { defineEventHandler } from 'nitro/h3'
export default defineEventHandler(async (event) => {
  return {
    status: 'OK'
  }
})`

export async function setupProbes(nitro: Nitro, manifestOptions: C8YManifestOptions = {}): Promise<void> {
  // Generate directory for probe handlers
  const probeDir = join(nitro.options.rootDir, 'node_modules', '.c8y_nitro')
  await mkdir(probeDir, { recursive: true })

  // Generate liveness probe if user hasn't defined httpGet
  if (!manifestOptions.livenessProbe?.httpGet) {
    const livenessPath = join(probeDir, 'generated_liveness_probe.ts')
    await writeFile(livenessPath, probeHandler, 'utf-8')

    nitro.options.handlers.push({
      route: GENERATED_LIVENESS_ROUTE,
      handler: livenessPath,
      method: 'GET',
    })

    nitro.logger.debug(`Generated liveness probe at ${GENERATED_LIVENESS_ROUTE}`)
  } else {
    nitro.logger.debug('Liveness probe httpGet defined by user; skipping generation')
  }

  // Generate readiness probe if user hasn't defined httpGet
  if (!manifestOptions.readinessProbe?.httpGet) {
    const readinessPath = join(probeDir, 'generated_readiness_probe.ts')
    await writeFile(readinessPath, probeHandler, 'utf-8')

    nitro.options.handlers.push({
      route: GENERATED_READINESS_ROUTE,
      handler: readinessPath,
      method: 'GET',
    })

    nitro.logger.debug(`Generated readiness probe at ${GENERATED_READINESS_ROUTE}`)
  } else {
    nitro.logger.debug('Readiness probe httpGet defined by user; skipping generation')
  }
}

export function checkProbes(nitro: Nitro, manifestOptions: C8YManifestOptions = {}) {
  // Check if livenessProbe httpGet endpoint exists
  if (manifestOptions.livenessProbe?.httpGet) {
    const probe = manifestOptions.livenessProbe.httpGet
    checkProbeEndpoint(nitro, probe, 'livenessProbe')
  }

  // Check if readinessProbe httpGet endpoint exists
  if (manifestOptions.readinessProbe?.httpGet) {
    const probe = manifestOptions.readinessProbe.httpGet
    checkProbeEndpoint(nitro, probe, 'readinessProbe')
  }
}

function checkProbeEndpoint(nitro: Nitro, probe: HTTPGetAction, probeType: string) {
  const path = probe.path
  const method = 'GET' // HTTP probes always use GET

  // Find handlers matching this route
  const matchingHandlers = nitro.scannedHandlers.filter((h) => h.route === path)

  if (matchingHandlers.length === 0) {
    nitro.logger.warn(`${probeType} route "${path}" not found in scanned handlers. The probe will fail at runtime.`)
    return
  }

  // Check if any handler accepts this method
  const hasMatchingMethod = matchingHandlers.some((h) => {
    // If handler has no method specified, it accepts all methods
    if (!h.method) {
      return true
    }
    // Compare methods case-insensitively
    return h.method.toUpperCase() === method.toUpperCase()
  })

  if (!hasMatchingMethod) {
    const availableMethods = matchingHandlers
      .filter((h) => h.method)
      .map((h) => h.method?.toUpperCase())
      .join(', ')

    nitro.logger.warn(
      `${probeType} route "${path}" exists but does not accept ${method} requests. `
      + `Available methods: ${availableMethods || 'none specified'}. The probe will fail at runtime.`,
    )
  }
}
