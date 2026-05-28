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

In GitHub repository settings, set **Pages** to use **GitHub Actions** as the source.

## Release Flow

When a `v*` tag is pushed, the release workflow publishes the package to npm and then calls the **Deploy Docs** workflow, passing the tag name as the `ref`. The docs built and deployed are exactly the state of the code at that tag — no unreleased content from `main` can leak through.

CI also runs `pnpm docs:build` on every pull request so broken links and config errors are caught before merging.

## Manual Deployment

You can deploy docs from any branch, tag, or commit SHA without triggering a full release:

1. Go to **Actions → Deploy Docs → Run workflow**.
2. Enter the branch, tag, or commit SHA you want to publish (e.g. `v0.6.0` or a `docs/fix-typo` branch).
3. Click **Run workflow**.

This is the right approach for fixing a docs typo on a released version — create a branch off the release tag, fix it, push the branch, then run the workflow pointing at that branch. Nothing from `main` or any unreleased work is included.