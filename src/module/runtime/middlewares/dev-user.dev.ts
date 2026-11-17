import { defineHandler } from 'nitro/h3'
import process from 'node:process'
import { Buffer } from 'node:buffer'
import consola from 'consola'

// Middleware to inject a development c8y user into the request during development mode
export default defineHandler((event) => {
  if (import.meta.dev) {
    // in development mode, we inject a development user into requests without credentials
    // this is necessary to correctly use auth middlewares during development
    // a request that sends its own authorization header (e.g. a device or a subtenant user) keeps it
    if (!event.req.headers.get('authorization')) {
      const requiredDevEnvVars = ['C8Y_DEVELOPMENT_TENANT', 'C8Y_DEVELOPMENT_USER', 'C8Y_DEVELOPMENT_PASSWORD']
      const missingDevVars = requiredDevEnvVars.filter((varName) => !process.env[varName])
      if (missingDevVars.length > 0) {
        consola.warn(`Missing development environment variables: ${missingDevVars.join(', ')}. Dev user injection will be skipped. Routes requiring authentication or roles will fail.`)
      } else {
        // build basic auth header in form "tenant/user:password"
        const authString = `${process.env.C8Y_DEVELOPMENT_TENANT}/${process.env.C8Y_DEVELOPMENT_USER}:${process.env.C8Y_DEVELOPMENT_PASSWORD}`
        const encodedAuth = Buffer.from(authString).toString('base64')
        const authHeader = `Basic ${encodedAuth}`

        // inject auth header into request
        event.req.headers.set('authorization', authHeader)
      }
    }

    // In local dev strip the entire cookie header to prevent any other local host cookies from interfering with the injected dev user credentials
    if (event.req.headers.has('cookie')) {
      event.req.headers.delete('cookie')
    }
  }
})
