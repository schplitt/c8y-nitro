/**
 * A small JSON schema checker for the documented response schemas in
 * tests/contract/spec.generated.json (type, nullable, enum, required,
 * properties, items, oneOf/anyOf, date-time format, string lengths, and
 * number limits). It returns the problems found, as `path: problem` lines,
 * instead of throwing.
 */
export interface Schema {
  type?: string
  format?: string
  enum?: unknown[]
  nullable?: boolean
  required?: string[]
  minLength?: number
  maxLength?: number
  minimum?: number
  maximum?: number
  properties?: Record<string, Schema>
  items?: Schema
  additionalProperties?: boolean | Schema
  oneOf?: Schema[]
  anyOf?: Schema[]
}

export function checkSchema(value: unknown, schema: Schema, path = '$'): string[] {
  const problems: string[] = []
  if (value === null) {
    if (schema.nullable || schema.enum?.includes(null) || (schema.type === undefined && !schema.properties && !schema.oneOf && !schema.anyOf)) {
      return []
    }
    return [`${path}: null is not a ${schema.type ?? 'value of this schema'}`]
  }
  for (const key of ['oneOf', 'anyOf'] as const) {
    if (schema[key]) {
      const results = schema[key]!.map((option) => checkSchema(value, option, path))
      if (!results.some((result) => result.length === 0)) {
        problems.push(`${path}: matches none of ${key}: ${results.map((result) => result.join('; ')).join(' | ')}`)
      }
    }
  }
  if (schema.enum && !schema.enum.includes(value)) {
    problems.push(`${path}: ${JSON.stringify(value)} is not one of ${schema.enum.join(', ')}`)
  }
  const type = schema.type
  if (type === 'object' || (type === undefined && schema.properties)) {
    if (typeof value !== 'object' || Array.isArray(value)) {
      return [...problems, `${path}: expected an object, got ${JSON.stringify(value)}`]
    }
    const record = value as Record<string, unknown>
    for (const name of schema.required ?? []) {
      if (!Object.hasOwn(record, name)) {
        problems.push(`${path}.${name}: required`)
      }
    }
    for (const [name, property] of Object.entries(schema.properties ?? {})) {
      if (record[name] !== undefined) {
        problems.push(...checkSchema(record[name], property, `${path}.${name}`))
      }
    }
    if (typeof schema.additionalProperties === 'object') {
      for (const [name, item] of Object.entries(record)) {
        if (!schema.properties?.[name]) {
          problems.push(...checkSchema(item, schema.additionalProperties, `${path}.${name}`))
        }
      }
    }
  } else if (type === 'array') {
    if (!Array.isArray(value)) {
      return [...problems, `${path}: expected an array, got ${JSON.stringify(value)}`]
    }
    if (schema.items) {
      value.forEach((item, index) => problems.push(...checkSchema(item, schema.items!, `${path}[${index}]`)))
    }
  } else if (type === 'string') {
    if (typeof value !== 'string') {
      problems.push(`${path}: expected a string, got ${JSON.stringify(value)}`)
    } else if (schema.format === 'date-time' && Number.isNaN(Date.parse(value))) {
      problems.push(`${path}: ${JSON.stringify(value)} is not a date-time`)
    }
    if (typeof value === 'string' && ((schema.minLength !== undefined && value.length < schema.minLength) || (schema.maxLength !== undefined && value.length > schema.maxLength))) {
      problems.push(`${path}: length ${value.length} is outside ${schema.minLength ?? 0}..${schema.maxLength ?? '∞'}`)
    }
  } else if (type === 'integer' || type === 'number') {
    if (typeof value !== 'number' || (type === 'integer' && !Number.isInteger(value))) {
      problems.push(`${path}: expected ${type === 'integer' ? 'an integer' : 'a number'}, got ${JSON.stringify(value)}`)
    } else if ((schema.minimum !== undefined && value < schema.minimum) || (schema.maximum !== undefined && value > schema.maximum)) {
      problems.push(`${path}: ${value} is outside ${schema.minimum ?? '-∞'}..${schema.maximum ?? '∞'}`)
    }
  } else if (type === 'boolean' && typeof value !== 'boolean') {
    problems.push(`${path}: expected a boolean, got ${JSON.stringify(value)}`)
  }
  return problems
}
