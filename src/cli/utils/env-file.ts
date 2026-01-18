import { readFile, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Writes or updates environment variables in a file.
 * Existing variables are overwritten, new ones are appended.
 * @param filePath - Absolute path to the .env file
 * @param variables - Key-value pairs to write
 */
export async function writeEnvVariables(
  filePath: string,
  variables: Record<string, string>,
): Promise<void> {
  let content = ''

  // Read existing file if it exists
  if (existsSync(filePath)) {
    content = await readFile(filePath, 'utf-8')
  }

  const lines = content.split('\n')
  const variableNames = Object.keys(variables)
  const foundVariables = new Set<string>()

  // Update existing variables
  const updatedLines = lines.map((line) => {
    for (const varName of variableNames) {
      // Match VAR_NAME= at start of line (with optional spaces around =)
      const regex = new RegExp(`^${varName}\\s*=`)
      if (regex.test(line)) {
        foundVariables.add(varName)
        return `${varName}=${variables[varName]}`
      }
    }
    return line
  })

  // Append missing variables
  const missingVariables = variableNames.filter((v) => !foundVariables.has(v))
  if (missingVariables.length > 0) {
    // Ensure there's a newline before appending if file doesn't end with one
    const lastLine = updatedLines[updatedLines.length - 1]
    if (lastLine !== '' && updatedLines.length > 0) {
      updatedLines.push('')
    }

    for (const varName of missingVariables) {
      updatedLines.push(`${varName}=${variables[varName]}`)
    }
  }

  // Join and write
  let finalContent = updatedLines.join('\n')

  // Ensure file ends with newline
  if (!finalContent.endsWith('\n')) {
    finalContent += '\n'
  }

  await writeFile(filePath, finalContent, 'utf-8')
}

/**
 * Determines which .env file to write to and writes the variables.
 * Priority: .env.local (if exists) > .env (if exists) > create .env
 * @param configDir - Directory containing the config files
 * @param variables - Key-value pairs to write
 * @returns The filename that was written to (e.g., '.env.local' or '.env')
 */
export async function writeBootstrapCredentials(
  configDir: string,
  variables: Record<string, string>,
): Promise<string> {
  const envLocalPath = join(configDir, '.env.local')
  const envPath = join(configDir, '.env')

  let targetPath: string
  let targetName: string

  if (existsSync(envLocalPath)) {
    targetPath = envLocalPath
    targetName = '.env.local'
  } else if (existsSync(envPath)) {
    targetPath = envPath
    targetName = '.env'
  } else {
    // Create .env if neither exists
    targetPath = envPath
    targetName = '.env'
  }

  await writeEnvVariables(targetPath, variables)

  return targetName
}
