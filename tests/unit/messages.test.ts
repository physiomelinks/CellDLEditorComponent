// With the status bar hidden, the editor's alerts reach the host as `message` events

import { describe, expect, test } from 'bun:test'

import { editor } from './support/editor'

import type { EditorMessage } from '#editor/editor'
import { alert } from '#editor/editor/alerts'

//==============================================================================

describe('alerts', () => {
    test('reach the host\'s message handler, and their clearing once', () => {
        const messages: EditorMessage[] = []
        editor.setMessageHandler(message => messages.push(message))
        try {
            alert.error('Bad species')
            alert.clear()
            alert.clear()
            alert.warn('Careful')
            expect(messages).toEqual([
                { text: 'Bad species', level: 'error' },
                { text: '', level: '' },
                { text: 'Careful', level: 'warn' }
            ])
        } finally {
            editor.setMessageHandler(null)
            alert.clear()
        }
    })
})
