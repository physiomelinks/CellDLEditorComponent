/******************************************************************************

CellDL Editor

Copyright (c) 2022 - 2025 David Brooks

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

/** biome-ignore-all lint/style/noNonNullAssertion: indices are of the bounds given */

// Aligning and distributing selected components, as PowerPoint does

//==============================================================================

/** How to arrange the selection */
export type ArrangeOp =
    | 'left' | 'centre' | 'right'
    | 'top' | 'middle' | 'bottom'
    | 'distribute-h' | 'distribute-v'

export const ARRANGE_OPS: readonly ArrangeOp[] = [
    'left', 'centre', 'right', 'top', 'middle', 'bottom', 'distribute-h', 'distribute-v'
]

/** An object's bounds, in SVG coordinates */
export type ArrangeBounds = {
    left: number
    top: number
    right: number
    bottom: number
}

/** How far to move an object */
export type ArrangeDelta = {
    dx: number
    dy: number
}

/** The fewest objects an operation acts on */
export function minimumForArrange(op: ArrangeOp): number {
    return op.startsWith('distribute') ? 3 : 2
}

//==============================================================================

/**
 * The moves that arrange objects, one per object in the order given.
 *
 * Align uses the edges or centre of the objects' bounding box. Distribute keeps
 * the two outermost objects where they are and makes the gaps between objects'
 * edges equal. Too few objects, or none to move, give zero moves.
 */
export function arrangeTargets(bounds: readonly ArrangeBounds[], op: ArrangeOp): ArrangeDelta[] {
    const deltas: ArrangeDelta[] = bounds.map(() => ({ dx: 0, dy: 0 }))
    if (bounds.length < minimumForArrange(op)) {
        return deltas
    }
    const left = Math.min(...bounds.map(b => b.left))
    const right = Math.max(...bounds.map(b => b.right))
    const top = Math.min(...bounds.map(b => b.top))
    const bottom = Math.max(...bounds.map(b => b.bottom))
    bounds.forEach((b, i) => {
        const delta = deltas[i]!
        if (op === 'left') {
            delta.dx = left - b.left
        } else if (op === 'right') {
            delta.dx = right - b.right
        } else if (op === 'centre') {
            delta.dx = (left + right) / 2 - (b.left + b.right) / 2
        } else if (op === 'top') {
            delta.dy = top - b.top
        } else if (op === 'bottom') {
            delta.dy = bottom - b.bottom
        } else if (op === 'middle') {
            delta.dy = (top + bottom) / 2 - (b.top + b.bottom) / 2
        }
    })
    if (op === 'distribute-h') {
        distribute(bounds, deltas, 'left', 'right', 'dx')
    } else if (op === 'distribute-v') {
        distribute(bounds, deltas, 'top', 'bottom', 'dy')
    }
    return deltas
}

function distribute(bounds: readonly ArrangeBounds[], deltas: ArrangeDelta[],
                    start: 'left'|'top', end: 'right'|'bottom', axis: 'dx'|'dy') {
    // Order by centre, so the outermost objects are first and last
    const order = bounds.map((_, i) => i)
                        .sort((a, b) => centre(bounds[a]!, start, end) - centre(bounds[b]!, start, end) || a - b)
    const first = bounds[order[0]!]!
    const last = bounds[order[order.length - 1]!]!
    const sizes = order.map(i => bounds[i]![end] - bounds[i]![start])
    const span = last[end] - first[start]
    const gap = (span - sizes.reduce((sum, size) => sum + size, 0)) / (order.length - 1)
    let position = first[start]
    order.forEach((index, n) => {
        deltas[index]![axis] = (n === 0 || n === order.length - 1) ? 0 : position - bounds[index]![start]
        position += sizes[n]! + gap
    })
}

function centre(bounds: ArrangeBounds, start: 'left'|'top', end: 'right'|'bottom'): number {
    return (bounds[start] + bounds[end]) / 2
}

//==============================================================================

/**
 * The bonds whose two ends are both among the objects, once each. Arranging
 * straightens these; a bond with only one end among them keeps its bends.
 */
export function bondsWithin<Bond extends { readonly connectedObjects: readonly unknown[] }>(
    objects: readonly { readonly connections: readonly Bond[] }[]
): Bond[] {
    const arranged: Set<unknown> = new Set(objects)
    const bonds: Set<Bond> = new Set()
    for (const object of objects) {
        for (const bond of object.connections) {
            const ends = bond.connectedObjects
            if (ends.length >= 2 && arranged.has(ends[0]) && arranged.has(ends[ends.length - 1])) {
                bonds.add(bond)
            }
        }
    }
    return [...bonds]
}

//==============================================================================
