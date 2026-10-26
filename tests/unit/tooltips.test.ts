import { describe, expect, test } from 'bun:test'

import { HOVER_TOOLTIP_DELAY, type TooltipContent, type TooltipDisplay, Tooltips } from '#editor/editor/tooltips'
import type { PointLike } from '#root/utils/points'

//==============================================================================

const DELAY = 30    // milliseconds, for a test's hovers

class FakeDisplay implements TooltipDisplay {
    content: TooltipContent | null = null
    at: PointLike | undefined
    shows = 0

    show(content: TooltipContent, at?: PointLike) {
        this.content = content
        this.at = at
        this.shows += 1
    }

    hide() {
        this.content = null
    }

    get visible() {
        return this.content !== null
    }

    get text() {
        return this.content?.text ?? ''
    }
}

function tooltips(): { tips: Tooltips, display: FakeDisplay } {
    const display = new FakeDisplay()
    const tips = new Tooltips(display)
    tips.delay = DELAY
    return { tips, display }
}

const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

const hover = (tips: Tooltips, key: string) => tips.hoverAfterDelay(key, () => tips.show('hover', `law of ${key}`))

describe('Hover tooltips', () => {
    test('wait 600 ms by default', () => {
        expect(HOVER_TOOLTIP_DELAY).toBe(600)
        expect(new Tooltips().delay).toBe(HOVER_TOOLTIP_DELAY)
    })

    test('show only once the pointer has stayed on an element', async () => {
        const { tips, display } = tooltips()
        hover(tips, 'A')
        expect(display.visible).toBe(false)
        expect(tips.hoverPending).toBe(true)
        await wait(DELAY + 20)
        expect(display.text).toBe('law of A')
        expect(tips.shown).toBe('hover')
    })

    test('keep waiting while the pointer moves within the same element', async () => {
        const { tips, display } = tooltips()
        hover(tips, 'A')
        await wait(DELAY / 2)
        hover(tips, 'A')
        await wait(DELAY / 2 + 15)
        expect(display.text).toBe('law of A')
        hover(tips, 'A')
        expect(display.shows).toBe(1)
    })

    test("don't show if the pointer moves on sooner", async () => {
        const { tips, display } = tooltips()
        hover(tips, 'A')
        await wait(DELAY / 2)
        tips.cancelHover()
        await wait(DELAY + 20)
        expect(display.visible).toBe(false)
        expect(display.shows).toBe(0)
    })

    test('start waiting again on another element, hiding the first', async () => {
        const { tips, display } = tooltips()
        hover(tips, 'A')
        await wait(DELAY + 20)
        hover(tips, 'B')
        expect(display.visible).toBe(false)
        await wait(DELAY + 20)
        expect(display.text).toBe('law of B')
    })

    test("don't show, or wait, while suppressed, as when drawing a bond", async () => {
        const { tips, display } = tooltips()
        hover(tips, 'A')
        await wait(DELAY + 20)
        tips.suppress(true)
        expect(display.visible).toBe(false)
        hover(tips, 'B')
        expect(tips.hoverPending).toBe(false)
        expect(tips.show('annotation', 'note')).toBe(false)
        expect(tips.show('hover', 'law')).toBe(false)
        await wait(DELAY + 20)
        expect(display.visible).toBe(false)
        tips.suppress(false)
        hover(tips, 'B')
        await wait(DELAY + 20)
        expect(display.text).toBe('law of B')
    })

    test("don't show if suppressed while waiting", async () => {
        const { tips, display } = tooltips()
        hover(tips, 'A')
        tips.suppress(true)
        tips.suppress(false)
        await wait(DELAY + 20)
        expect(display.shows).toBe(0)
    })
})

describe('Errors', () => {
    test('show at once, above hover tooltips', async () => {
        const { tips, display } = tooltips()
        tips.show('error', 'Not allowed', 'error')
        expect(display.text).toBe('Not allowed')
        expect(display.content?.style).toBe('error')
        hover(tips, 'A')
        await wait(DELAY + 20)
        expect(display.text).toBe('Not allowed')
    })

    test('flash at a point for a while, then hide', async () => {
        const { tips, display } = tooltips()
        tips.flash('This is a reactants side', { x: 10, y: 20 }, 40)
        expect(display.text).toBe('This is a reactants side')
        expect(display.at).toEqual({ x: 10, y: 20 })
        expect(tips.flashing).toBe(true)
        tips.clear()
        expect(display.text).toBe('This is a reactants side')
        await wait(60)
        expect(display.visible).toBe(false)
        expect(tips.flashing).toBe(false)
    })

    test('flash even while hover tooltips are suppressed', () => {
        const { tips, display } = tooltips()
        tips.suppress(true)
        tips.flash('Refused', { x: 0, y: 0 }, 40)
        expect(display.text).toBe('Refused')
        tips.hide()
    })

    test('replacing a flashed message keeps the new one shown', async () => {
        const { tips, display } = tooltips()
        tips.flash('First', { x: 0, y: 0 }, 30)
        tips.show('error', 'Second', 'error')
        expect(display.at).toBeUndefined()
        await wait(50)
        expect(display.text).toBe('Second')
    })
})
