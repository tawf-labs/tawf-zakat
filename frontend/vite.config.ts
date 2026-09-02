import { defineConfig } from 'vite'
import { devtools } from '@tanstack/devtools-vite'
import { tanstackStart } from '@tanstack/react-start/plugin/vite'
import viteReact from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { nitro } from 'nitro/vite'

const config = defineConfig({
  resolve: { tsconfigPaths: true },
  ssr: {
    external: ['@coinbase/cdp-sdk', '@x402/evm'],
  },
  plugins: [
    devtools(),
    nitro({
      preset: process.env.VERCEL ? 'vercel' : undefined,
      rollupConfig: {
        // connectkit (and its transitive @aave/account dep, which crashes on
        // Node/SSR by touching `window` at module load) is only ever reached
        // via the dynamic import() in SafeConnectKitProvider. Left un-external,
        // Nitro's dependency tracer merges it into the same physical chunk as
        // plain `wagmi` hooks the router loads eagerly on every request, which
        // defeats that dynamic import's deferral. Externalizing keeps it a real
        // lazy require() against traced node_modules instead.
        external: [/^@sentry\//, '@coinbase/cdp-sdk', '@x402/evm', 'connectkit', '@aave/account'],
      },
    }),
    tailwindcss(),
    tanstackStart(),
    viteReact(),
  ],
})

export default config
