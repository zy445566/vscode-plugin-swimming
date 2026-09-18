const assert = require('node:assert/strict');
const test = require('node:test');

const { createHumanRewritePlan } = require('../out/humanRewrite');

test('types three or four word prefixes before completing each word', () => {
    assert.deepEqual(
        createHumanRewritePlan('example', () => 0).map(({ text }) => text),
        ['e', 'x', 'a', 'mple']
    );
    assert.deepEqual(
        createHumanRewritePlan('example', () => 1).map(({ text }) => text),
        ['e', 'x', 'a', 'm', 'ple']
    );
});

test('uses typing delays for letters and a thinking pause after spaces', () => {
    assert.deepEqual(createHumanRewritePlan('word next', () => 0), [
        { text: 'w', delayAfter: 250 },
        { text: 'o', delayAfter: 250 },
        { text: 'r', delayAfter: 250 },
        { text: 'd', delayAfter: 250 },
        { text: ' ', delayAfter: 750 },
        { text: 'n', delayAfter: 250 },
        { text: 'e', delayAfter: 250 },
        { text: 'x', delayAfter: 250 },
        { text: 't', delayAfter: 250 },
    ]);
    assert.deepEqual(createHumanRewritePlan('()', () => 1), [
        { text: '()', delayAfter: 350 },
    ]);
    assert.deepEqual(createHumanRewritePlan('\n    value', () => 0)[0], {
        text: '\n    ',
        delayAfter: 250,
    });
});
