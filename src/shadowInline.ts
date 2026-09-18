export type ShadowInlineSession = {
    beforeText: string;
    index: number;
    line: number;
    character: number;
    anchorOffset?: number;
};

export type ShadowCursor = {
    line: number;
    character: number;
};

export type ShadowContentChange = {
    rangeOffset: number;
    rangeLength: number;
    text: string;
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
    if (typeof session.anchorOffset === 'number') {
        session.anchorOffset += insertedText.length;
    }

    const insertedLines = insertedText.split(/\r?\n/);
    if (insertedLines.length === 1) {
        session.character += insertedText.length;
        return;
    }

    session.line += insertedLines.length - 1;
    session.character = insertedLines[insertedLines.length - 1].length;
}

export function shouldUseShadowInput(
    session: ShadowInlineSession,
    cursors: readonly ShadowCursor[]
) {
    return cursors.length === 1
        && cursors[0].line === session.line
        && cursors[0].character === session.character;
}

export function transformShadowAnchorOffset(
    anchorOffset: number,
    changes: readonly ShadowContentChange[]
) {
    let offsetDelta = 0;
    const orderedChanges = [...changes].sort((left, right) => {
        return left.rangeOffset - right.rangeOffset;
    });

    for (const change of orderedChanges) {
        const rangeEnd = change.rangeOffset + change.rangeLength;
        const isBeforeAnchor = rangeEnd < anchorOffset
            || (rangeEnd === anchorOffset && change.rangeOffset < anchorOffset);
        if (isBeforeAnchor) {
            offsetDelta += change.text.length - change.rangeLength;
            continue;
        }

        if (change.rangeOffset < anchorOffset && rangeEnd > anchorOffset) {
            return change.rangeOffset + offsetDelta + change.text.length;
        }
    }

    return anchorOffset + offsetDelta;
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

export function shouldContinueRewrite(
    isWriting: boolean | undefined,
    documentIsClosed: boolean
) {
    return isWriting === true && !documentIsClosed;
}

export function canUseGenericShadowTyping(
    policy: ShadowGenericTypingPolicy
) {
    if (!policy.requiresManualProgression) {
        return true;
    }

    return !policy.isExpectingLineBreak && !policy.requiresManualIndentation;
}
