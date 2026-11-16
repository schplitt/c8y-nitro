import { defineEventHandler } from 'nitro/h3'
import { currentInstance } from '../plugins/instance-counter'

// The number of the service instance that answers.
export default defineEventHandler(() => ({ instance: currentInstance() }))
