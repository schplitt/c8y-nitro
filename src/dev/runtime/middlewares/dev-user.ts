import { defineHandler } from 'nitro/h3'
import process from 'node:process'
import { Buffer } from 'node:buffer'
import consola from 'consola'

export default defineHandler((event) => {
  if (import.meta.dev) {
    // in development mode, we check for a development user to inject into the request
    // this is necessary to correctly use auth middlewares during development
    const devVariables = ['C8Y_DEVELOPMENT_TENANT', 'C8Y_DEVELOPMENT_USER', 'C8Y_DEVELOPMENT_PASSWORD']
    const missingDevVars = devVariables.filter((varName) => !process.env[varName])
    if (missingDevVars.length > 0) {
      consola.warn(`Missing development environment variables: ${missingDevVars.join(', ')}. Dev user injection will be skipped. Routes requiring authentication or roles will fail.`)
    } else {
      // build basic auth header in form "tenant/user:password"
      const authString = `${process.env.C8Y_DEVELOPMENT_TENANT}/${process.env.C8Y_DEVELOPMENT_USER}:${process.env.C8Y_DEVELOPMENT_PASSWORD}`
      const encodedAuth = Buffer.from(authString).toString('base64')
      const authHeader = `Basic ${encodedAuth}`

      // inject auth header into request
      event.req.headers.set('authorization', authHeader)
      consola.info('Development user injected into request authorization header.')
    }
  }
})
