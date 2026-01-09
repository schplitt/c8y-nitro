import { x } from 'tinyexec'
import { writeFile, mkdir } from 'node:fs/promises'
import { join, basename } from 'node:path'
import type { Nitro } from 'nitro/types'

function generateDockerfileContent(outputDirName: string): string {
  return `FROM node:22-slim AS runtime

WORKDIR /app

# Copy the Nitro build output
COPY ${outputDirName}/ ${outputDirName}/

ENV NODE_ENV=production
ENV PORT=80
ENV HOST=0.0.0.0

# Run as non-root user for security
RUN addgroup --system --gid 1001 app && \\
    adduser --system --uid 1001 --ingroup app app

USER app

# Expose port 80 externally (maps to internal 3000)
EXPOSE 80

# Run the Nitro server entrypoint. Use source maps to aid debugging if present.
CMD ["node", "--enable-source-maps", "${outputDirName}/server/index.mjs"]
`
}

async function checkDockerInstalled(): Promise<boolean> {
  try {
    await x('docker', ['--version'])
    return true
  } catch {
    return false
  }
}

async function generateDockerfile(nitro: Nitro): Promise<string> {
  const outputDir = nitro.options.output.dir
  const outputDirName = basename(outputDir)
  const c8yDir = join(outputDir, '../.c8y')
  const dockerfilePath = join(c8yDir, 'Dockerfile')

  // Create .c8y directory if it doesn't exist
  await mkdir(c8yDir, { recursive: true })

  // Generate Dockerfile with dynamic output directory name
  const dockerfileContent = generateDockerfileContent(outputDirName)

  // Write Dockerfile
  await writeFile(dockerfilePath, dockerfileContent, 'utf-8')

  nitro.logger.debug(`Generated Dockerfile at ${dockerfilePath}`)
  nitro.logger.debug(`Using output directory: ${outputDirName}`)
  return c8yDir
}

async function buildDockerImage(nitro: Nitro, c8yDir: string): Promise<string> {
  const projectName = nitro.options.rootDir.split('/').pop() || 'c8y-app'
  const imageName = `${projectName}:latest`
  const buildContext = join(c8yDir, '..')

  nitro.logger.debug(`Building Docker image: ${imageName}`)
  nitro.logger.debug(`Build context: ${buildContext}`)

  try {
    const result = await x('docker', [
      'build',
      '-t',
      imageName,
      '-f',
      join(c8yDir, 'Dockerfile'),
      buildContext,
    ])

    if (result.stdout) {
      nitro.logger.debug(result.stdout)
    }

    nitro.logger.debug(`Docker image built successfully: ${imageName}`)
    return imageName
  } catch (error) {
    throw new Error('Failed to build Docker image', { cause: error })
  }
}

async function saveDockerImageToTar(nitro: Nitro, c8yDir: string, imageName: string): Promise<string> {
  const imageTarPath = join(c8yDir, 'image.tar')

  nitro.logger.debug(`Saving Docker image to ${imageTarPath}`)

  try {
    await x('docker', [
      'save',
      '-o',
      imageTarPath,
      imageName,
    ])

    nitro.logger.debug(`Docker image saved to ${imageTarPath}`)
    return imageTarPath
  } catch (error) {
    throw new Error('Failed to save Docker image to tar file', { cause: error })
  }
}

/**
 * Create a Docker image from the Nitro build output
 * @param nitro Nitro instance
 * @returns Path to the saved Docker image tar file
 */
export async function createDockerImage(nitro: Nitro): Promise<string> {
  // Check if Docker is installed
  const isDockerInstalled = await checkDockerInstalled()

  if (!isDockerInstalled) {
    throw new Error('Docker is not installed or not available in PATH. Please install Docker to build images.')
  }

  nitro.logger.debug('Creating Docker image...')

  // Generate Dockerfile
  const c8yDir = await generateDockerfile(nitro)

  // Build Docker image
  const imageName = await buildDockerImage(nitro, c8yDir)

  // Save Docker image to tar file
  const imageTarPath = await saveDockerImageToTar(nitro, c8yDir, imageName)

  nitro.logger.debug('Docker image creation complete.')

  return imageTarPath
}
