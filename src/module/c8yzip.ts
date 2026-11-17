import type { Nitro } from 'nitro/types'
import { createDockerImage } from './docker'
import { createC8yManifestFromNitro } from './manifest'
import type { C8YManifest } from '../types/manifest'
import type { C8YZipOptions } from '../types/zip'
import type { C8yDockerOptions } from '../types/docker'
import { join } from 'pathe'
import { mkdir, readFile, stat, writeFile } from 'fs/promises'
import { strToU8, zip } from 'fflate'
import yoctoSpinner from 'yocto-spinner'
import { colors } from 'consola/utils'

function formatBytes(bytes: number): string {
  if (bytes === 0)
    return '0 B'
  const k = 1024
  const sizes = ['B', 'kB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return `${(bytes / k ** i).toFixed(1)} ${sizes[i]}`
}

/**
 * Resolve the output path for the zip file based on options and manifest
 * @param rootDir - Root directory of the project
 * @param options - Zip options with optional name and outputDir
 * @param manifest - Cumulocity manifest containing name and version
 * @returns Absolute path to the output zip file
 */
export function resolveZipOutputPath(
  rootDir: string,
  options: C8YZipOptions,
  manifest: C8YManifest,
): string {
  const outputDir = join(rootDir, options.outputDir ?? './')
  const fileName = typeof options.name === 'function'
    ? options.name(manifest.name, manifest.version)
    : options.name ?? `${manifest.name}-${manifest.version}.zip`
  return join(outputDir, fileName)
}

export async function createC8yZip(nitro: Nitro, options: C8YZipOptions = {}, dockerOptions: C8yDockerOptions = {}) {
  const startTime = Date.now()
  const spinner = yoctoSpinner({ text: 'Creating Dockerfile...', color: 'green' }).start()

  try {
    // Build Docker image
    spinner.text = 'Building Docker image...'
    const imageTarPath = await createDockerImage(nitro, dockerOptions)

    spinner.text = 'Creating manifest...'
    const manifest = await createC8yManifestFromNitro(nitro)

    spinner.text = 'Reading image.tar...'
    const imageTarBuffer = await readFile(imageTarPath)

    // Create zip with both files
    spinner.text = 'Building zip file...'
    // Use balanced DEFLATE compression (level 6) as a speed/size compromise.
    // Note: image.tar usually contains already-compressed Docker layers, so size wins vary.
    const compressionLevel = options.compressionLevel ?? 6
    const zipBuffer = await new Promise<Uint8Array>((resolve, reject) => {
      zip({
        'image.tar': imageTarBuffer,
        'cumulocity.json': strToU8(JSON.stringify(manifest, null, 2)),
      }, { level: compressionLevel }, (err, data) => err ? reject(err) : resolve(data))
    })

    // Determine output path
    const outputFile = resolveZipOutputPath(nitro.options.rootDir, options, manifest)
    const outputDir = join(outputFile, '..')

    // Write zip file to disk
    spinner.text = 'Writing zip file...'
    await mkdir(outputDir, { recursive: true })
    await writeFile(outputFile, zipBuffer)

    // Get file stats for size
    const fileStats = await stat(outputFile)
    const zipSize = formatBytes(fileStats.size)

    const duration = Date.now() - startTime
    spinner.stop()
    nitro.logger.success(`Cumulocity zip built in ${duration}ms`)

    // Final outputs
    nitro.logger.log(colors.gray(`  └─ ${outputFile} (${zipSize})`))
    nitro.logger.info('Zip file can be uploaded to Cumulocity IoT platform')
  } finally {
    // A failed step must not leave the spinner running and the cursor hidden.
    // No-op when the spinner was already stopped above.
    spinner.stop()
  }
}
