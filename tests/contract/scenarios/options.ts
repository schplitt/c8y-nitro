import { expect } from 'vitest'
import type { Client } from '@c8y/client'
import type { ContractScenario } from '../helpers'

async function api(client: Client, method: string, path: string, body?: unknown) {
  const res = await client.core.fetch(path, { method, headers: { 'content-type': 'application/json', 'accept': 'application/json' }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) })
  const text = await res.text()
  return { status: res.status, body: text ? JSON.parse(text) : undefined }
}

/**
 * Deletes the given keys of a category, whatever state the scenario ended in.
 * @param client
 * @param category
 * @param keys
 */
async function removeAll(client: Client, category: string, keys: string[]) {
  for (const key of keys) {
    await client.core.fetch(`/tenant/options/${category}/${key}`, { method: 'DELETE' }).catch(() => {})
  }
}

export const optionsScenarios: ContractScenario[] = [
  {
    name: 'tenant options: upsert, bulk set, list, delete',
    async run({ client, unique }) {
      const category = `ctr${unique}`
      const json = { 'content-type': 'application/json', 'accept': 'application/json' }
      try {
        // PUT creates a missing option (c8y-nitro's useTenantOption().set() relies on it)
        const put = await client.core.fetch(`/tenant/options/${category}/alpha`, { method: 'PUT', headers: json, body: JSON.stringify({ value: 'one' }) })
        expect(put.status).toBe(200)
        expect(await (await client.core.fetch(`/tenant/options/${category}/alpha`)).json()).toMatchObject({ category, key: 'alpha', value: 'one' })

        const bulk = await client.core.fetch(`/tenant/options/${category}`, { method: 'PUT', headers: json, body: JSON.stringify({ beta: 'two', gamma: 'three' }) })
        expect(bulk.status).toBe(200)
        expect(await (await client.core.fetch(`/tenant/options/${category}`)).json()).toEqual({ alpha: 'one', beta: 'two', gamma: 'three' })

        expect((await client.core.fetch(`/tenant/options/${category}/alpha`, { method: 'DELETE' })).status).toBe(204)
        expect((await client.core.fetch(`/tenant/options/${category}/alpha`)).status).toBe(404)
      } finally {
        await removeAll(client, category, ['alpha', 'beta', 'gamma'])
      }
    },
  },
  {
    name: 'tenant options: 404 for unknown option, self link, bulk response, update, value coercion',
    async run({ client, unique }) {
      const category = `ctr${unique}`
      const keys = ['alpha', 'beta', 'gamma', 'num', 'empty', 'a.b.c', 'long']
      try {
        // an unknown category lists as empty, an unknown option is a 404
        const unknownCategory = await api(client, 'GET', `/tenant/options/${category}`)
        expect(unknownCategory.status).toBe(200)
        expect(unknownCategory.body).toEqual({})
        const unknown = await api(client, 'GET', `/tenant/options/${category}/alpha`)
        expect(unknown.status).toBe(404)
        expect(unknown.body.error).toBe('options/Not Found')
        const unknownDelete = await api(client, 'DELETE', `/tenant/options/${category}/alpha`)
        expect(unknownDelete.status).toBe(404)
        expect(unknownDelete.body.error).toBe('options/Not Found')

        const created = await api(client, 'PUT', `/tenant/options/${category}/alpha`, { value: 'one' })
        expect(created.status).toBe(200)
        expect(created.body).toMatchObject({ category, key: 'alpha', value: 'one', self: expect.stringContaining(`/tenant/options/${category}/alpha`) })
        expect((await api(client, 'GET', `/tenant/options/${category}/alpha`)).body).toMatchObject({ category, key: 'alpha', value: 'one', self: expect.stringContaining(`/tenant/options/${category}/alpha`) })

        // PUT on an existing key replaces the value
        expect((await api(client, 'PUT', `/tenant/options/${category}/alpha`, { value: 'two' })).body.value).toBe('two')
        expect((await api(client, 'GET', `/tenant/options/${category}/alpha`)).body.value).toBe('two')

        // the bulk response only lists the keys that were sent; the category keeps the others
        const bulk = await api(client, 'PUT', `/tenant/options/${category}`, { beta: 'two', gamma: 'three' })
        expect(bulk.status).toBe(200)
        expect(bulk.body).toEqual({ beta: 'two', gamma: 'three' })
        expect((await api(client, 'GET', `/tenant/options/${category}`)).body).toEqual({ alpha: 'two', beta: 'two', gamma: 'three' })

        // values are strings: numbers are stored as text, empty and long strings stay as they are
        expect((await api(client, 'PUT', `/tenant/options/${category}/num`, { value: 5 })).body.value).toBe('5')
        expect((await api(client, 'GET', `/tenant/options/${category}/num`)).body.value).toBe('5')
        expect((await api(client, 'PUT', `/tenant/options/${category}/empty`, { value: '' })).body.value).toBe('')
        expect((await api(client, 'GET', `/tenant/options/${category}/empty`)).body.value).toBe('')
        const long = 'x'.repeat(5000)
        await api(client, 'PUT', `/tenant/options/${category}/long`, { value: long })
        expect((await api(client, 'GET', `/tenant/options/${category}/long`)).body.value).toBe(long)

        // keys may contain dots, and are case sensitive
        await api(client, 'PUT', `/tenant/options/${category}/a.b.c`, { value: 'dots' })
        expect((await api(client, 'GET', `/tenant/options/${category}/a.b.c`)).body).toMatchObject({ key: 'a.b.c', value: 'dots' })
        expect((await api(client, 'GET', `/tenant/options/${category}/A.B.C`)).status).toBe(404)
        expect((await api(client, 'GET', `/tenant/options/${category}`)).body['a.b.c']).toBe('dots')

        expect((await api(client, 'DELETE', `/tenant/options/${category}/a.b.c`)).status).toBe(204)
        expect((await api(client, 'DELETE', `/tenant/options/${category}/a.b.c`)).status).toBe(404)
        expect((await api(client, 'GET', `/tenant/options/${category}/a.b.c`)).status).toBe(404)
      } finally {
        await removeAll(client, category, keys)
      }
    },
  },
  {
    name: 'tenant options: credentials. keys are encrypted, their value is masked on read',
    async run({ client, unique }) {
      const category = `ctr${unique}`
      const keys = ['credentials.secret', 'credentials.other', 'plain']
      try {
        const stored = await api(client, 'PUT', `/tenant/options/${category}/credentials.secret`, { value: 'shh' })
        expect(stored.status).toBe(200)
        // the response never echoes the clear text
        expect(stored.body.value).not.toBe('shh')
        await api(client, 'PUT', `/tenant/options/${category}/plain`, { value: 'visible' })

        const read = await api(client, 'GET', `/tenant/options/${category}/credentials.secret`)
        expect(read.status).toBe(200)
        expect(read.body).toMatchObject({ key: 'credentials.secret', value: '<<Encrypted>>' })

        // the bulk set encrypts as well, and the category listing masks every credentials. key
        const bulk = await api(client, 'PUT', `/tenant/options/${category}`, { 'credentials.other': 'hidden' })
        expect(bulk.status).toBe(200)
        expect((await api(client, 'GET', `/tenant/options/${category}`)).body).toEqual({
          'credentials.secret': '<<Encrypted>>',
          'credentials.other': '<<Encrypted>>',
          'plain': 'visible',
        })
      } finally {
        await removeAll(client, category, keys)
      }
    },
  },
]
