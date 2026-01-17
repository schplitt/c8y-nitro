import type { Nitro } from 'nitro/types'
import type { C8YManifestOptions } from '../types'

type HTTPGetAction = NonNullable<NonNullable<C8YManifestOptions['livenessProbe']>['httpGet']>

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
