import { x } from 'tinyexec'
import { writeFile, mkdir } from 'node:fs/promises'
import { join, basename } from 'node:path'
import type { Nitro } from 'nitro/types'

/**
 * Generate the Dockerfile content for a Nitro build
 * @param outputDirName - Name of the output directory (e.g., '.output')
 * @returns Dockerfile content as a string
 */
export function getDockerfileContent(outputDirName: string): string {
  return `FROM node:22-slim AS runtime

WORKDIR /app

# Copy the Nitro build output
COPY ${outputDirName}/ ${outputDirName}/

ENV NODE_ENV=production
ENV PORT=80

EXPOSE 80

# Run the Nitro server entrypoint. Use source maps to aid debugging if present.
CMD ["node", "--enable-source-maps", "${outputDirName}/server/index.mjs"]`
}

async function checkDockerInstalled(): Promise<boolean> {
  try {
    const result = await x('docker', ['--version'])
    if (result.exitCode !== 0) {
      return false
    }
    if (result.stderr) {
      return false
    }
    return true
  } catch {
    return false
  }
}

async function writeDockerfile(outputDir: string): Promise<string> {
  const outputDirName = basename(outputDir)
  const c8yDir = join(outputDir, '../.c8y')
  const dockerfilePath = join(c8yDir, 'Dockerfile')

  // Create .c8y directory if it doesn't exist
  await mkdir(c8yDir, { recursive: true })

  // Generate Dockerfile with dynamic output directory name
  const dockerfileContent = getDockerfileContent(outputDirName)

  // Write Dockerfile
  await writeFile(dockerfilePath, dockerfileContent, 'utf-8')

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

    if (result.stderr) {
      nitro.logger.debug(result.stderr)
    }

    if (result.exitCode !== 0) {
      throw new Error(`Docker build failed with exit code ${result.exitCode}`, { cause: result.stderr })
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
    const result = await x('docker', [
      'save',
      '-o',
      imageTarPath,
      imageName,
    ])

    if (result.stderr) {
      nitro.logger.debug(result.stderr)
    }

    if (result.exitCode !== 0) {
      throw new Error(`Docker save failed with exit code ${result.exitCode}`, { cause: result.stderr })
    }

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

  // Write Dockerfile
  const c8yDir = await writeDockerfile(nitro.options.output.dir)

  // Build Docker image
  const imageName = await buildDockerImage(nitro, c8yDir)

  // Save Docker image to tar file
  const imageTarPath = await saveDockerImageToTar(nitro, c8yDir, imageName)

  nitro.logger.debug('Docker image creation complete.')

  return imageTarPath
}
