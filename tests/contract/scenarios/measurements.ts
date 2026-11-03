import { expect } from 'vitest'
import type { Client } from '@c8y/client'
import type { ContractScenario } from '../helpers'
import { eventually, rejection, time } from '../helpers'

async function call(client: Client, method: string, path: string, body?: unknown) {
  const res = await client.core.fetch(path, {
    method,
    headers: { accept: 'application/json', ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const text = await res.text()
  let json: any
  try {
    json = JSON.parse(text)
  } catch {}
  return { status: res.status, json, text }
}

const q = encodeURIComponent
const at = (hour: number, minute = 0) => new Date(Date.UTC(2026, 0, 1, hour, minute)).toISOString()
async function createTemperature(client: Client, source: string, when: string, value: number, fragment = 'c8y_T', type = fragment) {
  await client.measurement.create({ source: { id: source }, type, time: when, [fragment]: { T: { value, unit: 'C' } } } as any)
}

export const measurementsScenarios: ContractScenario[] = [
  {
    name: 'measurements: newest first, revert=false for oldest first',
    verifies: ['measurements-newest-first'],
    async run({ client, unique }) {
      const { data: device } = await client.inventory.create({ name: `m-${unique}`, c8y_IsDevice: {} })
      for (const [minute, value] of [[1, 10], [3, 30], [2, 20]] as const) {
        await client.measurement.create({ source: { id: device.id }, type: 'c8y_Temperature', time: time(minute), c8y_Temperature: { T: { value, unit: 'C' } } } as any)
      }
      const values = (data: any[]) => data.map((measurement) => measurement.c8y_Temperature.T.value)

      const { data: newestFirst } = await client.measurement.list({ source: device.id, type: 'c8y_Temperature' })
      expect(values(newestFirst)).toEqual([30, 20, 10])

      const { data: oldestFirst } = await client.measurement.list({ source: device.id, dateFrom: time(0), dateTo: time(10), revert: false, pageSize: 2 })
      expect(values(oldestFirst)).toEqual([10, 20])
    },
  },
  {
    name: 'measurements: series with aggregation, bulk delete',
    async run({ client, unique }) {
      const { data: device } = await client.inventory.create({ name: `s-${unique}`, c8y_IsDevice: {} })
      for (const [minute, value] of [[1, 10], [20, 30], [70, 50]] as const) {
        await client.measurement.create({ source: { id: device.id }, type: 'c8y_Temperature', time: time(minute), c8y_Temperature: { T: { value, unit: 'C' } } } as any)
      }
      const range = { source: device.id, dateFrom: time(0), dateTo: time(120) }

      const { data: raw } = await client.measurement.listSeries({ ...range, series: 'c8y_Temperature.T' } as any)
      expect(raw.series).toEqual([{ name: 'T', type: 'c8y_Temperature', unit: 'C' }])
      expect(Object.values(raw.values)).toEqual([[{ min: 10, max: 10 }], [{ min: 30, max: 30 }], [{ min: 50, max: 50 }]])

      const { data: hourly } = await client.measurement.listSeries({ ...range, aggregationType: 'HOURLY' } as any)
      expect(hourly.values).toEqual({
        [time(0)]: [{ min: 10, max: 30 }],
        [time(60)]: [{ min: 50, max: 50 }],
      })

      // bulk delete boundaries must be full hours
      const unaligned = await client.core.fetch(`/measurement/measurements?source=${device.id}&dateTo=${encodeURIComponent(time(30))}`, { method: 'DELETE' })
      expect(unaligned.status).toBe(422)
      const res = await client.core.fetch(`/measurement/measurements?source=${device.id}&dateTo=${encodeURIComponent(time(60))}`, { method: 'DELETE' })
      expect(res.status).toBe(204)
      await eventually(async () => {
        expect((await client.measurement.list({ source: device.id })).data).toHaveLength(1)
      })
    },
  },
  {
    name: 'measurements: collection create, value fragment filters, detail and delete, interval functions',
    verifies: ['measurement-by-id-405'],
    async run({ client, unique }) {
      const { data: device } = await client.inventory.create({ name: `m2-${unique}`, c8y_IsDevice: {} })
      const created = await client.core.fetch('/measurement/measurements', {
        method: 'POST',
        headers: { 'content-type': 'application/vnd.com.nsn.cumulocity.measurementcollection+json', 'accept': 'application/json' },
        body: JSON.stringify({
          measurements: [
            { source: { id: device.id }, type: 'c8y_Climate', time: time(1), c8y_Climate: { T: { value: 10, unit: 'C' }, H: { value: 40, unit: '%' } } },
            { source: { id: device.id }, type: 'c8y_Climate', time: time(2), c8y_Climate: { T: { value: 20, unit: 'C' } } },
            { source: { id: device.id }, type: 'c8y_Power', time: time(3), c8y_Power: { P: { value: 5, unit: 'W' } } },
          ],
        }),
      })
      expect(created.status).toBe(201)
      const { measurements } = await created.json()
      expect(measurements).toHaveLength(3)

      const types = async (filter: Record<string, unknown>) => (await client.measurement.list({ source: device.id, pageSize: 100, ...filter } as any)).data.map((item: any) => item.type).sort()
      expect(await types({ valueFragmentType: 'c8y_Climate' })).toEqual(['c8y_Climate', 'c8y_Climate'])
      expect(await types({ valueFragmentType: 'c8y_Climate', valueFragmentSeries: 'H' })).toEqual(['c8y_Climate'])

      // time series persistence: single measurements cannot be read, but deleted
      expect((await rejection(client.measurement.detail(measurements[2].id))).res.status).toBe(405)
      await client.measurement.delete(measurements[2].id)
      await eventually(async () => {
        expect(await types({})).toEqual(['c8y_Climate', 'c8y_Climate'])
      })

      const series = await (await client.core.fetch(`/measurement/measurements/series?source=${device.id}&dateFrom=${encodeURIComponent(time(0))}&dateTo=${encodeURIComponent(time(60))}&series=c8y_Climate.T&aggregationInterval=1h&aggregationFunction=avg&aggregationFunction=count`)).json()
      expect(Object.values(series.values)).toEqual([[{ avg: 15, count: 2 }]])

      const invalid = await client.core.fetch(`/measurement/measurements/series?source=${device.id}&dateFrom=${encodeURIComponent(time(0))}&dateTo=${encodeURIComponent(time(60))}&aggregationFunction=avg`)
      // the platform answers 422 (the docs say 400)
      expect(invalid.status).toBe(422)
    },
  },
  {
    name: 'measurements: validation and error responses',
    verifies: ['measurement-by-id-405', 'time-unparsable-400', 'date-parameters-lenient'],
    async run({ client, unique }) {
      const { data: device } = await client.inventory.create({ name: `mv-${unique}`, c8y_IsDevice: {} })
      const post = (body: unknown) => call(client, 'POST', '/measurement/measurements', body)
      const source = { id: device.id }

      for (const field of ['source', 'type', 'time']) {
        const body: Record<string, unknown> = { source, type: 'c8y_T', time: time(1) }
        delete body[field]
        const res = await post(body)
        expect(res.status, field).toBe(422)
        expect(res.json.error).toBe('undefined/validationError')
        expect(res.json.message).toContain(field)
      }

      const unknownSource = await post({ source: { id: '999999999999' }, type: 'c8y_T', time: time(1) })
      expect(unknownSource.status).toBe(422)
      expect(unknownSource.json.error).toBe('measurement/Unprocessable Entity')

      const badTime = await post({ source, type: 'c8y_T', time: 'not a date' })
      expect(badTime.status).toBe(400)

      // time series persistence: single measurements cannot be read
      expect((await call(client, 'GET', '/measurement/measurements/999999999999')).status).toBe(405)
      const missing = await call(client, 'DELETE', '/measurement/measurements/999999999999')
      expect(missing.status).toBe(404)
      expect(missing.json.error).toBe('measurement/Not Found')

      const badDate = await call(client, 'GET', `/measurement/measurements?source=${device.id}&dateFrom=foo`)
      expect(badDate.status).toBe(422)
      const badDelete = await call(client, 'DELETE', `/measurement/measurements?source=${device.id}&dateFrom=foo`)
      expect(badDelete.status).toBe(422)
    },
  },
  {
    name: 'measurements: paging, totals, date range boundaries, revert',
    async run({ client, unique }) {
      const { data: device } = await client.inventory.create({ name: `mp-${unique}`, c8y_IsDevice: {} })
      for (let minute = 0; minute < 7; minute++) {
        await createTemperature(client, device.id, time(minute), minute)
      }
      const list = async (params: string) => (await call(client, 'GET', `/measurement/measurements?source=${device.id}&${params}`)).json
      const minutes = (page: any) => page.measurements.map((measurement: any) => new Date(measurement.time).getUTCMinutes())

      await eventually(async () => {
        const page = await list('pageSize=2&currentPage=2&withTotalElements=true&withTotalPages=true')
        expect(minutes(page)).toEqual([4, 3])
        expect(page.statistics).toEqual({ pageSize: 2, currentPage: 2, totalElements: 7, totalPages: 4 })
        expect(page.prev).toBeDefined()
        expect(page.next).toBeDefined()
      })
      // totals are only counted on request
      const plain = await list('pageSize=2')
      expect(plain.statistics).toEqual({ pageSize: 2, currentPage: 1 })
      expect(minutes(plain)).toEqual([6, 5])
      // revert=false only gives oldest first together with a date range
      expect(minutes(await list('pageSize=2&currentPage=2&revert=false'))).toEqual([4, 3])
      expect(minutes(await list(`dateFrom=${q(time(0))}&dateTo=${q(time(10))}&pageSize=2&currentPage=2&revert=false`))).toEqual([2, 3])
      expect(minutes(await list('pageSize=2&currentPage=50&withTotalElements=true'))).toEqual([])

      // dateFrom is inclusive, dateTo exclusive
      expect(minutes(await list(`dateFrom=${q(time(1))}&dateTo=${q(time(4))}&revert=false`))).toEqual([1, 2, 3])
      expect(minutes(await list(`dateFrom=${q(time(5))}`))).toEqual([6, 5])
      expect(minutes(await list(`dateTo=${q(time(2))}&revert=false`))).toEqual([0, 1])
      // an empty or reversed range matches nothing, except equal bounds which include that instant
      expect(minutes(await list(`dateFrom=${q(time(3))}&dateTo=${q(time(3))}`))).toEqual([3])
      expect(minutes(await list(`dateFrom=${q(time(4))}&dateTo=${q(time(2))}`))).toEqual([])
      // revert=true keeps newest first (the default)
      expect(minutes(await list(`dateFrom=${q(time(1))}&dateTo=${q(time(4))}&revert=true`))).toEqual([3, 2, 1])
    },
  },
  {
    name: 'measurements: bulk delete filters (type, fragmentType, dateFrom, dateTo)',
    async run({ client, unique, settle }) {
      const { data: device } = await client.inventory.create({ name: `md-${unique}`, c8y_IsDevice: {} })
      await createTemperature(client, device.id, at(9, 0), 1)
      await createTemperature(client, device.id, at(9, 30), 2)
      await createTemperature(client, device.id, at(10, 0), 3)
      await createTemperature(client, device.id, at(10, 30), 4, 'c8y_Other')
      await createTemperature(client, device.id, at(11, 0), 5)
      await createTemperature(client, device.id, at(12, 0), 6)
      const remaining = async () => (await call(client, 'GET', `/measurement/measurements?source=${device.id}&pageSize=100&dateFrom=${q(at(0))}&dateTo=${q(at(23))}&revert=false`)).json.measurements.map((m: any) => `${new Date(m.time).getUTCHours()}:${String(new Date(m.time).getUTCMinutes()).padStart(2, '0')}`)
      const del = async (params: string) => {
        const res = await client.core.fetch(`/measurement/measurements?source=${device.id}&${params}`, { method: 'DELETE' })
        expect(res.status).toBe(204)
      }
      await eventually(async () => {
        expect(await remaining()).toHaveLength(6)
      })

      // filters combine: nothing matches both, so nothing is deleted
      await del(`fragmentType=c8y_Nope`)
      await del(`dateFrom=${q(at(12, 0))}&fragmentType=c8y_Other`)
      await del(`dateFrom=${q(at(13, 0))}`)
      await settle(1500)
      expect(await remaining()).toHaveLength(6)

      // dateFrom inclusive, dateTo exclusive
      await del(`dateFrom=${q(at(11, 0))}&dateTo=${q(at(12, 0))}`)
      await eventually(async () => {
        expect(await remaining()).toEqual(['9:00', '9:30', '10:00', '10:30', '12:00'])
      })

      // equal bounds delete the whole hour
      await del(`dateFrom=${q(at(9, 0))}&dateTo=${q(at(9, 0))}`)
      await eventually(async () => {
        expect(await remaining()).toEqual(['10:00', '10:30', '12:00'])
      })

      await del('type=c8y_Other&fragmentType=c8y_Other')
      await eventually(async () => {
        expect(await remaining()).toEqual(['10:00', '12:00'])
      })

      await del(`dateTo=${q(at(10, 0))}`)
      await settle(1500)
      expect(await remaining()).toEqual(['10:00', '12:00'])

      await del(`dateFrom=${q(at(12, 0))}`)
      await eventually(async () => {
        expect(await remaining()).toEqual(['10:00'])
      })
      await del('type=c8y_T')
      await eventually(async () => {
        expect(await remaining()).toEqual([])
      })
    },
  },
  {
    name: 'measurements: series with several series, intervals and functions',
    async run({ client, unique }) {
      const { data: device } = await client.inventory.create({ name: `ms-${unique}`, c8y_IsDevice: {} })
      for (let minute = 0; minute < 6; minute++) {
        await createTemperature(client, device.id, time(minute), minute + 1)
      }
      await client.measurement.create({ source: { id: device.id }, type: 'c8y_Other', time: time(2), c8y_Other: { X: { value: 7, unit: 'W' } } } as any)
      const series = async (params: string) => {
        const res = await call(client, 'GET', `/measurement/measurements/series?source=${device.id}&dateFrom=${q(time(0))}&dateTo=${q(time(10))}&${params}`)
        return { status: res.status, ...res.json }
      }
      await eventually(async () => {
        expect(Object.keys((await series('series=c8y_T.T')).values)).toHaveLength(6)
      })

      // several series: positions follow the series list, missing values are null
      const several = await series('series=c8y_T.T&series=c8y_Other.X')
      expect(several.series).toEqual([{ name: 'T', type: 'c8y_T', unit: 'C' }, { name: 'X', type: 'c8y_Other', unit: 'W' }])
      expect(several.truncated).toBe(false)
      expect(Object.keys(several.values)).toEqual([0, 1, 2, 3, 4, 5].map(time))
      expect(several.values[time(0)]).toEqual([{ min: 1, max: 1 }, null])
      expect(several.values[time(2)]).toEqual([{ min: 3, max: 3 }, { min: 7, max: 7 }])
      // without a series filter all numeric series are returned
      expect((await series('')).series.map((item: any) => `${item.type}.${item.name}`).sort()).toEqual(['c8y_Other.X', 'c8y_T.T'])

      // revert has no effect, values are always oldest first
      expect(Object.keys((await series('series=c8y_T.T&revert=true')).values)).toEqual([0, 1, 2, 3, 4, 5].map(time))

      // unknown series are left out, a period without data is empty
      expect((await series('series=c8y_T.T&series=c8y_Nope.Z')).series).toHaveLength(1)
      expect(await series('series=c8y_Nope.Z')).toMatchObject({ values: {}, series: [], truncated: false })
      const empty = await call(client, 'GET', `/measurement/measurements/series?source=${device.id}&dateFrom=${q(at(20))}&dateTo=${q(at(21))}`)
      expect(empty.json).toMatchObject({ values: {}, series: [] })

      // dateFrom inclusive, dateTo exclusive
      const range = async (from: string, to: string) => Object.keys((await call(client, 'GET', `/measurement/measurements/series?source=${device.id}&series=c8y_T.T&dateFrom=${q(from)}&dateTo=${q(to)}`)).json.values)
      expect(await range(time(0), time(2))).toEqual([time(0), time(1)])
      expect(await range(time(2), time(2))).toEqual([time(2)])

      // every aggregation function, 2 minute buckets
      const all = await series('series=c8y_T.T&aggregationInterval=2m&aggregationFunction=min&aggregationFunction=max&aggregationFunction=avg&aggregationFunction=sum&aggregationFunction=count&aggregationFunction=stdDevPop&aggregationFunction=stdDevSamp')
      expect(Object.keys(all.values)).toEqual([time(0), time(2), time(4)])
      expect(all.values[time(0)]).toEqual([{ min: 1, max: 2, avg: 1.5, sum: 3, count: 2, stdDevPop: 0.5, stdDevSamp: Math.sqrt(0.5) }])
      expect(all.values[time(4)]).toEqual([{ min: 5, max: 6, avg: 5.5, sum: 11, count: 2, stdDevPop: 0.5, stdDevSamp: Math.sqrt(0.5) }])

      // aggregationType: MINUTELY, HOURLY (the default functions are min and max), DAILY
      expect(Object.keys((await series('aggregationType=MINUTELY')).values)).toEqual([0, 1, 2, 3, 4, 5].map(time))
      expect((await series('aggregationType=HOURLY&aggregationFunction=min')).values).toEqual({ [at(10)]: [{ min: 1 }, { min: 7 }] })
      expect((await series('aggregationType=DAILY')).values).toEqual({ [at(0)]: [{ min: 1, max: 6 }, { min: 7, max: 7 }] })
      // intervals in days
      expect((await series('aggregationInterval=1d&aggregationFunction=avg')).values).toEqual({ [at(0)]: [{ avg: 3.5 }, { avg: 7 }] })
      // buckets without values of a series: sum is 0, not null
      expect((await series('aggregationInterval=1m&aggregationFunction=sum')).values[time(0)]).toEqual([{ sum: 1 }, { sum: 0 }])
    },
  },
  {
    name: 'measurements: series validation',
    verifies: ['series-validation-statuses'],
    async run({ client, unique }) {
      const { data: device } = await client.inventory.create({ name: `mq-${unique}`, c8y_IsDevice: {} })
      const base = `/measurement/measurements/series?source=${device.id}&dateFrom=${q(time(0))}&dateTo=${q(time(10))}`
      const missingTo = await call(client, 'GET', `/measurement/measurements/series?source=${device.id}&dateFrom=${q(time(0))}`)
      expect(missingTo.status).toBe(400)
      expect(missingTo.json.error).toBe('measurement/Bad Request')
      const interval = await call(client, 'GET', `${base}&aggregationInterval=5x&aggregationFunction=min`)
      expect(interval.status).toBe(422)
      expect(interval.json.message).toContain('Invalid aggregation interval')
      const type = await call(client, 'GET', `${base}&aggregationType=WEEKLY`)
      expect(type.status).toBe(400)
      expect(type.json.message).toContain('HOURLY, DAILY, MINUTELY')
      const fn = await call(client, 'GET', `${base}&aggregationInterval=1h&aggregationFunction=bogus`)
      expect(fn.status).toBe(400)
      expect(fn.json.message).toContain('min, max, avg, sum, count, stdDevPop, stdDevSamp')
    },
  },
]

export const measurementsConformanceScenarios: ContractScenario[] = [
  {
    name: 'measurements: series entries of a series without a value (null, count-only buckets)',
    verifies: ['series-missing-entries'],
    async run({ client, unique }) {
      const { data: device } = await client.inventory.create({ name: `sn-${unique}`, c8y_IsDevice: {} })
      const measurement = (minute: number, fragments: Record<string, unknown>) => ({ source: { id: device.id }, type: `sn-${unique}`, time: time(minute), ...fragments })
      await client.measurement.create(measurement(0, { c8y_Temperature: { T: { value: 21.5, unit: 'C' } } }))
      await client.measurement.create(measurement(1, { c8y_Temperature: { T: { value: 22.5, unit: 'C' } }, c8y_Humidity: { H: { value: 50, unit: '%' } } }))
      await client.measurement.create(measurement(2, { c8y_Humidity: { H: { value: 55, unit: '%' } } }))
      const base = `/measurement/measurements/series?source=${device.id}&dateFrom=${q(time(0))}&dateTo=${q(time(10))}&series=c8y_Temperature.T&series=c8y_Humidity.H`
      // the order of `series` varies on the platform: read entries by series name
      const entries = (json: any) => {
        const index = (name: string) => json.series.findIndex((item: { name: string }) => item.name === name)
        return Object.fromEntries(Object.entries(json.values).map(([at, values]: [string, any]) => [at, { T: values[index('T')], H: values[index('H')] }]))
      }
      // without aggregation, a series without a value at that time is null
      const plain = entries((await call(client, 'GET', base)).json)
      expect(plain[time(0)]).toEqual({ T: { min: 21.5, max: 21.5 }, H: null })
      expect(plain[time(1)]).toEqual({ T: { min: 22.5, max: 22.5 }, H: { min: 50, max: 50 } })
      expect(plain[time(2)]).toEqual({ T: null, H: { min: 55, max: 55 } })
      // with aggregation functions, an empty bucket keeps only the functions that have a value
      const aggregated = entries((await call(client, 'GET', `${base}&aggregationInterval=1m&aggregationFunction=avg&aggregationFunction=count`)).json)
      expect(aggregated[time(0)]).toEqual({ T: { avg: 21.5, count: 1 }, H: { count: 0 } })
      expect(aggregated[time(2)]).toEqual({ T: { count: 0 }, H: { avg: 55, count: 1 } })
      const minMax = entries((await call(client, 'GET', `${base}&aggregationInterval=1m&aggregationFunction=min&aggregationFunction=max`)).json)
      expect(minMax[time(0)]).toEqual({ T: { min: 21.5, max: 21.5 }, H: null })
    },
  },
]
