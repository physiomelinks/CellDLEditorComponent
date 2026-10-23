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

/**
 * Which way a bond may point, from BG-RDF's base types and declared ports.
 *
 * A bond points from its source (where a drag starts) to its target. A wrong
 * direction is refused with a message, never reversed.
 */

//==============================================================================

/** What a bond end is, for the direction rules */
export type BondEndKind =
    | 'storage'     // QuantityStore, FlowStore: a bond's target
    | 'dissipator'  // Resistance: a bond's target
    | 'reaction'    // Reaction: by its ports, else a bond's target
    | 'source'      // PotentialSource, FlowSource: a bond's source
    | 'transform'   // TransformNode: one bond in, one out
    | 'zero'        // ZeroNode
    | 'one'         // OneNode
    | 'composite'   // A composite, e.g. ChemicalStorageNode: either direction
    | 'other'       // Not a bond graph element: no rule

/** The number of a template's declared ports, by direction */
export interface BondPorts {
    inward: number
    outward: number
}

/** A bond end, as the rules see it */
export interface BondEnd {
    id: string
    kind: BondEndKind
    /** The ports its template declares, if any */
    ports?: BondPorts
}

/** An existing bond */
export interface ExistingBond {
    source: BondEnd
    target: BondEnd
}

/** The existing bonds of a new bond's source and target */
export interface BondRuleContext {
    bonds: ExistingBond[]
}

export type BondRuleResult = { ok: true } | { alert: string }

//==============================================================================

export const BOND_RULE_MESSAGES = {
    storeIsTarget: 'Bonds point into a store. Drag from the junction to the store.',
    sourceIsSource: 'A source\'s bond points out of it. Drag from the source.',
    reactionHasReactants: 'This reaction already has its reactants (f) bond. Drag from the reaction to its products side.',
    reactionHasProducts: 'This reaction already has its products (r) bond. Drag from the reactants side to the reaction.',
    reactantsSide: 'This is a reactants side: drag from the species to it.',
    productsSide: 'This is a products side: drag from it to the species.',
    dissipatorIsTarget: 'Bonds point into a resistance or reaction. Drag from the junction to it.',
    transformHasInward: 'A transform node has one bond in and one out. Drag from it to the other side.',
    transformHasOutward: 'A transform node has one bond in and one out. Drag to it from the other side.'
} as const

//==============================================================================

const OK: BondRuleResult = { ok: true }

function refuse(alert: string): BondRuleResult {
    return { alert }
}

function inwardCount(end: BondEnd, ctx: BondRuleContext): number {
    return ctx.bonds.filter(bond => bond.target.id === end.id).length
}

function outwardCount(end: BondEnd, ctx: BondRuleContext): number {
    return ctx.bonds.filter(bond => bond.source.id === end.id).length
}

/** Whether a 1-junction is a reaction's reactants or products side, from its bonds */
export function reactionSide(junction: BondEnd, ctx: BondRuleContext): 'reactants'|'products'|undefined {
    if (junction.kind !== 'one') {
        return
    }
    for (const bond of ctx.bonds) {
        if (bond.source.id === junction.id && bond.target.kind === 'reaction') {
            return 'reactants'
        } else if (bond.target.id === junction.id && bond.source.kind === 'reaction') {
            return 'products'
        }
    }
}

/**
 * Whether a bond from `source` to `target` points the right way.
 *
 * @param source Where the bond starts.
 * @param target Where the bond ends.
 * @param ctx The existing bonds of `source` and `target`.
 */
export function bondRule(source: BondEnd, target: BondEnd, ctx: BondRuleContext): BondRuleResult {
    // Storage and sources, whatever their ports
    if (source.kind === 'storage') {
        return refuse(BOND_RULE_MESSAGES.storeIsTarget)
    } else if (target.kind === 'source') {
        return refuse(BOND_RULE_MESSAGES.sourceIsSource)
    }

    // Reactions with ports: one bond per port, f inward and r outward
    if (target.kind === 'reaction' && target.ports) {
        if (inwardCount(target, ctx) >= target.ports.inward) {
            return refuse(BOND_RULE_MESSAGES.reactionHasReactants)
        }
    } else if (target.kind === 'reaction' && source.kind === 'reaction') {
        return refuse(BOND_RULE_MESSAGES.dissipatorIsTarget)
    }
    if (source.kind === 'reaction') {
        if (!source.ports) {
            return refuse(BOND_RULE_MESSAGES.dissipatorIsTarget)
        } else if (outwardCount(source, ctx) >= source.ports.outward) {
            return refuse(BOND_RULE_MESSAGES.reactionHasProducts)
        }
    }

    // Other dissipators are a bond's target
    if (source.kind === 'dissipator') {
        return refuse(BOND_RULE_MESSAGES.dissipatorIsTarget)
    }

    // Transform nodes have one bond in and one out
    if (target.kind === 'transform' && inwardCount(target, ctx) >= 1) {
        return refuse(BOND_RULE_MESSAGES.transformHasInward)
    } else if (source.kind === 'transform' && outwardCount(source, ctx) >= 1) {
        return refuse(BOND_RULE_MESSAGES.transformHasOutward)
    }

    // A reactants side's other bonds point into it, and a products side's out of it
    if (reactionSide(source, ctx) === 'reactants') {
        return refuse(BOND_RULE_MESSAGES.reactantsSide)
    } else if (reactionSide(target, ctx) === 'products') {
        return refuse(BOND_RULE_MESSAGES.productsSide)
    }

    return OK
}

//==============================================================================
//==============================================================================
