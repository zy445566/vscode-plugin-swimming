const assert = require('node:assert/strict');
const test = require('node:test');

const {
    advanceShadowSession,
    canUseGenericShadowTyping,
    commitShadowSessionEdit,
    getGhostTextForCursor,
    getShadowInputCharacters,
    isShadowPrefixAligned,
    KeyedAsyncQueue,
    shouldAbandonShadowSession,
} = require('../out/shadowInline');

test('shows the next line ghost text after a line break', () => {
    const session = {
        beforeText: 'first\n\tsecond()',
        index: 5,
        line: 0,
        character: 5,
    };

    advanceShadowSession(session, '\n');

    assert.deepEqual(
        { index: session.index, line: session.line, character: session.character },
        { index: 6, line: 1, character: 0 }
    );
    assert.equal(
        getGhostTextForCursor(session, { line: 1, character: 0 }),
        '\tsecond()'
    );
});

test('shows the next line ghost text after a CRLF line break', () => {
    const session = {
        beforeText: 'first\r\nsecond()',
        index: 5,
        line: 0,
        character: 5,
    };

    advanceShadowSession(session, '\r\n');

    assert.deepEqual(
        { index: session.index, line: session.line, character: session.character },
        { index: 7, line: 1, character: 0 }
    );
    assert.equal(
        getGhostTextForCursor(session, { line: 1, character: 0 }),
        'second()'
    );
});

test('checks alignment against the session prefix instead of a stale editor selection', () => {
    const session = {
        beforeText: 'first\nsecond()',
        index: 6,
        line: 1,
        character: 0,
    };

    assert.equal(isShadowPrefixAligned(session, 'first\n'), true);
    assert.equal(isShadowPrefixAligned(session, 'first'), false);
});

test('abandons unrecoverable shadow drift but keeps recoverable overflow for Backspace', () => {
    const session = {
        beforeText: 'abc',
        index: 1,
        line: 0,
        character: 1,
    };

    assert.equal(
        shouldAbandonShadowSession(session, '', true),
        true
    );
    assert.equal(
        shouldAbandonShadowSession(session, 'a中', false),
        false
    );
    assert.equal(
        shouldAbandonShadowSession(session, 'a', false),
        true
    );
});

test('blocks generic typing while manual line breaks or indentation are required', () => {
    assert.equal(
        canUseGenericShadowTyping({
            requiresManualProgression: true,
            isExpectingLineBreak: true,
            requiresManualIndentation: false,
        }),
        false
    );
    assert.equal(
        canUseGenericShadowTyping({
            requiresManualProgression: true,
            isExpectingLineBreak: false,
            requiresManualIndentation: true,
        }),
        false
    );
    assert.equal(
        canUseGenericShadowTyping({
            requiresManualProgression: true,
            isExpectingLineBreak: false,
            requiresManualIndentation: false,
        }),
        true
    );
});

test('serializes shadow input for the same editor', async () => {
    const queue = new KeyedAsyncQueue();
    const events = [];
    let releaseFirst;
    let markFirstStarted;
    const firstGate = new Promise((resolve) => {
        releaseFirst = resolve;
    });
    const firstStarted = new Promise((resolve) => {
        markFirstStarted = resolve;
    });

    const first = queue.enqueue('editor', async () => {
        events.push('first:start');
        markFirstStarted();
        await firstGate;
        events.push('first:end');
    });
    const second = queue.enqueue('editor', async () => {
        events.push('second');
    });

    await firstStarted;
    assert.deepEqual(events, ['first:start']);

    releaseFirst();
    await Promise.all([first, second]);
    assert.deepEqual(events, ['first:start', 'first:end', 'second']);
});

test('advances the shadow session only after an edit succeeds', () => {
    const session = {
        beforeText: 'abc',
        index: 0,
        line: 0,
        character: 0,
    };

    assert.equal(commitShadowSessionEdit(session, 'a', false), false);
    assert.deepEqual(
        { index: session.index, line: session.line, character: session.character },
        { index: 0, line: 0, character: 0 }
    );

    assert.equal(commitShadowSessionEdit(session, 'a', true), true);
    assert.deepEqual(
        { index: session.index, line: session.line, character: session.character },
        { index: 1, line: 0, character: 1 }
    );
});

test('splits a batched type event into individual target advances', () => {
    assert.deepEqual(getShadowInputCharacters('abc'), ['a', 'b', 'c']);
});
