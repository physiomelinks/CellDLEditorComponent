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

// Signal bonds (BG-RDF's bgf:SignalBond): a connection that carries a variable of its source to its target, where it
// sets one of the target's signal inputs (bgf:signalInput) or scales one of its parameters (bgf:modulates, by the
// signal to the power bgf:modulationExponent). A connection is a signal bond when either end is a signal block
// (bgf:SignalBlock), or when it is drawn with signal bonds chosen (`drawSignalBonds`). This module holds the
// choices' logic; the plugin (./index.ts) reads and writes them as RDF.

import * as vue from 'vue'

//==============================================================================

/** Whether new bonds are drawn as signal bonds (the palette's and the bond graph tools' toggle) */
export const drawSignalBonds = vue.ref(false)

/** The class a signal bond's SVG path has, which draws it dashed with an arrowhead at its target */
export const SIGNAL_BOND_CLASS = 'signal'

/** Whether a new connection is a signal bond: either end is a signal block, or signal bonds are being drawn. */
export function isSignalConnection(ends: { sourceIsBlock: boolean, targetIsBlock: boolean,
                                           drawingSignals: boolean }): boolean {
    return ends.sourceIsBlock || ends.targetIsBlock || ends.drawingSignals
}

//==============================================================================

/** What a signal bond's target offers it: its template's signal inputs and parameters, and a source's value. */
export interface SignalTarget {
    /** The signal inputs (bgf:hasSignalInput) of its template, by varName, in order */
    inputs: string[]
    /** The parameters of its template, by varName, in order */
    parameters: string[]
    /** A flow source's `v` or a potential source's `u`, which a signal can scale */
    sourceValue?: string
}

/** How a signal bond acts on its target: as one of its signal inputs, or scaling a parameter by s^exponent. */
export type SignalUse =
    | { signalInput: string }
    | { modulates: string, exponent: number }
    | Record<string, never>

/**
 * A new signal bond's use: the target's first signal input that no other signal bond sets (the first when all are
 * set); else, when the target has no signal inputs, scaling its first parameter (or a source's value) by the
 * signal; else nothing.
 */
export function defaultSignalUse(target: SignalTarget, connectedInputs: string[]): SignalUse {
    const free = target.inputs.find(name => !connectedInputs.includes(name)) ?? target.inputs[0]
    if (free !== undefined) {
        return { signalInput: free }
    }
    const modulated = target.parameters[0] ?? target.sourceValue
    return modulated !== undefined ? { modulates: modulated, exponent: 1 } : {}
}

/** A use as the Properties panel's value: `input:<varName>` or `modulates:<varName>`, '' for none. */
export function signalUseValue(use: SignalUse): string {
    return 'signalInput' in use ? `input:${use.signalInput}`
         : 'modulates' in use ? `modulates:${use.modulates}`
         : ''
}

/** The use a Properties panel's value stands for, with `exponent` (1 or -1) when it scales a parameter. */
export function parseSignalUse(value: string, exponent: number = 1): SignalUse {
    const colon = value.indexOf(':')
    const kind = value.slice(0, colon), name = value.slice(colon + 1)
    if (colon > 0 && name) {
        if (kind === 'input') return { signalInput: name }
        if (kind === 'modulates') return { modulates: name, exponent: exponent === -1 ? -1 : 1 }
    }
    return {}
}

/** The uses a target offers, as the Properties panel lists them: its signal inputs, then what can be scaled. */
export function signalUseOptions(target: SignalTarget): { name: string, value: string }[] {
    return [
        ...target.inputs.map(name => ({ name: `Signal input ${name}`, value: `input:${name}` })),
        ...target.parameters.map(name => ({ name: `Scales parameter ${name}`, value: `modulates:${name}` })),
        ...(target.sourceValue ? [{ name: `Scales the source's ${target.sourceValue}`,
                                     value: `modulates:${target.sourceValue}` }] : [])
    ]
}

//==============================================================================

/** How a variable without fixed units shows its units: those of another of its template's variables, or any. */
export function freeUnitsLabel(unitsOf?: string): string {
    return unitsOf ? `units of ${unitsOf}` : 'any units'
}

const NUMBER_UNITS = /^([+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)\s*(.*)$/

/**
 * A value typed for a variable without fixed units, as it is stored, `"<number> <units>"`: "12 kPa" and "5e-9 mol"
 * give their units; a bare number keeps `storedUnits`, else is dimensionless ("1"). `undefined` when the text isn't
 * a number with optional UCUM units.
 */
export function valueWithUnits(text: string|number, storedUnits?: string): string|undefined {
    const match = String(text).trim().match(NUMBER_UNITS)
    if (!match) return
    const units = match[2]!.trim()
    if (/\s/.test(units)) return
    return `${Number(match[1])} ${units || storedUnits || '1'}`
}

//==============================================================================
//==============================================================================
