const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const {
    shouldAbandonShadowSessionAfterSelectionChange,
    shouldContinueRewrite,
} = require('../out/shadowInline');

test('abandons Shadow Rewriting when the cursor leaves the session position', () => {
    const session = {
        beforeText: 'target',
        index: 2,
        line: 4,
        character: 7,
    };

    assert.equal(
        shouldAbandonShadowSessionAfterSelectionChange(session, [{ line: 4, character: 7 }]),
        false
    );
    assert.equal(
        shouldAbandonShadowSessionAfterSelectionChange(
            session,
            [{ line: 4, character: 8 }],
            true
        ),
        true
    );
    assert.equal(
        shouldAbandonShadowSessionAfterSelectionChange(session, [
            { line: 4, character: 7 },
            { line: 5, character: 0 },
        ], true),
        true
    );
    assert.equal(
        shouldAbandonShadowSessionAfterSelectionChange(
            session,
            [{ line: 4, character: 8 }],
            false
        ),
        false
    );
});

test('stops scheduled rewriting after the active state is cleared', () => {
    assert.equal(shouldContinueRewrite(true, false), true);
    assert.equal(shouldContinueRewrite(false, false), false);
    assert.equal(shouldContinueRewrite(undefined, false), false);
    assert.equal(shouldContinueRewrite(true, true), false);
});

test('closes code rewriting without reloading the VS Code window', () => {
    const extensionSource = fs.readFileSync(
        path.resolve(__dirname, '..', 'src', 'extension.ts'),
        'utf8'
    );
    const closeFunction = extensionSource.match(
        /function closeWriteCode[\s\S]*?\n}\n\nfunction pauseWriteCode/
    );

    assert.ok(closeFunction, 'closeWriteCode implementation was not found');
    assert.doesNotMatch(closeFunction[0], /reloadWindow/);
});
