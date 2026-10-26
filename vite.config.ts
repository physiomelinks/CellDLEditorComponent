import * as primeVueAutoImportResolver from '@primevue/auto-import-resolver'
import tailwindcssPlugin from '@tailwindcss/vite'
import vuePlugin from '@vitejs/plugin-vue'

import fs from 'node:fs'
import path from 'node:path'
import url from 'node:url'
import vitePlugin from 'unplugin-vue-components/vite'
import * as vite from 'vite'

const _dirname = path.dirname(url.fileURLToPath(import.meta.url))

export default vite.defineConfig({
    base: 'https://celldl.github.io/CellDLEditor/',
    build: {
        chunkSizeWarningLimit: 2048,
        rollupOptions: {
            output: {
                entryFileNames: `assets/[name].js`,
                chunkFileNames: `assets/[name].js`,
                assetFileNames: `assets/[name].[ext]`
            }
        },
        sourcemap: true,
        target: 'esnext'
    },
    optimizeDeps: {
        // libcellml.js and oxigraph find their `.wasm` relative to their own URL
        exclude: [
            '*.wasm',
            '*.whl',
            'libcellml.js',
            'oxigraph'
        ]
    },
    plugins: [
        // Note: this must be in sync with electron.vite.config.ts.

        tailwindcssPlugin(),
        vuePlugin({
            script: {
                fs: {
                    fileExists: (file: string) => fs.existsSync(file),
                    readFile: (file: string) => fs.readFileSync(file, 'utf-8'),
                    realpath: (file: string) => fs.realpathSync(file)
                }
            }
        }),
        vitePlugin({
            resolvers: [primeVueAutoImportResolver.PrimeVueResolver()]
        })
    ],
    resolve: {
        alias: {
            'node-fetch': 'isomorphic-fetch',
            '#editor': path.resolve(_dirname, 'src/CellDL'),
            '#root': path.resolve(_dirname, 'src')
        }
    },
    server: {
        fs: {
            allow: [path.join(_dirname, '../..')]
        }
    }
})
