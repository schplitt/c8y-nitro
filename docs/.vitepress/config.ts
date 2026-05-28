import { defineConfig } from 'vitepress'

export default defineConfig({
  title: 'c8y-nitro',
  description: 'Nitro for Cumulocity IoT microservices',
  base: '/c8y-nitro/',

  head: [['link', { rel: 'icon', href: '/c8y-nitro/favicon.ico' }]],

  themeConfig: {
    nav: [
      { text: 'Guide', link: '/guide/what-is-c8y-nitro' },
      { text: 'Reference', link: '/reference/module-options' },
      {
        text: 'Changelog',
        link: 'https://github.com/schplitt/c8y-nitro/releases',
      },
    ],

    sidebar: [
      {
        text: 'Introduction',
        items: [
          { text: 'What is c8y-nitro?', link: '/guide/what-is-c8y-nitro' },
          { text: 'Quickstart', link: '/quickstart' },
          { text: 'Configuration', link: '/guide/configuration' },
        ],
      },
      {
        text: 'Guide',
        items: [
          { text: 'Manifest', link: '/guide/manifest' },
          { text: 'Auto-Bootstrap', link: '/guide/auto-bootstrap' },
          { text: 'Dev User Injection', link: '/guide/dev-user' },
          { text: 'Logging', link: '/guide/logging' },
          { text: 'Auth Middleware', link: '/guide/auth-middleware' },
          { text: 'Tenant Options', link: '/guide/tenant-options' },
          { text: 'Cache Configuration', link: '/guide/cache' },
          { text: 'Scheduled Tasks', link: '/guide/scheduled-tasks' },
          { text: 'Zip Creation', link: '/guide/zip-creation' },
          { text: 'API Client Generation', link: '/guide/api-client' },
          { text: 'Deployment', link: '/guide/deployment' },
        ],
      },
      {
        text: 'Reference',
        items: [
          { text: 'Module Options', link: '/reference/module-options' },
          { text: 'Utilities', link: '/reference/utilities' },
          { text: 'CLI Commands', link: '/reference/cli' },
          { text: 'Runtime Hooks', link: '/reference/runtime-hooks' },
          { text: 'Runtime Module', link: '/reference/runtime-module' },
          { text: 'Environment Variables', link: '/reference/environment-variables' },
        ],
      },
    ],

    socialLinks: [
      { icon: 'github', link: 'https://github.com/schplitt/c8y-nitro' },
    ],

    search: {
      provider: 'local',
    },

    editLink: {
      pattern: 'https://github.com/schplitt/c8y-nitro/edit/main/docs/:path',
      text: 'Edit this page on GitHub',
    },

    footer: {
      message: 'Released under the MIT License.',
      copyright: 'Copyright © schplitt',
    },
  },
})
