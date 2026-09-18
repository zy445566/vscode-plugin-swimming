const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const { shouldContinueRewrite } = require('../out/shadowInline');

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
