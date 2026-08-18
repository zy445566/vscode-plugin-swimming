export type ShadowInlineSession = {
    beforeText: string;
    index: number;
    line: number;
    character: number;
};

export type ShadowCursor = {
    line: number;
    character: number;
};

export type ShadowGenericTypingPolicy = {
    requiresManualProgression: boolean;
    isExpectingLineBreak: boolean;
    requiresManualIndentation: boolean;
};

export class KeyedAsyncQueue {
    private readonly tails = new Map<string, Promise<void>>();

    enqueue<T>(key: string, task: () => Promise<T> | T): Promise<T> {
        const previous = this.tails.get(key) ?? Promise.resolve();
        const result = previous.catch(() => undefined).then(task);
        const tail = result.then(() => undefined, () => undefined);

        this.tails.set(key, tail);
        void tail.then(() => {
            if (this.tails.get(key) === tail) {
                this.tails.delete(key);
            }
        });

        return result;
    }
}

export function advanceShadowSession(
    session: ShadowInlineSession,
    insertedText: string
) {
    session.index += insertedText.length;

    const insertedLines = insertedText.split(/\r?\n/);
    if (insertedLines.length === 1) {
        session.character += insertedText.length;
        return;
    }

    session.line += insertedLines.length - 1;
    session.character = insertedLines[insertedLines.length - 1].length;
}

export function commitShadowSessionEdit(
    session: ShadowInlineSession,
    insertedText: string,
    isEdited: boolean
) {
    if (!isEdited) {
        return false;
    }

    advanceShadowSession(session, insertedText);
    return true;
}

export function getShadowInputCharacters(typedText: string) {
    return [...typedText];
}

export function getCurrentShadowLineRemainder(session: ShadowInlineSession) {
    const fromCurrentLine = session.beforeText.slice(session.index);
    const lineBreakIndex = fromCurrentLine.search(/\r?\n/);
    if (lineBreakIndex === -1) {
        return fromCurrentLine;
    }

    return fromCurrentLine.slice(0, lineBreakIndex);
}

export function getGhostTextForCursor(
    session: ShadowInlineSession,
    cursor: ShadowCursor
) {
    if (session.line !== cursor.line || session.character !== cursor.character) {
        return '';
    }

    return getCurrentShadowLineRemainder(session);
}

export function isShadowPrefixAligned(
    session: ShadowInlineSession,
    actualPrefix: string
) {
    return actualPrefix === session.beforeText.slice(0, session.index);
}

export function shouldAbandonShadowSession(
    session: ShadowInlineSession,
    actualPrefix: string,
    cursorAtSessionPosition: boolean
) {
    const expectedPrefix = session.beforeText.slice(0, session.index);
    const hasRecoverableOverflow = actualPrefix.startsWith(expectedPrefix)
        && actualPrefix.length > expectedPrefix.length;

    return !hasRecoverableOverflow
        && (actualPrefix !== expectedPrefix || !cursorAtSessionPosition);
}

export function canUseGenericShadowTyping(
    policy: ShadowGenericTypingPolicy
) {
    if (!policy.requiresManualProgression) {
        return true;
    }

    return !policy.isExpectingLineBreak && !policy.requiresManualIndentation;
}
