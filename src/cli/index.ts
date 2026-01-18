import { defineCommand, runMain } from 'citty'
import { consola } from 'consola'
import process from 'process'
import pkgjson from '../../package.json'
import { loadConfig, loadDotenv } from 'c12'
import type { NitroConfig } from 'nitro/types'

const main = defineCommand({
  meta: {
    name: pkgjson.name,
    version: pkgjson.version,
    description: pkgjson.description,
  },
  subCommands: {
    bootstrap: () => import('./commands/bootstrap').then((r) => r.default),
  },
  async run() {
    // Default command - show config
    const cwd = process.cwd()
    consola.info(`Loading Nitro config from: ${cwd}`)

    // Load .env and .env.local files
    const envVars = await loadDotenv({
      cwd,
      fileName: ['.env', '.env.local'],
    })

    const {
      config,
      _configFile,
    } = await loadConfig<NitroConfig>({
      configFile: 'nitro.config',
      cwd,
    })

    if (!_configFile) {
      throw new Error('No nitro config file found. Please check that you have a valid nitro.config file in the current directory.')
    }

    consola.log('\nEnvironment Variables (.env, .env.local):')
    consola.log(JSON.stringify(envVars, null, 2))

    consola.log('\nLoaded Nitro configuration:')
    consola.log(JSON.stringify(config, null, 2))

    consola.log(`\nConfig file used: ${_configFile}\n`)

    consola.log('Found c8y config:')
    consola.log(JSON.stringify(config.c8y, null, 2))
  },

})

runMain(main)
