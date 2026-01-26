import { describe, expect, it } from 'vitest'
import type { HTTPMethod } from 'nitro/deps/h3'
import {
  generateFunctionName,
  extractParams,
  capitalize,
  toValidClassName,
  generateMethod,
  generateAPIClient,
} from '../src/module/apiClient'

describe('apiClient generation', () => {
  describe('generateFunctionName', () => {
    it('should generate function name for GET /health', () => {
      expect(generateFunctionName('/health', 'GET' as HTTPMethod)).toBe('GETHealth')
    })

    it('should generate function name for POST /health', () => {
      expect(generateFunctionName('/health', 'POST' as HTTPMethod)).toBe('POSTHealth')
    })

    it('should generate function name for default method', () => {
      expect(generateFunctionName('/someRoute', 'GET' as HTTPMethod)).toBe('GETSomeRoute')
    })

    it('should generate function name with route parameter', () => {
      expect(generateFunctionName('/[id]', 'GET' as HTTPMethod)).toBe('GETById')
    })

    it('should generate function name for nested route with parameters', () => {
      expect(generateFunctionName('/api/[multiple]/[params]', 'GET' as HTTPMethod)).toBe('GETApiByMultipleByParams')
    })

    it('should generate function name for PUT method', () => {
      expect(generateFunctionName('/users/[id]', 'PUT' as HTTPMethod)).toBe('PUTUsersById')
    })

    it('should generate function name for DELETE method', () => {
      expect(generateFunctionName('/items/[itemId]', 'DELETE' as HTTPMethod)).toBe('DELETEItemsByItemId')
    })

    it('should handle root path', () => {
      expect(generateFunctionName('/', 'GET' as HTTPMethod)).toBe('GETIndex')
    })

    it('should handle complex nested paths', () => {
      expect(generateFunctionName('/api/users/[userId]/posts/[postId]', 'GET' as HTTPMethod)).toBe('GETApiUsersByUserIdPostsByPostId')
    })
  })

  describe('extractParams', () => {
    it('should extract no parameters from simple path', () => {
      expect(extractParams('/health')).toEqual([])
    })

    it('should extract single parameter', () => {
      expect(extractParams('/[id]')).toEqual([
        'id',
      ])
    })

    it('should extract multiple parameters', () => {
      expect(extractParams('/api/[multiple]/[params]')).toEqual([
        'multiple',
        'params',
      ])
    })

    it('should extract parameters from complex path', () => {
      expect(extractParams('/api/users/[userId]/posts/[postId]/comments')).toEqual([
        'userId',
        'postId',
      ])
    })
  })

  describe('capitalize', () => {
    it('should capitalize first letter', () => {
      expect(capitalize('hello')).toBe('Hello')
    })

    it('should handle already capitalized', () => {
      expect(capitalize('World')).toBe('World')
    })

    it('should handle single character', () => {
      expect(capitalize('a')).toBe('A')
    })

    it('should handle empty string', () => {
      expect(capitalize('')).toBe('')
    })
  })

  describe('toValidClassName', () => {
    it('should convert kebab-case to PascalCase with Generated prefix', () => {
      expect(toValidClassName('my-service-api')).toBe('GeneratedMyServiceApi')
    })

    it('should convert snake_case to PascalCase with Generated prefix', () => {
      expect(toValidClassName('my_service_api')).toBe('GeneratedMyServiceApi')
    })

    it('should handle dots as separators with Generated prefix', () => {
      expect(toValidClassName('my.service.api')).toBe('GeneratedMyServiceApi')
    })

    it('should remove invalid characters', () => {
      expect(toValidClassName('special@chars!#%')).toBe('GeneratedSpecialchars')
    })

    it('should handle the JSDoc example case', () => {
      expect(toValidClassName('special@chars!APIClient')).toBe('GeneratedSpecialcharsAPIClient')
    })

    it('should handle names starting with numbers', () => {
      expect(toValidClassName('123-invalid')).toBe('Generated123Invalid')
    })

    it('should handle already PascalCase', () => {
      expect(toValidClassName('MyServiceAPI')).toBe('GeneratedMyServiceAPI')
    })

    it('should handle mixed separators', () => {
      expect(toValidClassName('my-service_api.client')).toBe('GeneratedMyServiceApiClient')
    })

    it('should preserve $ in names', () => {
      expect(toValidClassName('my$service')).toBe('GeneratedMy$service')
    })

    it('should handle empty or invalid input', () => {
      expect(toValidClassName('!!!')).toBe('Generated')
      expect(toValidClassName('')).toBe('Generated')
    })

    it('should remove file extensions', () => {
      expect(toValidClassName('myService.ts')).toBe('GeneratedMyService')
      expect(toValidClassName('api-client.service.ts')).toBe('GeneratedApiClientService')
    })
  })

  describe('generateMethod', () => {
    it('should generate method without parameters', () => {
      const route = {
        path: '/health',
        method: 'GET' as HTTPMethod,
        functionName: 'GETHealth',
        params: [],
        returnType: 'string',
      }
      const result = generateMethod(route)
      expect(result).toMatchInlineSnapshot(`
        "  async GETHealth(): Promise<string> {
            const response = await this.fetchClient.fetch(\`\${this.BASE_PATH}/health\`, { method: 'GET', headers: { 'Content-Type': 'application/json' } });
            return response.json();
          }"
      `)
    })

    it('should generate method with POST method', () => {
      const route = {
        path: '/health',
        method: 'POST' as HTTPMethod,
        functionName: 'POSTHealth',
        params: [],
        returnType: 'string',
      }
      const result = generateMethod(route)
      expect(result).toMatchInlineSnapshot(`
        "  async POSTHealth(): Promise<string> {
            const response = await this.fetchClient.fetch(\`\${this.BASE_PATH}/health\`, { method: 'POST', headers: { 'Content-Type': 'application/json' } });
            return response.json();
          }"
      `)
    })

    it('should generate method with single parameter and inline type', () => {
      const route = {
        path: '/[id]',
        method: 'GET' as HTTPMethod,
        functionName: 'GETById',
        params: ['id'],
        returnType: 'string',
      }
      const result = generateMethod(route)
      expect(result).toMatchInlineSnapshot(`
        "  async GETById(params: { id: string | number }): Promise<string> {
            const response = await this.fetchClient.fetch(\`\${this.BASE_PATH}/\${params.id}\`, { method: 'GET', headers: { 'Content-Type': 'application/json' } });
            return response.json();
          }"
      `)
    })

    it('should generate method with multiple parameters and inline type', () => {
      const route = {
        path: '/api/[multiple]/[params]',
        method: 'GET' as HTTPMethod,
        functionName: 'GETApiByMultipleByParams',
        params: [
          'multiple',
          'params',
        ],
        returnType: 'string',
      }
      const result = generateMethod(route)
      expect(result).toMatchInlineSnapshot(`
        "  async GETApiByMultipleByParams(params: { multiple: string | number; params: string | number }): Promise<string> {
            const response = await this.fetchClient.fetch(\`\${this.BASE_PATH}/api/\${params.multiple}/\${params.params}\`, { method: 'GET', headers: { 'Content-Type': 'application/json' } });
            return response.json();
          }"
      `)
    })

    it('should generate PUT method with parameters', () => {
      const route = {
        path: '/users/[id]',
        method: 'PUT' as HTTPMethod,
        functionName: 'PUTUsersById',
        params: ['id'],
        returnType: '{ success: boolean }',
      }
      const result = generateMethod(route)
      expect(result).toMatchInlineSnapshot(`
        "  async PUTUsersById(params: { id: string | number }): Promise<{ success: boolean }> {
            const response = await this.fetchClient.fetch(\`\${this.BASE_PATH}/users/\${params.id}\`, { method: 'PUT', headers: { 'Content-Type': 'application/json' } });
            return response.json();
          }"
      `)
    })
  })

  describe('generateAPIClient', () => {
    it('should generate Angular service with multiple routes', () => {
      const routes = [
        {
          path: '/health',
          method: 'GET' as HTTPMethod,
          functionName: 'GETHealth',
          params: [],
          returnType: 'string',
        },
        {
          path: '/health',
          method: 'POST' as HTTPMethod,
          functionName: 'POSTHealth',
          params: [],
          returnType: 'string',
        },
        {
          path: '/[id]',
          method: 'GET' as HTTPMethod,
          functionName: 'GETById',
          params: ['id'],
          returnType: 'string',
        },
      ]
      const result = generateAPIClient(routes, 'my-service', 'GeneratedMyService')

      expect(result).toMatchInlineSnapshot(`
        "/**
         * Auto-generated Cumulocity API Client
         * Generated by c8y-nitro
         *
         * This Angular service provides typed methods for all Nitro routes.
         * Each method corresponds to a route handler and returns properly typed responses.
         */
        import { Injectable, inject } from '@angular/core'
        import { FetchClient } from '@c8y/ngx-components'

        // Type helpers for proper serialization
        type JsonPrimitive = string | number | boolean | string | number | boolean | null;
        type NonJsonPrimitive = undefined | Function | symbol;
        type IsAny<T> = 0 extends 1 & T ? true : false;
        type FilterKeys<TObj extends object, TFilter> = { [TKey in keyof TObj]: TObj[TKey] extends TFilter ? TKey : never }[keyof TObj];
        type Serialize<T> = IsAny<T> extends true ? any : T extends JsonPrimitive | undefined ? T : T extends Map<any, any> | Set<any> ? Record<string, never> : T extends NonJsonPrimitive ? never : T extends {
          toJSON: () => infer U;
        } ? U : T extends [] ? [] : T extends [unknown, ...unknown[]] ? SerializeTuple<T> : T extends ReadonlyArray<infer U> ? (U extends NonJsonPrimitive ? null : Serialize<U>)[] : T extends object ? SerializeObject<T> : never;
        type SerializeTuple<T extends [unknown, ...unknown[]]> = { [k in keyof T]: T[k] extends NonJsonPrimitive ? null : Serialize<T[k]> };
        type SerializeObject<T extends object> = { [k in keyof Omit<T, FilterKeys<T, NonJsonPrimitive>>]: Serialize<T[k]> };
        type Simplify<TType> = TType extends any[] | Date ? TType : { [K in keyof TType]: Simplify<TType[K]> };
        type Awaited<T> = T extends PromiseLike<infer U> ? Awaited<U> : T;


        @Injectable({ providedIn: 'root' })
        export class GeneratedMyService {
          private readonly BASE_PATH = '/service/my-service';
          private readonly fetchClient: FetchClient = inject(FetchClient)

          constructor() {}

          async GETHealth(): Promise<string> {
            const response = await this.fetchClient.fetch(\`\${this.BASE_PATH}/health\`, { method: 'GET', headers: { 'Content-Type': 'application/json' } });
            return response.json();
          }

          async POSTHealth(): Promise<string> {
            const response = await this.fetchClient.fetch(\`\${this.BASE_PATH}/health\`, { method: 'POST', headers: { 'Content-Type': 'application/json' } });
            return response.json();
          }

          async GETById(params: { id: string | number }): Promise<string> {
            const response = await this.fetchClient.fetch(\`\${this.BASE_PATH}/\${params.id}\`, { method: 'GET', headers: { 'Content-Type': 'application/json' } });
            return response.json();
          }
        }"
      `)
    })

    it('should generate Angular service with correct microservice base', () => {
      const routes = [
        {
          path: '/someRoute',
          method: 'GET' as HTTPMethod,
          functionName: 'GETSomeRoute',
          params: [],
          returnType: 'string',
        },
      ]
      const result = generateAPIClient(routes, 'custom-ms', 'GeneratedCustomMs')
      expect(result).toMatchInlineSnapshot(`
        "/**
         * Auto-generated Cumulocity API Client
         * Generated by c8y-nitro
         *
         * This Angular service provides typed methods for all Nitro routes.
         * Each method corresponds to a route handler and returns properly typed responses.
         */
        import { Injectable, inject } from '@angular/core'
        import { FetchClient } from '@c8y/ngx-components'

        // Type helpers for proper serialization
        type JsonPrimitive = string | number | boolean | string | number | boolean | null;
        type NonJsonPrimitive = undefined | Function | symbol;
        type IsAny<T> = 0 extends 1 & T ? true : false;
        type FilterKeys<TObj extends object, TFilter> = { [TKey in keyof TObj]: TObj[TKey] extends TFilter ? TKey : never }[keyof TObj];
        type Serialize<T> = IsAny<T> extends true ? any : T extends JsonPrimitive | undefined ? T : T extends Map<any, any> | Set<any> ? Record<string, never> : T extends NonJsonPrimitive ? never : T extends {
          toJSON: () => infer U;
        } ? U : T extends [] ? [] : T extends [unknown, ...unknown[]] ? SerializeTuple<T> : T extends ReadonlyArray<infer U> ? (U extends NonJsonPrimitive ? null : Serialize<U>)[] : T extends object ? SerializeObject<T> : never;
        type SerializeTuple<T extends [unknown, ...unknown[]]> = { [k in keyof T]: T[k] extends NonJsonPrimitive ? null : Serialize<T[k]> };
        type SerializeObject<T extends object> = { [k in keyof Omit<T, FilterKeys<T, NonJsonPrimitive>>]: Serialize<T[k]> };
        type Simplify<TType> = TType extends any[] | Date ? TType : { [K in keyof TType]: Simplify<TType[K]> };
        type Awaited<T> = T extends PromiseLike<infer U> ? Awaited<U> : T;


        @Injectable({ providedIn: 'root' })
        export class GeneratedCustomMs {
          private readonly BASE_PATH = '/service/custom-ms';
          private readonly fetchClient: FetchClient = inject(FetchClient)

          constructor() {}

          async GETSomeRoute(): Promise<string> {
            const response = await this.fetchClient.fetch(\`\${this.BASE_PATH}/someRoute\`, { method: 'GET', headers: { 'Content-Type': 'application/json' } });
            return response.json();
          }
        }"
      `)
    })
  })

  it('should generate a real world example correctly', () => {
    // Directly construct the routes array that would be generated
    const routes = [
      {
        path: '/[id]',
        method: 'GET' as HTTPMethod,
        functionName: 'GETById',
        params: ['id'],
        returnType: 'Simplify<Serialize<Awaited<ReturnType<typeof import(\'../../../routes/[id].get\').default>>>>',
      },
      {
        path: '/api/[multiple]/[params]',
        method: 'GET' as HTTPMethod,
        functionName: 'GETApiByMultipleByParams',
        params: ['multiple', 'params'],
        returnType: 'Simplify<Serialize<Awaited<ReturnType<typeof import(\'../../../routes/api/[multiple]/[params]\').default>>>>',
      },
      {
        path: '/health',
        method: 'GET' as HTTPMethod,
        functionName: 'GETHealth',
        params: [],
        returnType: 'Simplify<Serialize<Awaited<ReturnType<typeof import(\'../../../routes/health.get\').default>>>>',
      },
      {
        path: '/health',
        method: 'POST' as HTTPMethod,
        functionName: 'POSTHealth',
        params: [],
        returnType: 'Simplify<Serialize<Awaited<ReturnType<typeof import(\'../../../routes/health.post\').default>>>>',
      },
      {
        path: '/someRoute',
        method: 'GET' as HTTPMethod,
        functionName: 'GETSomeRoute',
        params: [],
        returnType: 'Simplify<Serialize<Awaited<ReturnType<typeof import(\'../../../routes/someRoute\').default>>>>',
      },
    ]

    const result = generateAPIClient(routes, 'my-microservice', 'GeneratedMyMicroservice')

    expect(result).toMatchInlineSnapshot(`
      "/**
       * Auto-generated Cumulocity API Client
       * Generated by c8y-nitro
       *
       * This Angular service provides typed methods for all Nitro routes.
       * Each method corresponds to a route handler and returns properly typed responses.
       */
      import { Injectable, inject } from '@angular/core'
      import { FetchClient } from '@c8y/ngx-components'

      // Type helpers for proper serialization
      type JsonPrimitive = string | number | boolean | string | number | boolean | null;
      type NonJsonPrimitive = undefined | Function | symbol;
      type IsAny<T> = 0 extends 1 & T ? true : false;
      type FilterKeys<TObj extends object, TFilter> = { [TKey in keyof TObj]: TObj[TKey] extends TFilter ? TKey : never }[keyof TObj];
      type Serialize<T> = IsAny<T> extends true ? any : T extends JsonPrimitive | undefined ? T : T extends Map<any, any> | Set<any> ? Record<string, never> : T extends NonJsonPrimitive ? never : T extends {
        toJSON: () => infer U;
      } ? U : T extends [] ? [] : T extends [unknown, ...unknown[]] ? SerializeTuple<T> : T extends ReadonlyArray<infer U> ? (U extends NonJsonPrimitive ? null : Serialize<U>)[] : T extends object ? SerializeObject<T> : never;
      type SerializeTuple<T extends [unknown, ...unknown[]]> = { [k in keyof T]: T[k] extends NonJsonPrimitive ? null : Serialize<T[k]> };
      type SerializeObject<T extends object> = { [k in keyof Omit<T, FilterKeys<T, NonJsonPrimitive>>]: Serialize<T[k]> };
      type Simplify<TType> = TType extends any[] | Date ? TType : { [K in keyof TType]: Simplify<TType[K]> };
      type Awaited<T> = T extends PromiseLike<infer U> ? Awaited<U> : T;


      @Injectable({ providedIn: 'root' })
      export class GeneratedMyMicroservice {
        private readonly BASE_PATH = '/service/my-microservice';
        private readonly fetchClient: FetchClient = inject(FetchClient)

        constructor() {}

        async GETById(params: { id: string | number }): Promise<Simplify<Serialize<Awaited<ReturnType<typeof import('../../../routes/[id].get').default>>>>> {
          const response = await this.fetchClient.fetch(\`\${this.BASE_PATH}/\${params.id}\`, { method: 'GET', headers: { 'Content-Type': 'application/json' } });
          return response.json();
        }

        async GETApiByMultipleByParams(params: { multiple: string | number; params: string | number }): Promise<Simplify<Serialize<Awaited<ReturnType<typeof import('../../../routes/api/[multiple]/[params]').default>>>>> {
          const response = await this.fetchClient.fetch(\`\${this.BASE_PATH}/api/\${params.multiple}/\${params.params}\`, { method: 'GET', headers: { 'Content-Type': 'application/json' } });
          return response.json();
        }

        async GETHealth(): Promise<Simplify<Serialize<Awaited<ReturnType<typeof import('../../../routes/health.get').default>>>>> {
          const response = await this.fetchClient.fetch(\`\${this.BASE_PATH}/health\`, { method: 'GET', headers: { 'Content-Type': 'application/json' } });
          return response.json();
        }

        async POSTHealth(): Promise<Simplify<Serialize<Awaited<ReturnType<typeof import('../../../routes/health.post').default>>>>> {
          const response = await this.fetchClient.fetch(\`\${this.BASE_PATH}/health\`, { method: 'POST', headers: { 'Content-Type': 'application/json' } });
          return response.json();
        }

        async GETSomeRoute(): Promise<Simplify<Serialize<Awaited<ReturnType<typeof import('../../../routes/someRoute').default>>>>> {
          const response = await this.fetchClient.fetch(\`\${this.BASE_PATH}/someRoute\`, { method: 'GET', headers: { 'Content-Type': 'application/json' } });
          return response.json();
        }
      }"
    `)
  })
})
