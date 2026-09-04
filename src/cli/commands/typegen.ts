import { defineCommand } from 'citty'
import { consola } from 'consola'
import { resolve } from 'pathe'
import process from 'node:process'
import { createNitro } from 'nitro/builder'
import { writeAPIClient } from '../../module/apiClient'
import { C8Y_NITRO_TYPES_DIR, C8Y_NITRO_TYPES_FILE } from '../../module/constants'

export default defineCommand({
  meta: {
    name: 'typegen',
    description: 'Generate the c8y-nitro type declarations (replaces the removed `nitro prepare`)',
  },
  args: {
    dir: {
      type: 'positional',
      description: 'Project root directory',
      required: false,
      default: '.',
    },
  },
  async run({ args }) {
    const rootDir = resolve(process.cwd(), args.dir)

    // `createNitro()` runs every module's `setup()`, and c8y-nitro writes its
    // declarations from there — so instantiating is enough, no build required.
    // Handlers are scanned right after the modules install, so routes are
    // available once this resolves.
    //
    // Deliberately not calling `nitro.close()`: the module's `close` hook builds
    // the Docker image and zip for non-dev presets, which is not what typegen is.
    const nitro = await createNitro({ rootDir })

    consola.success(`Generated types at ${C8Y_NITRO_TYPES_DIR}/${C8Y_NITRO_TYPES_FILE}`)

    // Routes are scanned right after the modules install, so the client sees the
    // user's handlers. The module's own handlers (probes, OpenAPI) are registered
    // in `build:before` and are therefore absent here — which is what a UI-facing
    // client wants anyway.
    const c8yOptions = nitro.options.c8y ?? {}
    if (c8yOptions.apiClient) {
      // Logs its own success line including the resolved output path.
      await writeAPIClient(nitro, c8yOptions)
    }

    consola.info(
      `Add "${C8Y_NITRO_TYPES_DIR}/*.d.ts" to your tsconfig \`include\` if you have not already.`,
    )
  },
})
