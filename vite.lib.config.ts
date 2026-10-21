import * as primeVueAutoImportResolver from '@primevue/auto-import-resolver'
import tailwindcssPlugin from '@tailwindcss/vite'
import fs from 'node:fs'
import path from 'node:path'
import url from 'node:url'
import vuePlugin from '@vitejs/plugin-vue'
import vitePlugin from 'unplugin-vue-components/vite'
import * as vite from 'vite'
import dts from 'vite-plugin-dts'

const _dirname = path.dirname(url.fileURLToPath(import.meta.url))

export default vite.defineConfig({
    build: {
        lib: {
            // `bgrdf` has only the BG-RDF Turtle, so a worker can import it without the editor
            entry: {
                index: './src/index.ts',
                bgrdf: './src/bgrdf.ts'
            },
            fileName: (format: string, entryName: string) =>
                `${entryName === 'index' ? 'CellDLEditor' : entryName}.${format}.js`,
            formats: ['es'],
            name: 'CellDLEditor'
        },
        rollupOptions: {
            external: ['vue'],
            output: {
                dir: 'dist',
                exports: 'named',
                globals: {
                    vue: 'Vue'
                },
                assetFileNames: (assetInfo: { names: string[] }) => {
                    if (assetInfo.names.includes('editor.css')) {
                        return 'CellDLEditor.css'
                    }
                    return assetInfo.names[0] ?? 'default-name'
                }
            }
        },
        sourcemap: true,
        target: 'esnext'
    },
    optimizeDeps: {
        exclude: [
            '*.wasm',
            '*.whl'
        ]
    },
    resolve: {
        alias: {
            'node-fetch': 'isomorphic-fetch',
            '#editor': path.resolve(_dirname, 'src/CellDL'),
            '#root': path.resolve(_dirname, 'src')
        }
    },
    plugins: [
        dts({
            exclude: ['./app/**'],
            insertTypesEntry: true
        }),
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
    ]
})
