import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    testTimeout: 10000,
    alias: {
      // openclaw 是全局安装的 peer dependency，alias 指向实际安装路径
      'openclaw/plugin-sdk': '/usr/local/lib/node_modules/openclaw/dist/plugin-sdk/index.js',
    },
  },
})
