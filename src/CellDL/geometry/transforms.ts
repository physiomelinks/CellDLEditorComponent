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

import {
    applyToPoint,
    applyToPoints,
    compose,
    fromDefinition,
    fromString,
    fromTransformAttribute,
    identity,
    inverse,
    type Matrix,
    toString as transformToString,
    translate
} from 'transformation-matrix'

//==============================================================================

import { Point, type PointLike } from '#root/utils/points'

//==============================================================================

export class NormalTransform {
    #inverse: Matrix
    #matrix: Matrix

    constructor(p0: PointLike, p1: PointLike) {
        const translate: Matrix = {
            a: 1,
            c: 0,
            e: -p0.x,
            b: 0,
            d: 1,
            f: -p0.y
        }
        const delta = Point.fromPoint(p1).subtract(p0)
        const l2 = delta.x * delta.x + delta.y * delta.y
        const scaleRotate: Matrix = {
            a: delta.x / l2,
            c: delta.y / l2,
            e: 0,
            b: -delta.y / l2,
            d: delta.x / l2,
            f: 0
        }
        this.#matrix = compose([scaleRotate, translate])
        this.#inverse = inverse(this.#matrix)
    }

    normalise(point: PointLike): Point {
        return Point.fromPoint(applyToPoint(this.#matrix, point))
    }

    invert(point: PointLike): Point {
        return Point.fromPoint(applyToPoint(this.#inverse, point))
    }
}

//==============================================================================

export class Transform {
    #matrix: Matrix

    constructor(matrix: Matrix) {
        this.#matrix = matrix
    }

    static fromString(matrix: string): Transform {
        if (matrix === '' || matrix === 'none') {
            return new Transform(identity())
        } else {
            return new Transform(fromString(matrix))
        }
    }

    /**
     * An SVG element's own transform.
     *
     * Its computed style has it, except in Safari, whose computed style leaves out
     * a `transform` attribute, so then the attribute is read.
     *
     * @param element An SVG element.
     */
    static fromElement(element: SVGGraphicsElement): Transform {
        const transform = getComputedStyle(element).transform
        if (transform && transform !== 'none') {
            return Transform.fromString(transform)
        }
        const attribute = element.getAttribute('transform')?.trim()
        if (attribute) {
            return new Transform(compose(fromDefinition(fromTransformAttribute(attribute))))
        }
        return Transform.Identity()
    }

    static Identity(): Transform {
        return new Transform(identity())
    }

    get isIdentity(): boolean {
        return transformToString(this.#matrix) === transformToString(identity())
    }

    inverse(): Transform {
        return new Transform(inverse(this.#matrix))
    }

    leftMultiply(transform: Transform): Transform {
        return new Transform(compose([transform.#matrix, this.#matrix]))
    }

    toString(): string {
        return transformToString(this.#matrix)
    }

    transformPoint(point: PointLike): Point {
        return Point.fromPoint(applyToPoint(this.#matrix, point))
    }

    transformPoints(points: PointLike[]): Point[] {
        return applyToPoints(this.#matrix, points).map((pt) => Point.fromPoint(pt))
    }

    static Translate(tx: number, ty: number): Transform {
        return new Transform(translate(tx, ty))
    }
}

//==============================================================================
