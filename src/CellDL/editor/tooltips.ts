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
 * The editor's one tooltip: what it shows, and when.
 *
 * Errors show at once. Hover tooltips (a plugin's hover, e.g. an element's
 * law, and the host's element-info tooltip) show once the pointer has stayed on
 * an object for `delay`, and none show while a bond is being drawn.
 */

import type { PointLike } from '#root/utils/points'

//==============================================================================

/** How long the pointer stays on an object before its hover tooltip shows, in milliseconds */
export const HOVER_TOOLTIP_DELAY = 600

/** How long a flashed message, e.g. why a bond was refused, shows for, in milliseconds */
export const FLASH_DURATION = 2500

/**
 * What a tooltip shows, highest priority first: an error, a hint while drawing,
 * a plugin's hover (e.g. an element's law), and the host's element-info tooltip.
 * A tooltip only replaces one of the same or lower priority, and hiding one
 * kind leaves the others shown.
 */
export type TooltipKind = 'error' | 'hint' | 'hover' | 'info'

const TOOLTIP_PRIORITY: Record<TooltipKind, number> = {
    error: 3,
    hint: 2,
    hover: 1,
    info: 0
}

const HOVER_KINDS: TooltipKind[] = ['hover', 'info']

export interface TooltipContent {
    text: string
    /** e.g. `'error'` or `'info'`; `''` for none */
    style: string
    /** Whether `text` is HTML */
    html: boolean
}

/** What draws the tooltip, e.g. a Tippy instance */
export interface TooltipDisplay {
    /** Shows the tooltip, following the pointer, or fixed at a client point */
    show(content: TooltipContent, at?: PointLike): void
    hide(): void
    readonly visible: boolean
}

//==============================================================================

export class Tooltips {
    /** How long a hover tooltip waits, in milliseconds */
    delay: number = HOVER_TOOLTIP_DELAY

    #display: TooltipDisplay|null
    #kind: TooltipKind|null = null
    #hoverKey: unknown = null
    #hoverTimer: ReturnType<typeof setTimeout>|undefined
    #flashTimer: ReturnType<typeof setTimeout>|undefined
    #suppressed: boolean = false

    constructor(display: TooltipDisplay|null = null) {
        this.#display = display
    }

    set display(display: TooltipDisplay|null) {
        this.#display = display
    }

    /** The kind shown, or `null` */
    get shown(): TooltipKind|null {
        return (this.#kind !== null && this.#display?.visible) ? this.#kind : null
    }

    /** Whether a flashed message is showing */
    get flashing(): boolean {
        return this.#flashTimer !== undefined
    }

    /** Whether a hover tooltip is waiting to show */
    get hoverPending(): boolean {
        return this.#hoverTimer !== undefined
    }

    /**
     * Shows a tooltip, unless one of higher priority is shown, or it's a hover
     * tooltip and they're suppressed.
     *
     * @returns Whether it was shown.
     */
    show(kind: TooltipKind, text: string, style: string = '', html: boolean = false, at?: PointLike): boolean {
        if (!this.#display || (this.#suppressed && HOVER_KINDS.includes(kind))) {
            return false
        }
        const shown = this.shown
        if (shown !== null && TOOLTIP_PRIORITY[shown] > TOOLTIP_PRIORITY[kind]) {
            return false
        }
        this.#clearFlash()
        this.#display.show({ text, style, html }, at)
        this.#kind = kind
        return true
    }

    hide() {
        this.#clearFlash()
        this.#display?.hide()
        this.#kind = null
    }

    /** Hides the tooltip if it shows `kind`. */
    hideKind(kind: TooltipKind) {
        if (this.#kind === kind) {
            this.hide()
        }
    }

    /** Hides the tooltip and cancels a waiting hover tooltip, but leaves a flashed message. */
    clear() {
        this.cancelHover()
        if (!this.flashing) {
            this.hide()
        }
    }

    /**
     * Shows an object's hover tooltip once the pointer has stayed on it for
     * `delay`. Calling again for the same object keeps its wait, or what it shows.
     *
     * @param key The object hovered.
     * @param show Shows its hover tooltip, with `show()`.
     */
    hoverAfterDelay(key: unknown, show: () => void) {
        if (this.#suppressed || (key === this.#hoverKey && key !== null)) {
            return
        }
        this.cancelHover()
        this.#hoverKey = key
        this.#hoverTimer = setTimeout(() => {
            this.#hoverTimer = undefined
            if (!this.#suppressed && this.#hoverKey === key) {
                show()
            }
        }, this.delay)
    }

    /** Cancels a waiting hover tooltip and hides one shown. */
    cancelHover() {
        if (this.#hoverTimer !== undefined) {
            clearTimeout(this.#hoverTimer)
            this.#hoverTimer = undefined
        }
        this.#hoverKey = null
        for (const kind of HOVER_KINDS) {
            this.hideKind(kind)
        }
    }

    /**
     * Stops hover tooltips showing, e.g. while a bond is drawn, hiding what's
     * shown; or lets them show again.
     */
    suppress(suppress: boolean) {
        if (suppress) {
            this.cancelHover()
            this.hide()
        }
        this.#suppressed = suppress
    }

    /** Shows an error at a client point for `duration`. */
    flash(text: string, at: PointLike, duration: number = FLASH_DURATION) {
        if (this.show('error', text, 'error', false, at)) {
            this.#flashTimer = setTimeout(() => {
                this.#flashTimer = undefined
                this.hideKind('error')
            }, duration)
        }
    }

    /** Forgets everything, e.g. when a diagram closes */
    reset() {
        this.cancelHover()
        this.hide()
        this.#suppressed = false
    }

    #clearFlash() {
        if (this.#flashTimer !== undefined) {
            clearTimeout(this.#flashTimer)
            this.#flashTimer = undefined
        }
    }
}

//==============================================================================
//==============================================================================
