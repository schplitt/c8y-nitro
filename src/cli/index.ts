import { defineCommand, runMain } from 'citty'
import pkgjson from '../../package.json'

const main = defineCommand({
  meta: {
    name: pkgjson.name,
    version: pkgjson.version,
    description: pkgjson.description,
  },
  subCommands: {
    bootstrap: () => import('./commands/bootstrap').then((r) => r.default),
    roles: () => import('./commands/roles').then((r) => r.default),
  },
})

runMain(main)
