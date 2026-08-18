const assert = require('node:assert/strict');
const test = require('node:test');

const {
    getLookWhileTypingAction,
    getLookWhileTypingLabelPattern,
    getLookWhileTypingRenamedDocumentUri,
    getLookWhileTypingCursorScrollPosition,
    getLookWhileTypingScrollLine,
    getLookWhileTypingTargetLabel,
    isLookWhileTypingTarget,
} = require('../out/lookWhileTyping');

test('moves the target editor from the visible center by the configured step', () => {
    assert.equal(
        getLookWhileTypingScrollLine({
            firstVisibleLine: 20,
            lastVisibleLine: 40,
            lineCount: 100,
            direction: 1,
            stepLines: 3,
        }),
        33
    );
    assert.equal(
        getLookWhileTypingScrollLine({
            firstVisibleLine: 20,
            lastVisibleLine: 40,
            lineCount: 100,
            direction: -1,
            stepLines: 3,
        }),
        27
    );
});

test('keeps the target scroll line inside the document', () => {
    assert.equal(
        getLookWhileTypingScrollLine({
            firstVisibleLine: 0,
            lastVisibleLine: 5,
            lineCount: 20,
            direction: -1,
            stepLines: 8,
        }),
        0
    );
    assert.equal(
        getLookWhileTypingScrollLine({
            firstVisibleLine: 15,
            lastVisibleLine: 19,
            lineCount: 20,
            direction: 1,
            stepLines: 8,
        }),
        19
    );
});

test('matches a close target by both document and editor group', () => {
    const target = { documentUri: 'file:///work.md', viewColumn: 2 };

    assert.equal(isLookWhileTypingTarget(target, target), true);
    assert.equal(
        isLookWhileTypingTarget(
            { documentUri: 'file:///work.md', viewColumn: 1 },
            target
        ),
        false
    );
    assert.equal(
        isLookWhileTypingTarget(
            { documentUri: 'file:///other.md', viewColumn: 2 },
            target
        ),
        false
    );
});

test('maps configured single-character Look While Typing controls', () => {
    const controls = {
        scrollUpKey: '-',
        scrollDownKey: '=',
        closeTargetKey: '\\',
        reopenTargetKey: '`',
    };

    assert.equal(getLookWhileTypingAction('-', controls), 'scrollUp');
    assert.equal(getLookWhileTypingAction('=', controls), 'scrollDown');
    assert.equal(getLookWhileTypingAction('\\', controls), 'closeTarget');
    assert.equal(getLookWhileTypingAction('`', controls), 'reopenTarget');
    assert.equal(getLookWhileTypingAction('x', controls), undefined);
    assert.equal(
        getLookWhileTypingAction('-', { ...controls, scrollDownKey: '-' }),
        undefined
    );
});

test('migrates a target document URI after file or folder workspace renames', () => {
    assert.equal(
        getLookWhileTypingRenamedDocumentUri('file:///work/old.ts', [{
            oldUri: 'file:///work/old.ts',
            newUri: 'file:///work/new.ts',
        }]),
        'file:///work/new.ts'
    );
    assert.equal(
        getLookWhileTypingRenamedDocumentUri('file:///work/old-folder/a.ts', [{
            oldUri: 'file:///work/old-folder',
            newUri: 'file:///work/new-folder',
        }]),
        'file:///work/new-folder/a.ts'
    );
    assert.equal(
        getLookWhileTypingRenamedDocumentUri('file:///work/other.ts', [{
            oldUri: 'file:///work/old.ts',
            newUri: 'file:///work/new.ts',
        }]),
        undefined
    );
});

test('prefers a custom working editor label in the target picker', () => {
    assert.equal(
        getLookWhileTypingTargetLabel('src/worker.ts', 'Review queue'),
        'Review queue'
    );
    assert.equal(
        getLookWhileTypingTargetLabel('src/worker.ts', undefined),
        'src/worker.ts'
    );
});

test('creates a workspace-relative pattern for the custom target tab label', () => {
    assert.equal(
        getLookWhileTypingLabelPattern('notes\\review.md'),
        '**/notes/review.md'
    );
});

test('cursor mode moves just outside the visible edge for multi-line ranges', () => {
    assert.deepEqual(
        getLookWhileTypingCursorScrollPosition({
            firstVisibleLine: 20,
            firstVisibleCharacter: 0,
            lastVisibleLine: 40,
            lastVisibleCharacter: 0,
            lineCount: 100,
            lastVisibleLineLength: 50,
            direction: 1,
            stepLines: 3,
        }),
        { line: 40, character: 1 }
    );
    assert.deepEqual(
        getLookWhileTypingCursorScrollPosition({
            firstVisibleLine: 20,
            firstVisibleCharacter: 0,
            lastVisibleLine: 40,
            lastVisibleCharacter: 0,
            lineCount: 100,
            lastVisibleLineLength: 50,
            direction: -1,
            stepLines: 3,
        }),
        { line: 17, character: 0 }
    );
});

test('cursor mode moves just beyond the visible end of a long wrapped line', () => {
    assert.deepEqual(
        getLookWhileTypingCursorScrollPosition({
            firstVisibleLine: 5,
            firstVisibleCharacter: 200,
            lastVisibleLine: 5,
            lastVisibleCharacter: 650,
            lineCount: 10,
            lastVisibleLineLength: 2000,
            direction: 1,
            stepLines: 3,
        }),
        { line: 5, character: 651 }
    );
});

test('cursor mode moves just before the visible start of a long wrapped line', () => {
    assert.deepEqual(
        getLookWhileTypingCursorScrollPosition({
            firstVisibleLine: 5,
            firstVisibleCharacter: 600,
            lastVisibleLine: 5,
            lastVisibleCharacter: 1050,
            lineCount: 10,
            lastVisibleLineLength: 2000,
            direction: -1,
            stepLines: 3,
        }),
        { line: 5, character: 599 }
    );
});

test('cursor mode advances to the next line when a wrapped line reaches its end', () => {
    assert.deepEqual(
        getLookWhileTypingCursorScrollPosition({
            firstVisibleLine: 5,
            firstVisibleCharacter: 0,
            lastVisibleLine: 5,
            lastVisibleCharacter: 2000,
            lineCount: 10,
            lastVisibleLineLength: 2000,
            direction: 1,
            stepLines: 3,
        }),
        { line: 8, character: 0 }
    );
});

test('cursor mode retreats to the previous line when a wrapped line reaches its start', () => {
    assert.deepEqual(
        getLookWhileTypingCursorScrollPosition({
            firstVisibleLine: 5,
            firstVisibleCharacter: 0,
            lastVisibleLine: 5,
            lastVisibleCharacter: 450,
            lineCount: 10,
            lastVisibleLineLength: 2000,
            direction: -1,
            stepLines: 3,
        }),
        { line: 2, character: 0 }
    );
});

test('cursor mode moves a single-line document by the minimum visible amount', () => {
    assert.deepEqual(
        getLookWhileTypingCursorScrollPosition({
            firstVisibleLine: 0,
            firstVisibleCharacter: 0,
            lastVisibleLine: 0,
            lastVisibleCharacter: 500,
            lineCount: 1,
            lastVisibleLineLength: 2000,
            direction: 1,
            stepLines: 3,
        }),
        { line: 0, character: 501 }
    );
});

test('cursor mode does not jump back to the top when already at the document bottom', () => {
    assert.deepEqual(
        getLookWhileTypingCursorScrollPosition({
            firstVisibleLine: 0,
            firstVisibleCharacter: 1500,
            lastVisibleLine: 0,
            lastVisibleCharacter: 2000,
            lineCount: 1,
            lastVisibleLineLength: 2000,
            direction: 1,
            stepLines: 3,
        }),
        { line: 0, character: 2000 }
    );
    assert.deepEqual(
        getLookWhileTypingCursorScrollPosition({
            firstVisibleLine: 0,
            firstVisibleCharacter: 0,
            lastVisibleLine: 0,
            lastVisibleCharacter: 500,
            lineCount: 1,
            lastVisibleLineLength: 2000,
            direction: -1,
            stepLines: 3,
        }),
        { line: 0, character: 0 }
    );
});

test('cursor mode clamps the line nudge inside the document', () => {
    assert.deepEqual(
        getLookWhileTypingCursorScrollPosition({
            firstVisibleLine: 15,
            firstVisibleCharacter: 0,
            lastVisibleLine: 19,
            lastVisibleCharacter: 10,
            lineCount: 20,
            lastVisibleLineLength: 10,
            direction: 1,
            stepLines: 8,
        }),
        { line: 19, character: 10 }
    );
    assert.deepEqual(
        getLookWhileTypingCursorScrollPosition({
            firstVisibleLine: 0,
            firstVisibleCharacter: 0,
            lastVisibleLine: 5,
            lastVisibleCharacter: 0,
            lineCount: 20,
            lastVisibleLineLength: 10,
            direction: -1,
            stepLines: 8,
        }),
        { line: 0, character: 0 }
    );
});
