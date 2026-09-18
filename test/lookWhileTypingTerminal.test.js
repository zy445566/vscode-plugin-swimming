const assert = require('node:assert/strict');
const test = require('node:test');

const {
    getLookWhileTypingCoverTransition,
    getLookWhileTypingCloseTargetKind,
    getLookWhileTypingInputTokens,
    getLookWhileTypingRestoreTransition,
    getLookWhileTypingTargetKind,
    getLookWhileTypingTerminalInputSequence,
    getLookWhileTypingTerminalScrollCommand,
} = require('../out/lookWhileTyping');

const controls = {
    scrollUpKey: '-',
    scrollDownKey: '=',
    closeTargetKey: '\\',
    reopenTargetKey: '`',
};

test('maps Look While Typing terminal scrolling to VS Code terminal commands', () => {
    assert.equal(
        getLookWhileTypingTerminalScrollCommand(-1),
        'workbench.action.terminal.scrollUp'
    );
    assert.equal(
        getLookWhileTypingTerminalScrollCommand(1),
        'workbench.action.terminal.scrollDown'
    );
});

test('uses w3m screen scrolling keys instead of moving its link cursor', () => {
    assert.equal(
        getLookWhileTypingTerminalInputSequence(-1, 'w3m', 3),
        'KKK'
    );
    assert.equal(
        getLookWhileTypingTerminalInputSequence(1, 'w3m', 2),
        'JJ'
    );
});

test('maps terminal cursor and page navigation in the requested direction', () => {
    assert.equal(
        getLookWhileTypingTerminalInputSequence(-1, 'cursorKeys', 2),
        '\x1b[A\x1b[A'
    );
    assert.equal(
        getLookWhileTypingTerminalInputSequence(1, 'applicationCursorKeys', 2),
        '\x1bOB\x1bOB'
    );
    assert.equal(
        getLookWhileTypingTerminalInputSequence(-1, 'pageKeys', 5),
        '\x1b[5~'
    );
});

test('recognizes control keys when VS Code batches them with normal input', () => {
    assert.deepEqual(getLookWhileTypingInputTokens('a-=b', controls), [
        { text: 'a', action: undefined },
        { text: '-', action: 'scrollUp' },
        { text: '=', action: 'scrollDown' },
        { text: 'b', action: undefined },
    ]);
});

test('closes terminal targets even when they are displayed as editor tabs', () => {
    assert.equal(getLookWhileTypingCloseTargetKind(false, true), 'terminal');
    assert.equal(getLookWhileTypingCloseTargetKind(true, false), 'editor');
    assert.equal(getLookWhileTypingCloseTargetKind(false, false), undefined);
});

test('switches terminal scrolling to a cover editor and restores terminal routing', () => {
    assert.equal(getLookWhileTypingTargetKind(false, true), 'terminal');
    assert.deepEqual(getLookWhileTypingCoverTransition('terminal'), {
        activeTargetKind: 'editor',
        hiddenTargetKind: 'terminal',
    });
    assert.deepEqual(getLookWhileTypingRestoreTransition('terminal'), {
        activeTargetKind: 'terminal',
        hiddenTargetKind: undefined,
    });
    assert.equal(getLookWhileTypingTargetKind(true, false), 'editor');
});
