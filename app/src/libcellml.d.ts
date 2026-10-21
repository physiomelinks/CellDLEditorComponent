// libcellml.js has no type declarations of its own

declare module 'libcellml.js' {
    import type { Runtime } from '@physiomelinks/bg2cellml'

    export default function createLibCellML(): Promise<Runtime['libcellml']>
}
