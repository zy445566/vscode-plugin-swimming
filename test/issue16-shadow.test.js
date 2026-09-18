const assert = require('node:assert/strict');
const test = require('node:test');

const {
    shouldUseShadowInput,
    transformShadowAnchorOffset,
} = require('../out/shadowInline');
const { getNextRoundRobinIndex } = require('../out/multiRewrite');

test('uses Shadow input only at the active anchor', () => {
    const session = {
        beforeText: 'target',
        index: 2,
        line: 3,
        character: 8,
        anchorOffset: 42,
    };

    assert.equal(
        shouldUseShadowInput(session, [{ line: 3, character: 8 }]),
        true
    );
    assert.equal(
        shouldUseShadowInput(session, [{ line: 3, character: 7 }]),
        false
    );
    assert.equal(
        shouldUseShadowInput(session, [
            { line: 3, character: 8 },
            { line: 4, character: 0 },
        ]),
        false
    );
});

test('moves the Shadow anchor with edits in completed regions', () => {
    assert.equal(
        transformShadowAnchorOffset(20, [{
            rangeOffset: 5,
            rangeLength: 0,
            text: 'hello',
        }]),
        25
    );
    assert.equal(
        transformShadowAnchorOffset(20, [{
            rangeOffset: 8,
            rangeLength: 4,
            text: '',
        }]),
        16
    );
    assert.equal(
        transformShadowAnchorOffset(20, [{
            rangeOffset: 20,
            rangeLength: 0,
            text: 'IME',
        }]),
        20
    );
});

test('places an anchor inside a replaced range after the replacement text', () => {
    assert.equal(
        transformShadowAnchorOffset(10, [{
            rangeOffset: 5,
            rangeLength: 10,
            text: 'new',
        }]),
        8
    );
});

test('cycles through eligible rewrite targets without selecting completed ones', () => {
    assert.equal(getNextRoundRobinIndex([true, true, true], 0), 0);
    assert.equal(getNextRoundRobinIndex([true, true, true], 2), 2);
    assert.equal(getNextRoundRobinIndex([true, false, true], 1), 2);
    assert.equal(getNextRoundRobinIndex([false, false], 0), undefined);
});
