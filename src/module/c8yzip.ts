import type { Nitro } from 'nitro/types'
import { createDockerImage } from './docker'
import { createC8yManifestFromNitro } from './manifest'
import type { C8YManifest } from '../types/manifest'
import type { C8YZipOptions } from '../types/zip'
import { join } from 'pathe'
import { mkdir, readFile, stat, writeFile } from 'fs/promises'
import JSZip from 'jszip'
import Spinnies from 'spinnies'
import { colors } from 'consola/utils'

const spinnies = new Spinnies()

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

export async function createC8yZip(nitro: Nitro, options: C8YZipOptions = {}) {
  const startTime = Date.now()
  const spinnerName = 'c8y-zip'

  spinnies.add(spinnerName, { text: 'Creating Dockerfile...' })

  // Build Docker image
  spinnies.update(spinnerName, { text: 'Building Docker image...' })
  const imageTarPath = await createDockerImage(nitro)

  spinnies.update(spinnerName, { text: 'Creating manifest...' })
  const manifest = await createC8yManifestFromNitro(nitro)

  spinnies.update(spinnerName, { text: 'Reading image.tar...' })
  const imageTarBuffer = await readFile(imageTarPath)

  // Create zip with both files
  spinnies.update(spinnerName, { text: 'Building zip file...' })
  const zip = new JSZip()
  zip.file('image.tar', imageTarBuffer)
  zip.file('cumulocity.json', JSON.stringify(manifest, null, 2))

  // Generate zip buffer without compression (tar already contains compressed layers)
  const zipBuffer = await zip.generateAsync({
    type: 'nodebuffer',
    compression: 'STORE', // No compression for speed - Docker layers already compressed
  })

  // Determine output path
  const outputFile = resolveZipOutputPath(nitro.options.rootDir, options, manifest)
  const outputDir = join(outputFile, '..')

  // Write zip file to disk
  spinnies.update(spinnerName, { text: 'Writing zip file...' })
  await mkdir(outputDir, { recursive: true })
  await writeFile(outputFile, zipBuffer)

  // Get file stats for size
  const fileStats = await stat(outputFile)
  const zipSize = formatBytes(fileStats.size)

  const duration = Date.now() - startTime
  spinnies.remove(spinnerName)
  spinnies.stopAll()
  nitro.logger.success(`Cumulocity zip built in ${duration}ms`)

  // Final outputs
  nitro.logger.log(colors.gray(`  └─ ${outputFile} (${zipSize})`))
  nitro.logger.info('Zip file can be uploaded to Cumulocity IoT platform')
}
