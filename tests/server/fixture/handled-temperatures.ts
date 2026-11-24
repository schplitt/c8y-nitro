// The temperatures the realtime trigger (plugins/realtime-overheating.ts)
// handled, in order. A module of its own: tests import it, and importing the
// plugin would load c8y-nitro/utils before Nitro created the app.
export const handledTemperatures: number[] = []
