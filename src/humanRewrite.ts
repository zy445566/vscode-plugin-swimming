export type HumanRewriteAction = {
    text: string;
    delayAfter: number;
};

const TYPING_DELAY_MIN = 250;
const TYPING_DELAY_MAX = 350;
const THINKING_DELAY_MIN = 750;
const THINKING_DELAY_MAX = 1250;

const adjacentPairs: Record<string, string> = {
    '(': ')',
    '[': ']',
    '{': '}',
    '"': '"',
    "'": "'",
    '`': '`',
};

function randomInteger(
    minimum: number,
    maximum: number,
    random: () => number
) {
    const randomValue = Math.min(1, Math.max(0, random()));
    return Math.round(minimum + (maximum - minimum) * randomValue);
}

function getTypingDelay(random: () => number) {
    return randomInteger(TYPING_DELAY_MIN, TYPING_DELAY_MAX, random);
}

function addAction(
    actions: HumanRewriteAction[],
    text: string,
    delayAfter: number
) {
    if (text) {
        actions.push({ text, delayAfter });
    }
}

export function createHumanRewritePlan(
    targetText: string,
    random: () => number = Math.random
) {
    const actions: HumanRewriteAction[] = [];
    let index = 0;

    while (index < targetText.length) {
        const remainingText = targetText.slice(index);
        const lineBreakMatch = remainingText.match(/^(?:\r\n|\n)[\t ]*/);
        if (lineBreakMatch) {
            addAction(actions, lineBreakMatch[0], getTypingDelay(random));
            index += lineBreakMatch[0].length;
            continue;
        }

        const wordMatch = remainingText.match(/^[\p{L}\p{N}_$]+/u);
        if (wordMatch) {
            const characters = [...wordMatch[0]];
            const requestedPrefixLength = random() < 0.5 ? 3 : 4;
            const prefixLength = Math.min(requestedPrefixLength, characters.length);
            for (let characterIndex = 0; characterIndex < prefixLength; characterIndex += 1) {
                addAction(actions, characters[characterIndex], getTypingDelay(random));
            }
            addAction(
                actions,
                characters.slice(prefixLength).join(''),
                getTypingDelay(random)
            );
            index += wordMatch[0].length;
            continue;
        }

        const firstCharacter = String.fromCodePoint(targetText.codePointAt(index) ?? 0);
        if (firstCharacter === ' ') {
            addAction(
                actions,
                firstCharacter,
                randomInteger(THINKING_DELAY_MIN, THINKING_DELAY_MAX, random)
            );
            index += firstCharacter.length;
            continue;
        }

        const expectedPair = adjacentPairs[firstCharacter];
        if (expectedPair && targetText.startsWith(expectedPair, index + firstCharacter.length)) {
            addAction(actions, firstCharacter + expectedPair, getTypingDelay(random));
            index += firstCharacter.length + expectedPair.length;
            continue;
        }

        addAction(actions, firstCharacter, getTypingDelay(random));
        index += firstCharacter.length;
    }

    return actions;
}
