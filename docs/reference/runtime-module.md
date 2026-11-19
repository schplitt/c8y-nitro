# Runtime Module

`c8y-nitro/runtime` is a generated virtual module. It exposes manifest-derived values at runtime and generated types during development.

## Exports

```ts
import { c8yManifest, c8yRoles, c8yTenantOptionKeys } from 'c8y-nitro/runtime'
```

| Export                | Description                                        |
| --------------------- | -------------------------------------------------- |
| `c8yManifest`         | The generated Cumulocity manifest object           |
| `c8yRoles`            | An object containing manifest-defined custom roles |
| `c8yTenantOptionKeys` | A readonly array of manifest setting keys          |

## Generated Types

During Nitro setup, `c8y-nitro` writes two declaration files to `node_modules/.c8y-nitro/`:

- `types.d.ts` augments `c8y-nitro/types`: it adds your manifest roles to `C8YRoles` and fills `C8YGenerated`, which narrows `C8YTenantOptionKey`, `C8YTenantOptionKeysCacheConfig`, and `C8YSettingsCategory`. All other exports of `c8y-nitro/types` stay available.
- `runtime.d.ts` declares the `c8y-nitro/runtime` exports above.

That is what makes manifest-defined roles and tenant option keys visible to TypeScript. Without the generated files, `C8YRoles` is empty, and the tenant option key and settings category types fall back to `string`.

## Example

```ts
import { c8yTenantOptionKeys } from 'c8y-nitro/runtime'

export default defineEventHandler(() => {
  return {
    configurableKeys: c8yTenantOptionKeys,
  }
})
```

## Why It Exists

The manifest is configuration, but parts of it are useful to runtime code. The virtual module keeps those values available without asking you to manually import or duplicate your Nitro config.