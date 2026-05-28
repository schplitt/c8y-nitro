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

During Nitro setup, `c8y-nitro` writes a generated type file to Nitro's generated types directory. This augments `c8y-nitro/types` with:

- `C8YRoles`
- `C8YTenantOptionKey`
- `C8YTenantOptionKeysCacheConfig`

That is what makes manifest-defined roles and tenant option keys visible to TypeScript.

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