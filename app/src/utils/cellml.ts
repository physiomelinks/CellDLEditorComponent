import type { CellMLOutput, Converter } from '@physiomelinks/bg2cellml'

import { bgRdfStatements, initialiseRdf } from '../../../src'

// Generate CellML from a CellDL diagram with bg2cellml, using the editor's Oxigraph module and BG-RDF framework.

let converter: Promise<Converter> | undefined

async function createConverter(): Promise<Converter> {
    const [{ Converter }, { default: createLibCellML }, oxigraph] = await Promise.all([
        import('@physiomelinks/bg2cellml'),
        import('libcellml.js'),
        initialiseRdf()
    ])
    const bgConverter = new Converter({ libcellml: await createLibCellML(), oxigraph })
    const issues = bgConverter.loadFramework({ quads: bgRdfStatements() })
    if (issues.length) {
        console.warn('Issues loading the BG-RDF framework:', issues)
    }
    return bgConverter
}

export async function celldl2cellml(sourceUri: string, celldl: string): Promise<CellMLOutput> {
    if (converter === undefined) {
        converter = createConverter().catch((error) => {
            converter = undefined
            throw error
        })
    }
    try {
        return await (await converter).celldl2cellml(celldl, { sourceUri })
    } catch (error) {
        return { exception: String(error) }
    }
}
