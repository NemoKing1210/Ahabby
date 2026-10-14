import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { readFileSync } from 'node:fs'
import { fileURLToPath, URL } from 'node:url'

// Injected so the Settings "About" section shows the real version, not a hardcoded copy.
const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as {
  version: string
}

// Tauri expects a fixed port and ignores `src-tauri` for HMR purposes.
const host = process.env.TAURI_DEV_HOST

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host ? { protocol: 'ws', host, port: 1421 } : undefined,
    watch: {
      ignored: ['**/src-tauri/**'],
    },
  },
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  envPrefix: ['VITE_', 'TAURI_ENV_*'],
  build: {
    target: 'es2022',
    sourcemap: false,
    chunkSizeWarningLimit: 1200,
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
    css: false,
    restoreMocks: true,
    // A Radix interaction — `user-event` typing into a `Select`, a dialog's focus dance — costs
    // about twice the wall time with coverage instrumentation on, and the files run in parallel.
    // The 5 s default then reports the machine's load rather than the code. Still bounded: a hung
    // test is a failure, only a slower one.
    testTimeout: 15_000,
    hookTimeout: 15_000,
    coverage: {
      provider: 'v8',
      // `include` is the point: it pulls in a module no test ever imports, which would otherwise
      // simply be absent from the report — so the least covered file in the app reads as 100% of
      // nothing. That is how the agent detail screen (`features/agents/pages/AgentPage.tsx`) and
      // the shell's own providers stayed invisible until they were measured by hand.
      include: ['src/**/*.{ts,tsx}'],
      exclude: [
        'src/**/*.test.{ts,tsx}',
        'src/test/**',
        // Generated from the Rust types; there is nothing of ours here to assert.
        'src/shared/bindings/**',
        'src/vite-env.d.ts',
      ],
      reporter: ['text-summary', 'json-summary', 'html'],
    },
  },
})
