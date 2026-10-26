/******************************************************************************

CellDL Editor

Copyright (c) 2022 - 2026 David Brooks

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.

******************************************************************************/

// A diagram's unit system: SI (mol, L, J, C) or Cellular (fmol, pL, fJ, fC).
// It is the document's `pml:unitSystem` triple, as bg2cellml reads it, and
// without one a diagram is SI. New values are stored in the system's units.

import { rescaleUnits } from '@physiomelinks/cellml-units'

//==============================================================================

/** The preset unit systems */
export type UnitSystemId = 'si' | 'cellular'

export const UNIT_SYSTEM_IDS: readonly UnitSystemId[] = ['si', 'cellular']

/** A diagram without a unit system is SI */
export const IMPLICIT_UNIT_SYSTEM: UnitSystemId = 'si'

/** The unit system new diagrams are given, unless the editor's `unitSystem` option says otherwise */
export const NEW_DIAGRAM_UNIT_SYSTEM: UnitSystemId = 'cellular'

const PML_URI = 'https://physiomelinks.github.io/ns/celldl#'

/** The document's unit system's predicate, as bg2cellml reads it */
export const UNIT_SYSTEM_PREDICATE = `${PML_URI}unitSystem`

/** Each unit system's IRI */
export const UNIT_SYSTEM_IRIS: Readonly<Record<UnitSystemId, string>> = {
    si: `${PML_URI}SI`,
    cellular: `${PML_URI}Cellular`
}

export function isUnitSystemId(id: unknown): id is UnitSystemId {
    return UNIT_SYSTEM_IDS.includes(id as UnitSystemId)
}

/** The unit system with an IRI, or `null` for one the editor doesn't know */
export function unitSystemForIri(iri: string): UnitSystemId|null {
    return UNIT_SYSTEM_IDS.find(id => UNIT_SYSTEM_IRIS[id] === iri) ?? null
}

//==============================================================================

/**
 * A template's UCUM code in a unit system's units: `mol-1` is `fmol-1` in
 * Cellular. A code that can't be rescaled, and every code in SI, is kept.
 */
export function effectiveUnits(code: string, system: UnitSystemId): string {
    if (!code || system === 'si') {
        return code
    }
    try {
        return rescaleUnits(code, system).code
    } catch {
        return code
    }
}

/**
 * A stored value, `"<number> <units>"`, in a unit system's units, with its
 * number converted so it stays the same quantity: "1 mol-1" is "1e-15 fmol-1"
 * in Cellular. `undefined` when it is unchanged or can't be converted.
 */
export function rescaledValue(text: string, system: UnitSystemId): string|undefined {
    const [number, units, ...rest] = text.trim().split(/\s+/)
    if (!number || !units || rest.length) {
        return
    }
    const value = Number(number)
    if (!Number.isFinite(value)) {
        return
    }
    let rescaled: { code: string, factor: number }
    try {
        rescaled = rescaleUnits(units, system)
    } catch {
        return
    }
    if (rescaled.code === units) {
        return
    }
    return `${Number((value * rescaled.factor).toPrecision(15))} ${rescaled.code}`
}

//==============================================================================
//==============================================================================
