# Deployment

This docs site is configured for a static VitePress build that can be published to GitHub Pages.

## Local Checks

Build the site locally:

```sh
pnpm docs:build
```

Preview the generated output:

```sh
pnpm docs:preview
```

VitePress writes the static site to `docs/.vitepress/dist`.

## GitHub Pages

The VitePress config sets `base: '/c8y-nitro/'`, which matches the repository Pages URL pattern `https://<user>.github.io/c8y-nitro/`.

The release workflow publishes the docs to GitHub Pages whenever a tag matching `v*` is pushed. CI also runs a docs build on pull requests so broken links and config issues are caught before release.

The release pipeline:

1. installs dependencies with pnpm,
2. runs `pnpm docs:build`, and
3. uploads `docs/.vitepress/dist` as the deploy artifact.
4. deploys that artifact to GitHub Pages after the release job succeeds.

In GitHub repository settings, set **Pages** to use **GitHub Actions** as the source.

## Package Release Flow

The docs deployment is intentionally tied to the release workflow, not to every push to `main`.

That means the published docs track tagged releases rather than whatever happened to merge most recently.