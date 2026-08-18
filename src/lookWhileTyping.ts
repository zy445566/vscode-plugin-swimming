export type LookWhileTypingScrollRequest = {
    firstVisibleLine: number;
    lastVisibleLine: number;
    lineCount: number;
    direction: -1 | 1;
    stepLines: number;
};

export type LookWhileTypingTargetReference = {
    documentUri: string;
    viewColumn: number | undefined;
};

export type LookWhileTypingDocumentRename = {
    oldUri: string;
    newUri: string;
};

export type LookWhileTypingControls = {
    scrollUpKey: string;
    scrollDownKey: string;
    closeTargetKey: string;
    reopenTargetKey: string;
};

export type LookWhileTypingAction = 'scrollUp' | 'scrollDown' | 'closeTarget' | 'reopenTarget';

export function getLookWhileTypingAction(
    typedText: string,
    controls: LookWhileTypingControls
) {
    const matchingActions: LookWhileTypingAction[] = [];

    if (typedText === controls.scrollUpKey) {
        matchingActions.push('scrollUp');
    }
    if (typedText === controls.scrollDownKey) {
        matchingActions.push('scrollDown');
    }
    if (typedText === controls.closeTargetKey) {
        matchingActions.push('closeTarget');
    }
    if (typedText === controls.reopenTargetKey) {
        matchingActions.push('reopenTarget');
    }

    return matchingActions.length === 1 ? matchingActions[0] : undefined;
}

export function getLookWhileTypingLabelPattern(relativePath: string) {
    return `**/${relativePath.replaceAll('\\', '/')}`;
}

export function getLookWhileTypingTargetLabel(
    relativePath: string,
    customLabel: string | undefined
) {
    return customLabel || relativePath;
}

export function getLookWhileTypingRenamedDocumentUri(
    documentUri: string,
    renames: LookWhileTypingDocumentRename[]
) {
    let renamedDocumentUri = documentUri;
    let hasChanged = false;

    for (const { oldUri, newUri } of renames) {
        if (renamedDocumentUri === oldUri) {
            renamedDocumentUri = newUri;
            hasChanged = true;
        } else if (renamedDocumentUri.startsWith(`${oldUri}/`)) {
            renamedDocumentUri = `${newUri}${renamedDocumentUri.slice(oldUri.length)}`;
            hasChanged = true;
        }
    }

    return hasChanged ? renamedDocumentUri : undefined;
}

export function isLookWhileTypingTarget(
    candidate: LookWhileTypingTargetReference,
    target: LookWhileTypingTargetReference
) {
    return candidate.documentUri === target.documentUri
        && candidate.viewColumn === target.viewColumn;
}

export function getLookWhileTypingScrollLine({
    firstVisibleLine,
    lastVisibleLine,
    lineCount,
    direction,
    stepLines,
}: LookWhileTypingScrollRequest) {
    if (lineCount <= 0) {
        return 0;
    }

    const lastDocumentLine = lineCount - 1;
    const firstLine = Math.min(Math.max(firstVisibleLine, 0), lastDocumentLine);
    const lastLine = Math.min(Math.max(lastVisibleLine, firstLine), lastDocumentLine);
    const visibleCenterLine = Math.floor((firstLine + lastLine) / 2);
    const normalizedStepLines = Math.max(1, Math.floor(stepLines));
    const nextLine = visibleCenterLine + direction * normalizedStepLines;

    return Math.min(Math.max(nextLine, 0), lastDocumentLine);
}

export type LookWhileTypingScrollMode = 'line' | 'cursor';

export type LookWhileTypingCursorScrollRequest = {
    firstVisibleLine: number;
    firstVisibleCharacter: number;
    lastVisibleLine: number;
    lastVisibleCharacter: number;
    lineCount: number;
    lastVisibleLineLength: number;
    direction: -1 | 1;
    stepLines: number;
};

export type LookWhileTypingScrollPosition = {
    line: number;
    character: number;
};

/**
 * Moves the target cursor just outside the current viewport. VS Code then
 * reveals that position by the minimum amount, including inside a wrapped
 * logical line where line-based movement would otherwise jump too far.
 */
export function getLookWhileTypingCursorScrollPosition({
    firstVisibleLine,
    firstVisibleCharacter,
    lastVisibleLine,
    lastVisibleCharacter,
    lineCount,
    lastVisibleLineLength,
    direction,
    stepLines,
}: LookWhileTypingCursorScrollRequest): LookWhileTypingScrollPosition {
    if (lineCount <= 0) {
        return { line: 0, character: 0 };
    }

    const lastDocumentLine = lineCount - 1;
    const normalizedStepLines = Math.max(1, Math.floor(stepLines));
    if (direction > 0) {
        if (lastVisibleCharacter < lastVisibleLineLength) {
            return {
                line: lastVisibleLine,
                character: lastVisibleCharacter + 1,
            };
        }

        const targetLine = Math.min(
            lastVisibleLine + normalizedStepLines,
            lastDocumentLine
        );
        if (targetLine === lastVisibleLine) {
            return { line: lastVisibleLine, character: lastVisibleCharacter };
        }
        return { line: targetLine, character: 0 };
    }

    if (firstVisibleCharacter > 0) {
        return {
            line: firstVisibleLine,
            character: firstVisibleCharacter - 1,
        };
    }

    const targetLine = Math.max(firstVisibleLine - normalizedStepLines, 0);
    if (targetLine === firstVisibleLine) {
        return { line: firstVisibleLine, character: firstVisibleCharacter };
    }
    return { line: targetLine, character: 0 };
}
