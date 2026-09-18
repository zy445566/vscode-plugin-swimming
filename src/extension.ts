import {
    CancellationToken,
    commands,
    ConfigurationTarget,
    ExtensionContext,
    InlineCompletionContext,
    InlineCompletionItem,
    InlineCompletionItemProvider,
    languages,
    l10n,
    Position,
    Range,
    Selection,
    TabGroup,
    TabInputTerminal,
    TabInputText,
    Terminal,
    TextEditor,
    TextEditorEdit,
    TextEditorRevealType,
    TextDocument,
    Uri,
    window,
    workspace,
} from 'vscode';
import {
    canUseGenericShadowTyping as canUseGenericShadowTypingPolicy,
    commitShadowSessionEdit,
    getCurrentShadowLineRemainder,
    getGhostTextForCursor,
    getShadowInputCharacters,
    KeyedAsyncQueue,
    shouldContinueRewrite,
    shouldUseShadowInput,
    transformShadowAnchorOffset,
} from './shadowInline';
import {
    getLookWhileTypingAction,
    getLookWhileTypingCoverTransition,
    getLookWhileTypingCloseTargetKind,
    getLookWhileTypingInputTokens,
    getLookWhileTypingLabelPattern,
    getLookWhileTypingRenamedDocumentUri,
    getLookWhileTypingRestoreTransition,
    getLookWhileTypingCursorScrollPosition,
    getLookWhileTypingScrollLine,
    getLookWhileTypingTerminalInputSequence,
    getLookWhileTypingTerminalScrollCommand,
    getLookWhileTypingTargetLabel,
    getLookWhileTypingTargetKind,
    isLookWhileTypingTarget,
    LookWhileTypingTerminalNavigationMode,
} from './lookWhileTyping';
import {
    createHumanRewritePlan,
    HumanRewriteAction,
} from './humanRewrite';
import { getNextRoundRobinIndex } from './multiRewrite';

const TYPE_COMMAND = 'type';
const DEFAULT_TYPE_COMMAND = 'default:type';
const DEFAULT_DELETE_LEFT_COMMAND = 'deleteLeft';
const DEFAULT_TAB_COMMAND = 'tab';
const SHADOW_CONTEXT = 'vscodePluginSwimming.shadowActive';
const SHADOW_DELETE_LEFT_COMMAND = 'extension.swimming.shadowDeleteLeft';
const SHADOW_ENTER_COMMAND = 'extension.swimming.shadowEnter';
const SHADOW_TAB_COMMAND = 'extension.swimming.shadowTab';
const LOOK_WHILE_TYPING_CONTEXT = 'vscodePluginSwimming.lookWhileTypingTargetVisible';
const LOOK_WHILE_TYPING_EDITOR_CONTEXT = 'vscodePluginSwimming.lookWhileTypingEditorTargetVisible';
const LOOK_WHILE_TYPING_CLOSED_TARGET_CONTEXT = 'vscodePluginSwimming.lookWhileTypingClosedTargetAvailable';
const LOOK_WHILE_TYPING_TARGET_STATE_KEY = 'lookWhileTyping.target';
const LOOK_WHILE_TYPING_CLOSED_TARGET_STATE_KEY = 'lookWhileTyping.closedTarget';
const LOOK_WHILE_TYPING_TERMINAL_STATE_KEY = 'lookWhileTyping.terminalName';
const LOOK_WHILE_TYPING_COVER_TARGET_STATE_KEY = 'lookWhileTyping.coverTarget';
const LOOK_WHILE_TYPING_HIDDEN_TARGET_STATE_KEY = 'lookWhileTyping.hiddenTarget';
const LOOK_WHILE_TYPING_HIDDEN_TERMINAL_STATE_KEY = 'lookWhileTyping.hiddenTerminalName';
const LOOK_WHILE_TYPING_SELECT_TARGET_COMMAND = 'extension.swimming.selectLookWhileTypingTarget';
const LOOK_WHILE_TYPING_SELECT_COVER_COMMAND = 'extension.swimming.selectLookWhileTypingCoverEditor';
const LOOK_WHILE_TYPING_CLEAR_TARGET_COMMAND = 'extension.swimming.clearLookWhileTypingTarget';
const LOOK_WHILE_TYPING_SCROLL_UP_COMMAND = 'extension.swimming.scrollLookWhileTypingUp';
const LOOK_WHILE_TYPING_SCROLL_DOWN_COMMAND = 'extension.swimming.scrollLookWhileTypingDown';
const LOOK_WHILE_TYPING_CLOSE_TARGET_COMMAND = 'extension.swimming.closeLookWhileTypingTarget';
const LOOK_WHILE_TYPING_REOPEN_TARGET_COMMAND = 'extension.swimming.reopenLookWhileTypingTarget';
const LOOK_WHILE_TYPING_RENAME_TARGET_COMMAND = 'extension.swimming.renameLookWhileTypingTarget';
const INLINE_SUGGEST_TRIGGER_COMMAND = 'editor.action.inlineSuggest.trigger';
const INLINE_SUGGEST_HIDE_COMMAND = 'editor.action.inlineSuggest.hide';

type RewriteSession = {
    beforeText: string;
    index: number;
    line: number;
    character: number;
    initLine: number;
    initCharacter: number;
    anchorOffset: number;
    initAnchorOffset: number;
    humanActions?: HumanRewriteAction[];
    humanActionIndex?: number;
};

type LookWhileTypingTarget = {
    documentUri: string;
    viewColumn: number | undefined;
    customLabel?: string;
    customLabelPattern?: string;
    hadPreviousCustomLabel?: boolean;
    previousCustomLabel?: string;
    didEnableCustomLabels?: boolean;
    previousCustomLabelsEnabled?: boolean;
};

type EditorRewriteTarget = {
    textEditor: TextEditor;
    session: RewriteSession;
};

function getShadowRequireSymbolKey() {
    const requireSymbolKey = workspace
        .getConfiguration()
        .get<boolean>('vscodePluginSwimming.shadowRequireShiftForSymbols');

    return typeof requireSymbolKey === 'boolean' ? requireSymbolKey : true;
}

function getShadowShowInlineSuggestion() {
    const showInlineSuggestion = workspace
        .getConfiguration()
        .get<boolean>('vscodePluginSwimming.shadowShowInlineSuggestion');

    return typeof showInlineSuggestion === 'boolean' ? showInlineSuggestion : true;
}

function getShadowRequireManualLineBreaksAndIndentation() {
    const requireManualLineBreaks = workspace
        .getConfiguration()
        .get<boolean>('vscodePluginSwimming.shadowRequireManualLineBreaksAndIndentation');

    return typeof requireManualLineBreaks === 'boolean' ? requireManualLineBreaks : false;
}

function getLookWhileTypingStepLines() {
    const configuredStepLines = workspace
        .getConfiguration()
        .get<number>('vscodePluginSwimming.lookWhileTypingStepLines');

    return typeof configuredStepLines === 'number' ? configuredStepLines : 3;
}

function getLookWhileTypingScrollMode() {
    const configuredMode = workspace
        .getConfiguration()
        .get<string>('vscodePluginSwimming.lookWhileTypingScrollMode');

    return configuredMode === 'cursor' ? 'cursor' : 'line';
}

function getLookWhileTypingTerminalNavigationMode() {
    const configuredMode = workspace
        .getConfiguration()
        .get<LookWhileTypingTerminalNavigationMode>(
            'vscodePluginSwimming.lookWhileTypingTerminalNavigationMode'
        );
    switch (configuredMode) {
        case 'w3m':
        case 'cursorKeys':
        case 'applicationCursorKeys':
        case 'pageKeys':
        case 'scrollback':
            return configuredMode;

        default:
            return 'w3m';
    }
}

function getLookWhileTypingControlKey(
    configurationKey: string,
    fallbackKey: string
) {
    const configuredKey = workspace
        .getConfiguration()
        .get<string>(configurationKey);

    return typeof configuredKey === 'string' && [...configuredKey].length === 1
        ? configuredKey
        : fallbackKey;
}

function getLookWhileTypingControls() {
    return {
        scrollUpKey: getLookWhileTypingControlKey(
            'vscodePluginSwimming.lookWhileTypingScrollUpKey',
            '-'
        ),
        scrollDownKey: getLookWhileTypingControlKey(
            'vscodePluginSwimming.lookWhileTypingScrollDownKey',
            '='
        ),
        closeTargetKey: getLookWhileTypingControlKey(
            'vscodePluginSwimming.lookWhileTypingCloseTargetKey',
            '\\'
        ),
        reopenTargetKey: getLookWhileTypingControlKey(
            'vscodePluginSwimming.lookWhileTypingReopenTargetKey',
            '`'
        ),
    };
}

enum RewriteMode {
    Cycle = 'cycle',
    Once = 'once',
}

function getRewriteMode(): RewriteMode {
    const nowRewriteMode = workspace
        .getConfiguration()
        .get<RewriteMode>('vscodePluginSwimming.rewriteMode');
    return nowRewriteMode || RewriteMode.Once;
}

function setRewriteMode(nowRewriteMode: RewriteMode) {
    return workspace
        .getConfiguration()
        .update('vscodePluginSwimming.rewriteMode', nowRewriteMode);
}

const isWriteCodePauseMap: Map<string, boolean> = new Map();
const isWritingCodeMap: Map<string, boolean> = new Map();
const shadowSessionMap: Map<string, RewriteSession> = new Map();
const shadowInputQueue = new KeyedAsyncQueue();
const shadowProgrammaticEditKeys = new Set<string>();
let lookWhileTypingTarget: LookWhileTypingTarget | undefined;
let lastClosedLookWhileTypingTarget: LookWhileTypingTarget | undefined;
let lookWhileTypingTerminal: Terminal | undefined;
let lookWhileTypingTerminalName: string | undefined;
let lookWhileTypingCoverTarget: LookWhileTypingTarget | undefined;
let hiddenLookWhileTypingTarget: LookWhileTypingTarget | undefined;
let hiddenLookWhileTypingTerminal: Terminal | undefined;
let hiddenLookWhileTypingTerminalName: string | undefined;
let inlineSuggestionRefreshTimer: NodeJS.Timeout | undefined;
let shadowRoundRobinOrder: string[] = [];
let shadowRoundRobinIndex = 0;

function getEditorKey(textEditor: TextEditor) {
    return textEditor.document.uri.toString();
}

function getSelectedRewriteEditors(activeTextEditor: TextEditor) {
    const selectedEditors = window.visibleTextEditors.filter((textEditor, index, editors) => {
        return !textEditor.selection.isEmpty
            && editors.findIndex((candidate) => {
                return getEditorKey(candidate) === getEditorKey(textEditor);
            }) === index;
    });

    return selectedEditors.length > 1 ? selectedEditors : [activeTextEditor];
}

function getLookWhileTypingTargetEditor() {
    if (!lookWhileTypingTarget) {
        return undefined;
    }

    return window.visibleTextEditors.find((textEditor) => {
        return getEditorKey(textEditor) === lookWhileTypingTarget?.documentUri
            && textEditor.viewColumn === lookWhileTypingTarget?.viewColumn;
    });
}

function getLookWhileTypingTargetTerminal() {
    if (lookWhileTypingTerminal && window.terminals.includes(lookWhileTypingTerminal)) {
        return lookWhileTypingTerminal;
    }
    lookWhileTypingTerminal = window.terminals.find((terminal) => {
        return terminal.name === lookWhileTypingTerminalName;
    });
    return lookWhileTypingTerminal;
}

function getHiddenLookWhileTypingTerminal() {
    if (
        hiddenLookWhileTypingTerminal
        && window.terminals.includes(hiddenLookWhileTypingTerminal)
    ) {
        return hiddenLookWhileTypingTerminal;
    }
    hiddenLookWhileTypingTerminal = window.terminals.find((terminal) => {
        return terminal.name === hiddenLookWhileTypingTerminalName;
    });
    return hiddenLookWhileTypingTerminal;
}

function clearHiddenLookWhileTypingTarget() {
    hiddenLookWhileTypingTarget = undefined;
    hiddenLookWhileTypingTerminal = undefined;
    hiddenLookWhileTypingTerminalName = undefined;
}

function getLookWhileTypingTargetTabGroup(): TabGroup | undefined {
    if (lookWhileTypingTarget) {
        return window.tabGroups.all.find((tabGroup) => {
            return tabGroup.viewColumn === lookWhileTypingTarget?.viewColumn;
        });
    }

    const targetTerminal = getLookWhileTypingTargetTerminal();
    if (!targetTerminal) {
        return undefined;
    }

    const terminalGroups = window.tabGroups.all.filter((tabGroup) => {
        return tabGroup.tabs.some((tab) => tab.input instanceof TabInputTerminal);
    });
    const targetGroups = terminalGroups.filter((tabGroup) => {
        return tabGroup.tabs.some((tab) => {
            return tab.input instanceof TabInputTerminal
                && tab.label === targetTerminal.name;
        });
    });

    return targetGroups.find((tabGroup) => {
        return tabGroup.isActive;
    }) ?? targetGroups[0] ?? terminalGroups[0];
}

function getLookWhileTypingCoverCandidates() {
    const target = lookWhileTypingTarget;
    const coveredDocumentUris = new Set<string>();

    return window.tabGroups.all.flatMap((tabGroup) => {
        return tabGroup.tabs.flatMap((tab) => {
            if (!(tab.input instanceof TabInputText)) {
                return [];
            }

            const documentUri = tab.input.uri.toString();
            if (
                coveredDocumentUris.has(documentUri)
                || (target && isLookWhileTypingTarget({
                    documentUri,
                    viewColumn: tabGroup.viewColumn,
                }, target))
            ) {
                return [];
            }

            coveredDocumentUris.add(documentUri);
            return [{ tab, tabGroup }];
        });
    });
}

function updateLookWhileTypingContext() {
    const targetEditor = getLookWhileTypingTargetEditor();
    const targetTerminal = getLookWhileTypingTargetTerminal();
    void commands.executeCommand(
        'setContext',
        LOOK_WHILE_TYPING_CONTEXT,
        Boolean(targetEditor || targetTerminal)
    );
    void commands.executeCommand(
        'setContext',
        LOOK_WHILE_TYPING_EDITOR_CONTEXT,
        Boolean(targetEditor)
    );
    void commands.executeCommand(
        'setContext',
        LOOK_WHILE_TYPING_CLOSED_TARGET_CONTEXT,
        Boolean(
            lastClosedLookWhileTypingTarget
            || hiddenLookWhileTypingTarget
            || getHiddenLookWhileTypingTerminal()
        )
    );
}

async function persistLookWhileTypingTargets(context: ExtensionContext) {
    await context.workspaceState.update(
        LOOK_WHILE_TYPING_TARGET_STATE_KEY,
        lookWhileTypingTarget
    );
    await context.workspaceState.update(
        LOOK_WHILE_TYPING_CLOSED_TARGET_STATE_KEY,
        lastClosedLookWhileTypingTarget
    );
    await context.workspaceState.update(
        LOOK_WHILE_TYPING_TERMINAL_STATE_KEY,
        lookWhileTypingTerminalName
    );
    await context.workspaceState.update(
        LOOK_WHILE_TYPING_COVER_TARGET_STATE_KEY,
        lookWhileTypingCoverTarget
    );
    await context.workspaceState.update(
        LOOK_WHILE_TYPING_HIDDEN_TARGET_STATE_KEY,
        hiddenLookWhileTypingTarget
    );
    await context.workspaceState.update(
        LOOK_WHILE_TYPING_HIDDEN_TERMINAL_STATE_KEY,
        hiddenLookWhileTypingTerminalName
    );
}

function getLookWhileTypingCustomLabelPattern(target: LookWhileTypingTarget) {
    const targetUri = Uri.parse(target.documentUri);
    if (!workspace.getWorkspaceFolder(targetUri)) {
        return undefined;
    }

    return getLookWhileTypingLabelPattern(
        workspace.asRelativePath(targetUri, false)
    );
}

async function restoreLookWhileTypingCustomLabel(target: LookWhileTypingTarget) {
    if (!target.customLabelPattern) {
        return;
    }

    const targetUri = Uri.parse(target.documentUri);
    const editorConfiguration = workspace.getConfiguration('workbench.editor', targetUri);
    const currentPatterns = editorConfiguration.get<Record<string, string>>(
        'customLabels.patterns'
    ) ?? {};
    if (currentPatterns[target.customLabelPattern] === target.customLabel) {
        const restoredPatterns = { ...currentPatterns };
        if (target.hadPreviousCustomLabel) {
            restoredPatterns[target.customLabelPattern] = target.previousCustomLabel ?? '';
        } else {
            delete restoredPatterns[target.customLabelPattern];
        }
        await editorConfiguration.update(
            'customLabels.patterns',
            restoredPatterns,
            ConfigurationTarget.Workspace
        );
    }

    if (target.didEnableCustomLabels) {
        await editorConfiguration.update(
            'customLabels.enabled',
            target.previousCustomLabelsEnabled,
            ConfigurationTarget.Workspace
        );
    }

    target.customLabelPattern = undefined;
    target.hadPreviousCustomLabel = undefined;
    target.previousCustomLabel = undefined;
    target.didEnableCustomLabels = undefined;
    target.previousCustomLabelsEnabled = undefined;
}

async function applyLookWhileTypingCustomLabel(target: LookWhileTypingTarget) {
    if (!target.customLabel) {
        return true;
    }

    const labelPattern = getLookWhileTypingCustomLabelPattern(target);
    if (!labelPattern) {
        return false;
    }

    const targetUri = Uri.parse(target.documentUri);
    const editorConfiguration = workspace.getConfiguration('workbench.editor', targetUri);
    const currentPatterns = editorConfiguration.get<Record<string, string>>(
        'customLabels.patterns'
    ) ?? {};
    target.customLabelPattern = labelPattern;
    target.hadPreviousCustomLabel = Object.hasOwn(currentPatterns, labelPattern);
    target.previousCustomLabel = currentPatterns[labelPattern];
    await editorConfiguration.update(
        'customLabels.patterns',
        { ...currentPatterns, [labelPattern]: target.customLabel },
        ConfigurationTarget.Workspace
    );

    const customLabelsEnabled = editorConfiguration.get<boolean>('customLabels.enabled');
    if (!customLabelsEnabled) {
        const inspectedCustomLabels = editorConfiguration.inspect<boolean>(
            'customLabels.enabled'
        );
        target.didEnableCustomLabels = true;
        target.previousCustomLabelsEnabled = inspectedCustomLabels?.workspaceValue;
        await editorConfiguration.update(
            'customLabels.enabled',
            true,
            ConfigurationTarget.Workspace
        );
    }

    return true;
}

async function updateLookWhileTypingTargetAfterWorkspaceRename(
    context: ExtensionContext,
    renamedFiles: readonly { oldUri: Uri; newUri: Uri }[]
) {
    const renames = renamedFiles.map(({ oldUri, newUri }) => {
        return {
            oldUri: oldUri.toString(),
            newUri: newUri.toString(),
        };
    });
    const targets = [
        lookWhileTypingTarget,
        lastClosedLookWhileTypingTarget,
        lookWhileTypingCoverTarget,
        hiddenLookWhileTypingTarget,
    ]
        .filter((target): target is LookWhileTypingTarget => Boolean(target));
    let hasUpdatedTarget = false;

    for (const target of targets) {
        const renamedDocumentUri = getLookWhileTypingRenamedDocumentUri(
            target.documentUri,
            renames
        );
        if (!renamedDocumentUri) {
            continue;
        }

        await restoreLookWhileTypingCustomLabel(target);
        target.documentUri = renamedDocumentUri;
        if (target.customLabel && !await applyLookWhileTypingCustomLabel(target)) {
            target.customLabel = undefined;
        }
        hasUpdatedTarget = true;
    }

    if (hasUpdatedTarget) {
        await persistLookWhileTypingTargets(context);
        updateLookWhileTypingContext();
    }
}

async function selectLookWhileTypingTarget(context: ExtensionContext) {
    const activeTextEditor = window.activeTextEditor;
    const targetEditors = window.visibleTextEditors.filter((textEditor) => {
        return textEditor !== activeTextEditor;
    });
    const targetTerminals = window.terminals;

    if (!targetEditors.length && !targetTerminals.length) {
        return window.showWarningMessage(
            l10n.t('Open a working editor or terminal before selecting it.')
        );
    }

    const selectedTarget = await window.showQuickPick(
        [
            ...targetEditors.map((textEditor) => {
            const relativePath = workspace.asRelativePath(textEditor.document.uri, false);
            const selectedTarget = [lookWhileTypingTarget, lastClosedLookWhileTypingTarget]
                .find((target) => {
                    return target?.documentUri === getEditorKey(textEditor)
                        && target.viewColumn === textEditor.viewColumn;
                });
            return {
                targetType: 'editor' as const,
                label: getLookWhileTypingTargetLabel(
                    relativePath,
                    selectedTarget?.customLabel
                ),
                description: l10n.t(
                    '{0} (Editor group {1})',
                    relativePath,
                    textEditor.viewColumn ?? l10n.t('unknown')
                ),
                textEditor,
            };
            }),
            ...targetTerminals.map((terminal) => ({
                targetType: 'terminal' as const,
                label: `$(terminal) ${terminal.name}`,
                description: l10n.t('Terminal'),
                terminal,
            })),
        ],
        { placeHolder: l10n.t('Select the editor or terminal to scroll while you type.') }
    );

    if (!selectedTarget) {
        return;
    }

    if (lookWhileTypingTarget) {
        await restoreLookWhileTypingCustomLabel(lookWhileTypingTarget);
    }
    if (lastClosedLookWhileTypingTarget) {
        await restoreLookWhileTypingCustomLabel(lastClosedLookWhileTypingTarget);
    }
    if (hiddenLookWhileTypingTarget) {
        await restoreLookWhileTypingCustomLabel(hiddenLookWhileTypingTarget);
    }
    clearHiddenLookWhileTypingTarget();
    if (selectedTarget.targetType === 'terminal') {
        lookWhileTypingTarget = undefined;
        lastClosedLookWhileTypingTarget = undefined;
        lookWhileTypingTerminal = selectedTarget.terminal;
        lookWhileTypingTerminalName = selectedTarget.terminal.name;
        await persistLookWhileTypingTargets(context);
        updateLookWhileTypingContext();
        return window.showInformationMessage(l10n.t('Look While Typing terminal selected.'));
    }

    lookWhileTypingTerminal = undefined;
    lookWhileTypingTerminalName = undefined;
    lookWhileTypingTarget = {
        documentUri: getEditorKey(selectedTarget.textEditor),
        viewColumn: selectedTarget.textEditor.viewColumn,
    };
    lastClosedLookWhileTypingTarget = undefined;
    await persistLookWhileTypingTargets(context);
    updateLookWhileTypingContext();
    return window.showInformationMessage(l10n.t('Look While Typing target selected.'));
}

async function selectLookWhileTypingCoverEditor(context: ExtensionContext) {
    const targetKind = getLookWhileTypingTargetKind(
        Boolean(getLookWhileTypingTargetEditor()),
        Boolean(getLookWhileTypingTargetTerminal())
    );
    if (!targetKind) {
        return window.showInformationMessage(
            l10n.t('Select a Look While Typing target before choosing a cover editor.')
        );
    }
    if (hiddenLookWhileTypingTarget || getHiddenLookWhileTypingTerminal()) {
        return window.showInformationMessage(
            l10n.t('Restore the hidden Look While Typing target before choosing another cover editor.')
        );
    }

    const candidates = getLookWhileTypingCoverCandidates();
    if (!candidates.length) {
        return window.showWarningMessage(
            l10n.t('Open a text editor before choosing it as the cover editor.')
        );
    }

    const selectedCandidate = await window.showQuickPick(
        candidates.map(({ tab, tabGroup }) => {
            const input = tab.input as TabInputText;
            const relativePath = workspace.asRelativePath(input.uri, false);
            return {
                label: tab.label,
                description: l10n.t(
                    '{0} (Editor group {1})',
                    relativePath,
                    tabGroup.viewColumn ?? l10n.t('unknown')
                ),
                documentUri: input.uri.toString(),
                viewColumn: tabGroup.viewColumn,
            };
        }),
        {
            placeHolder: l10n.t('Select the editor to display when the working target is hidden.'),
        }
    );
    if (!selectedCandidate) {
        return;
    }

    lookWhileTypingCoverTarget = {
        documentUri: selectedCandidate.documentUri,
        viewColumn: selectedCandidate.viewColumn,
    };
    await persistLookWhileTypingTargets(context);
    return window.showInformationMessage(l10n.t('Look While Typing cover editor selected.'));
}

async function clearLookWhileTypingTarget(context: ExtensionContext) {
    if (lookWhileTypingTarget) {
        await restoreLookWhileTypingCustomLabel(lookWhileTypingTarget);
    }
    if (hiddenLookWhileTypingTarget) {
        await restoreLookWhileTypingCustomLabel(hiddenLookWhileTypingTarget);
    }
    lookWhileTypingTarget = undefined;
    lastClosedLookWhileTypingTarget = undefined;
    lookWhileTypingTerminal = undefined;
    lookWhileTypingTerminalName = undefined;
    clearHiddenLookWhileTypingTarget();
    await persistLookWhileTypingTargets(context);
    updateLookWhileTypingContext();
}

function scrollLookWhileTyping(direction: -1 | 1) {
    const targetTextEditor = getLookWhileTypingTargetEditor();
    if (!targetTextEditor) {
        updateLookWhileTypingContext();
        return;
    }

    const visibleRange = targetTextEditor.visibleRanges[0];
    if (!visibleRange) {
        return;
    }

    const stepLines = getLookWhileTypingStepLines();

    if (getLookWhileTypingScrollMode() === 'cursor') {
        const lastVisibleLine = visibleRange.end.line;
        const lastVisibleLineLength = lastVisibleLine < targetTextEditor.document.lineCount
            ? targetTextEditor.document.lineAt(lastVisibleLine).text.length
            : 0;
        const scrollTarget = getLookWhileTypingCursorScrollPosition({
            firstVisibleLine: visibleRange.start.line,
            firstVisibleCharacter: visibleRange.start.character,
            lastVisibleLine,
            lastVisibleCharacter: visibleRange.end.character,
            lineCount: targetTextEditor.document.lineCount,
            lastVisibleLineLength,
            direction,
            stepLines,
        });
        const targetPosition = new Position(scrollTarget.line, scrollTarget.character);
        targetTextEditor.selection = new Selection(targetPosition, targetPosition);
        targetTextEditor.revealRange(
            new Range(targetPosition, targetPosition),
            TextEditorRevealType.Default
        );
        return;
    }

    const targetLine = getLookWhileTypingScrollLine({
        firstVisibleLine: visibleRange.start.line,
        lastVisibleLine: visibleRange.end.line,
        lineCount: targetTextEditor.document.lineCount,
        direction,
        stepLines,
    });
    const targetPosition = new Position(targetLine, 0);
    targetTextEditor.selection = new Selection(targetPosition, targetPosition);
    targetTextEditor.revealRange(
        new Range(targetPosition, targetPosition),
        TextEditorRevealType.InCenter
    );
}

async function scrollLookWhileTypingTerminal(direction: -1 | 1) {
    const targetTerminal = getLookWhileTypingTargetTerminal();
    if (!targetTerminal) {
        updateLookWhileTypingContext();
        return;
    }

    targetTerminal.show(true);
    const mode = getLookWhileTypingTerminalNavigationMode();

    if (mode === 'scrollback') {
        await commands.executeCommand(
            getLookWhileTypingTerminalScrollCommand(direction)
        );
        return;
    }
    const sequence = getLookWhileTypingTerminalInputSequence(
        direction,
        mode,
        getLookWhileTypingStepLines()
    );

    targetTerminal.sendText(sequence, false);
}

async function scrollLookWhileTypingTarget(direction: -1 | 1) {
    const targetKind = getLookWhileTypingTargetKind(
        Boolean(getLookWhileTypingTargetEditor()),
        Boolean(getLookWhileTypingTargetTerminal())
    );
    if (targetKind === 'terminal') {
        await scrollLookWhileTypingTerminal(direction);
        return;
    }
    if (targetKind === 'editor') {
        scrollLookWhileTyping(direction);
    }
}

function getLookWhileTypingTargetTab() {
    const target = lookWhileTypingTarget;
    if (!target) {
        return undefined;
    }

    const targetTabGroup = window.tabGroups.all.find((tabGroup) => {
        return tabGroup.viewColumn === target.viewColumn;
    });

    return targetTabGroup?.tabs.find((tab) => {
        if (!(tab.input instanceof TabInputText)) {
            return false;
        }

        return isLookWhileTypingTarget({
            documentUri: tab.input.uri.toString(),
            viewColumn: tab.group.viewColumn,
        }, target);
    });
}

async function hideLookWhileTypingTargetWithCover(context: ExtensionContext) {
    const coverTarget = lookWhileTypingCoverTarget;
    const activeTarget = lookWhileTypingTarget;
    const targetEditor = getLookWhileTypingTargetEditor();
    const targetTerminal = getLookWhileTypingTargetTerminal();
    const targetKind = getLookWhileTypingTargetKind(
        Boolean(targetEditor),
        Boolean(targetTerminal)
    );
    if (!coverTarget || !targetKind) {
        return false;
    }
    if (hiddenLookWhileTypingTarget || getHiddenLookWhileTypingTerminal()) {
        return true;
    }

    const targetTabGroup = getLookWhileTypingTargetTabGroup();
    if (!targetTabGroup) {
        await window.showWarningMessage(
            l10n.t('The working target must be displayed in an editor group before it can be covered.')
        );
        return true;
    }

    try {
        const coverEditor = await window.showTextDocument(
            Uri.parse(coverTarget.documentUri),
            {
                viewColumn: targetTabGroup.viewColumn,
                preserveFocus: true,
                preview: false,
            }
        );
        const transition = getLookWhileTypingCoverTransition(targetKind);
        lookWhileTypingCoverTarget = {
            ...coverTarget,
            viewColumn: coverEditor.viewColumn,
        };
        lookWhileTypingTarget = lookWhileTypingCoverTarget;
        lookWhileTypingTerminal = undefined;
        lookWhileTypingTerminalName = undefined;

        if (transition.hiddenTargetKind === 'terminal') {
            hiddenLookWhileTypingTarget = undefined;
            hiddenLookWhileTypingTerminal = targetTerminal;
            hiddenLookWhileTypingTerminalName = targetTerminal?.name;
        } else {
            hiddenLookWhileTypingTarget = activeTarget;
            hiddenLookWhileTypingTerminal = undefined;
            hiddenLookWhileTypingTerminalName = undefined;
        }
        await persistLookWhileTypingTargets(context);
        updateLookWhileTypingContext();
        return true;
    } catch {
        await window.showWarningMessage(
            l10n.t('The selected cover editor could not be opened.')
        );
        return true;
    }
}

async function closeLookWhileTypingTarget(context: ExtensionContext) {
    const target = lookWhileTypingTarget;
    const targetTab = getLookWhileTypingTargetTab();
    if (!target || !targetTab) {
        updateLookWhileTypingContext();
        return;
    }

    const isClosed = await window.tabGroups.close(targetTab, true);
    if (isClosed) {
        lookWhileTypingTarget = undefined;
        lastClosedLookWhileTypingTarget = target;
        await persistLookWhileTypingTargets(context);
        updateLookWhileTypingContext();
    }
}

async function closeLookWhileTypingTerminal(context: ExtensionContext) {
    const targetTerminal = getLookWhileTypingTargetTerminal();
    if (!targetTerminal) {
        updateLookWhileTypingContext();
        return;
    }

    lookWhileTypingTerminal = undefined;
    lookWhileTypingTerminalName = undefined;
    targetTerminal.dispose();
    await persistLookWhileTypingTargets(context);
    updateLookWhileTypingContext();
}

async function closeOrHideLookWhileTypingTarget(context: ExtensionContext) {
    if (lookWhileTypingCoverTarget) {
        await hideLookWhileTypingTargetWithCover(context);
        return;
    }

    const closeTargetKind = getLookWhileTypingCloseTargetKind(
        Boolean(getLookWhileTypingTargetEditor()),
        Boolean(getLookWhileTypingTargetTerminal())
    );
    if (closeTargetKind === 'terminal') {
        await closeLookWhileTypingTerminal(context);
    } else if (closeTargetKind === 'editor') {
        await closeLookWhileTypingTarget(context);
    }
}

async function reopenLookWhileTypingTarget(context: ExtensionContext) {
    const hiddenTerminal = getHiddenLookWhileTypingTerminal();
    if (hiddenTerminal) {
        const transition = getLookWhileTypingRestoreTransition('terminal');
        hiddenTerminal.show(true);
        if (transition.activeTargetKind === 'terminal') {
            lookWhileTypingTarget = undefined;
            lookWhileTypingTerminal = hiddenTerminal;
            lookWhileTypingTerminalName = hiddenTerminal.name;
        }
        clearHiddenLookWhileTypingTarget();
        await persistLookWhileTypingTargets(context);
        updateLookWhileTypingContext();
        return;
    }

    const hiddenTarget = hiddenLookWhileTypingTarget;
    if (hiddenTarget) {
        try {
            const hiddenTextEditor = await window.showTextDocument(
                Uri.parse(hiddenTarget.documentUri),
                {
                    viewColumn: hiddenTarget.viewColumn,
                    preserveFocus: true,
                    preview: false,
                }
            );
            const transition = getLookWhileTypingRestoreTransition('editor');
            if (transition.activeTargetKind === 'editor') {
                hiddenTarget.viewColumn = hiddenTextEditor.viewColumn;
                lookWhileTypingTarget = hiddenTarget;
                lookWhileTypingTerminal = undefined;
                lookWhileTypingTerminalName = undefined;
            }
            clearHiddenLookWhileTypingTarget();
            await persistLookWhileTypingTargets(context);
            updateLookWhileTypingContext();
            return;
        } catch {
            return window.showWarningMessage(
                l10n.t('The hidden Look While Typing target could not be restored.')
            );
        }
    }

    const target = lastClosedLookWhileTypingTarget;
    if (!target) {
        return window.showInformationMessage(l10n.t('No closed Look While Typing target to reopen.'));
    }

    try {
        const targetTextEditor = await window.showTextDocument(
            Uri.parse(target.documentUri),
            {
                viewColumn: target.viewColumn,
                preserveFocus: true,
                preview: false,
            }
        );
        target.viewColumn = targetTextEditor.viewColumn;
        lookWhileTypingTarget = target;
        lastClosedLookWhileTypingTarget = undefined;
        await persistLookWhileTypingTargets(context);
        updateLookWhileTypingContext();
    } catch {
        return window.showWarningMessage(
            l10n.t('The closed Look While Typing target could not be reopened.')
        );
    }
}

async function renameLookWhileTypingTarget(context: ExtensionContext) {
    const target = lookWhileTypingTarget;
    if (!target) {
        return window.showInformationMessage(
            l10n.t('Select a Look While Typing target before naming it.')
        );
    }

    const customLabel = await window.showInputBox({
        prompt: l10n.t('Enter a custom label for the working editor. Leave empty to restore its file name.'),
        value: target.customLabel ?? '',
    });
    if (customLabel === undefined) {
        return;
    }

    await restoreLookWhileTypingCustomLabel(target);
    target.customLabel = customLabel.trim() || undefined;
    if (target.customLabel && !await applyLookWhileTypingCustomLabel(target)) {
        target.customLabel = undefined;
        return window.showWarningMessage(
            l10n.t('Custom working editor labels are available only for files in the workspace.')
        );
    }

    await persistLookWhileTypingTargets(context);
}

async function handleLookWhileTypingAction(
    context: ExtensionContext,
    action: ReturnType<typeof getLookWhileTypingAction>
) {
    if (action === 'reopenTarget') {
        await reopenLookWhileTypingTarget(context);
        return true;
    }
    const targetEditor = getLookWhileTypingTargetEditor();
    const targetTerminal = getLookWhileTypingTargetTerminal();
    if (!targetEditor && !targetTerminal) {
        return false;
    }
    if (action === 'scrollUp') {
        await scrollLookWhileTypingTarget(-1);
        return true;
    }
    if (action === 'scrollDown') {
        await scrollLookWhileTypingTarget(1);
        return true;
    }
    if (action === 'closeTarget') {
        await closeOrHideLookWhileTypingTarget(context);
        return true;
    }

    return false;
}

async function getUnhandledLookWhileTypingInput(
    context: ExtensionContext,
    typedText: string
) {
    let unhandledText = '';
    const inputTokens = getLookWhileTypingInputTokens(
        typedText,
        getLookWhileTypingControls()
    );

    for (const { text, action } of inputTokens) {
        if (!action || !await handleLookWhileTypingAction(context, action)) {
            unhandledText += text;
        }
    }

    return unhandledText;
}

function updateShadowContext() {
    void commands.executeCommand('setContext', SHADOW_CONTEXT, shadowSessionMap.size > 0);
}

function refreshInlineSuggestion() {
    if (inlineSuggestionRefreshTimer) {
        clearTimeout(inlineSuggestionRefreshTimer);
        inlineSuggestionRefreshTimer = undefined;
    }

    if (getShadowShowInlineSuggestion()) {
        inlineSuggestionRefreshTimer = setTimeout(() => {
            inlineSuggestionRefreshTimer = undefined;
            void commands.executeCommand(INLINE_SUGGEST_TRIGGER_COMMAND);
        }, 0);
        return;
    }

    void commands.executeCommand(INLINE_SUGGEST_HIDE_COMMAND);
}

function finishWriting(editorKey: string) {
    isWritingCodeMap.set(editorKey, false);
    isWriteCodePauseMap.delete(editorKey);
}

function clearShadowSession(editorKey: string) {
    shadowSessionMap.delete(editorKey);
    shadowRoundRobinOrder = shadowRoundRobinOrder.filter((key) => key !== editorKey);
    if (shadowRoundRobinOrder.length) {
        shadowRoundRobinIndex %= shadowRoundRobinOrder.length;
    } else {
        shadowRoundRobinIndex = 0;
    }
    finishWriting(editorKey);
    updateShadowContext();
    refreshInlineSuggestion();
}

function clearAllShadowSessions() {
    for (const editorKey of shadowSessionMap.keys()) {
        finishWriting(editorKey);
    }
    shadowSessionMap.clear();
    shadowRoundRobinOrder = [];
    shadowRoundRobinIndex = 0;
    updateShadowContext();
    refreshInlineSuggestion();
}

function getShadowInputTarget(sourceEditor: TextEditor) {
    const sourceSession = shadowSessionMap.get(getEditorKey(sourceEditor));
    if (!sourceSession || !canAdvanceShadowSession(sourceEditor, sourceSession)) {
        return undefined;
    }

    const targetEditors = shadowRoundRobinOrder.map((editorKey) => {
        return window.visibleTextEditors.find((textEditor) => {
            return getEditorKey(textEditor) === editorKey;
        });
    });
    const targetIndex = getNextRoundRobinIndex(
        shadowRoundRobinOrder.map((editorKey, index) => {
            const session = shadowSessionMap.get(editorKey);
            const textEditor = targetEditors[index];
            if (!session || !textEditor || !canAdvanceShadowSession(textEditor, session)) {
                return false;
            }
            return getRewriteMode() === RewriteMode.Cycle
                || session.index < session.beforeText.length;
        }),
        shadowRoundRobinIndex
    );
    if (targetIndex === undefined) {
        return undefined;
    }

    const editorKey = shadowRoundRobinOrder[targetIndex];
    const textEditor = targetEditors[targetIndex];
    const session = shadowSessionMap.get(editorKey);
    if (!textEditor || !session) {
        return undefined;
    }

    shadowRoundRobinIndex = (targetIndex + 1) % shadowRoundRobinOrder.length;
    if (session.index >= session.beforeText.length) {
        restartShadowCycleAtAnchor(session);
    }
    return { editorKey, textEditor, session };
}

function completeShadowGroupIfNeeded() {
    if (getRewriteMode() === RewriteMode.Cycle) {
        return;
    }

    const isComplete = shadowRoundRobinOrder.length > 0
        && shadowRoundRobinOrder.every((editorKey) => {
            const session = shadowSessionMap.get(editorKey);
            return !session || session.index >= session.beforeText.length;
        });
    if (isComplete) {
        clearAllShadowSessions();
    }
}

function handleShadowSelectionChange(
    textEditor: TextEditor,
    _selections: readonly Selection[]
) {
    const editorKey = getEditorKey(textEditor);
    if (!shadowSessionMap.has(editorKey)) {
        return;
    }

    refreshInlineSuggestion();
}

function handleShadowDocumentChange(
    document: TextDocument,
    contentChanges: readonly {
        rangeOffset: number;
        rangeLength: number;
        text: string;
    }[]
) {
    const editorKey = document.uri.toString();
    const session = shadowSessionMap.get(editorKey);
    if (!session || shadowProgrammaticEditKeys.has(editorKey)) {
        return;
    }

    session.anchorOffset = transformShadowAnchorOffset(
        session.anchorOffset,
        contentChanges
    );
    const anchor = document.positionAt(session.anchorOffset);
    session.line = anchor.line;
    session.character = anchor.character;
    refreshInlineSuggestion();
}

function showPauseinfo(textEditor: TextEditor) {
    if (isWriteCodePauseMap.get(getEditorKey(textEditor))) {
        window.showInformationMessage(l10n.t('Code rewriting is paused.'));
    }
}

function getSelectionRangeByStartAndEnd({
    start,
    end,
    textEditor,
}: {
    start: Position;
    end: Position;
    textEditor: TextEditor;
}) {
    let selectionRange = new Range(start, end);

    if (selectionRange.isEmpty) {
        const documentEnd = textEditor.document.lineAt(
            textEditor.document.lineCount - 1
        ).rangeIncludingLineBreak.end;
        selectionRange = new Range(new Position(0, 0), documentEnd);
    }
    return selectionRange;
}

function createRewriteSession(
    textEditor: TextEditor,
    selectionRange: Range
): RewriteSession {
    const anchorOffset = textEditor.document.offsetAt(selectionRange.start);
    return {
        beforeText: textEditor.document.getText(selectionRange),
        index: 0,
        line: selectionRange.start.line,
        character: selectionRange.start.character,
        initLine: selectionRange.start.line,
        initCharacter: selectionRange.start.character,
        anchorOffset,
        initAnchorOffset: anchorOffset,
    };
}

function initializeHumanRewritePlan(session: RewriteSession) {
    session.humanActions = createHumanRewritePlan(session.beforeText);
    session.humanActionIndex = 0;
}

function getCurrentHumanRewriteAction(session: RewriteSession) {
    if (!session.humanActions) {
        initializeHumanRewritePlan(session);
    }
    return session.humanActions?.[session.humanActionIndex ?? 0];
}

function getWrittenRange(session: RewriteSession) {
    return new Range(
        new Position(session.initLine, session.initCharacter),
        new Position(session.line, session.character)
    );
}

function getSessionPosition(session: RewriteSession) {
    return new Position(session.line, session.character);
}

function setEditorCursor(textEditor: TextEditor, position: Position) {
    textEditor.selection = new Selection(position, position);
}

function runShadowAwareEdit(
    textEditor: TextEditor,
    callback: (editBuilder: TextEditorEdit) => void
) {
    const editorKey = getEditorKey(textEditor);
    const hasShadowSession = shadowSessionMap.has(editorKey);
    if (hasShadowSession) {
        shadowProgrammaticEditKeys.add(editorKey);
    }

    return textEditor.edit(callback).then((isEdited) => {
        if (hasShadowSession) {
            shadowProgrammaticEditKeys.delete(editorKey);
        }
        return isEdited;
    }, (reason) => {
        if (hasShadowSession) {
            shadowProgrammaticEditKeys.delete(editorKey);
        }
        throw reason;
    });
}

function resetRewriteSession(textEditor: TextEditor, session: RewriteSession) {
    const writtenRange = getWrittenRange(session);
    return runShadowAwareEdit(textEditor, (editBuilder) => {
        editBuilder.delete(writtenRange);
    }).then((isEdited) => {
        if (isEdited) {
            session.index = 0;
            session.line = session.initLine;
            session.character = session.initCharacter;
            session.anchorOffset = session.initAnchorOffset;
            if (session.humanActions) {
                initializeHumanRewritePlan(session);
            }
            setEditorCursor(textEditor, getSessionPosition(session));
        }
        return isEdited;
    });
}

function restartShadowCycleAtAnchor(session: RewriteSession) {
    session.index = 0;
    session.initLine = session.line;
    session.initCharacter = session.character;
    session.initAnchorOffset = session.anchorOffset;
}

function revealCurrentPosition(textEditor: TextEditor, session: RewriteSession) {
    const nowPosition = new Position(session.line, session.character);
    textEditor.revealRange(
        new Range(nowPosition, nowPosition),
        TextEditorRevealType.InCenter
    );
    return nowPosition;
}

function writeNextTargetChunk(
    textEditor: TextEditor,
    session: RewriteSession,
    requestedTargetText?: string
) {
    const nowPosition = revealCurrentPosition(textEditor, session);
    let targetText = requestedTargetText ?? session.beforeText[session.index];

    if (requestedTargetText === undefined
        && session.beforeText.startsWith('\r\n', session.index)) {
        targetText = '\r\n';
    } else if (requestedTargetText === undefined
        && session.beforeText.startsWith('\n', session.index)) {
        targetText = '\n';
    }

    return runShadowAwareEdit(textEditor, (editBuilder) => {
        editBuilder.insert(nowPosition, targetText);
    }).then((isEdited) => {
        if (commitShadowSessionEdit(session, targetText, isEdited)) {
            setEditorCursor(textEditor, getSessionPosition(session));
        }
        return isEdited;
    });
}

function isSymbolCharacter(text: string) {
    return text.length > 0 && !/^[\p{L}\p{N}_\s]$/u.test(text);
}

function getCurrentShadowLineIndentationRemainder(session: RewriteSession) {
    const currentLineRemainder = getCurrentShadowLineRemainder(session);
    const indentationMatch = currentLineRemainder.match(/^[\t ]+/);
    return indentationMatch ? indentationMatch[0] : '';
}

function isExpectingLineBreak(session: RewriteSession) {
    return session.beforeText.startsWith('\r\n', session.index)
        || session.beforeText.startsWith('\n', session.index);
}

function getCurrentLineIndentUnit(textEditor: TextEditor, session: RewriteSession) {
    const indentationRemainder = getCurrentShadowLineIndentationRemainder(session);
    if (!indentationRemainder) {
        return '';
    }

    if (indentationRemainder[0] === '\t') {
        return '\t';
    }

    const tabSizeOption = textEditor.options.tabSize;
    const tabSize = typeof tabSizeOption === 'number' ? tabSizeOption : 4;
    if (indentationRemainder.length < tabSize) {
        return '';
    }

    return indentationRemainder.slice(0, tabSize);
}

function requiresManualIndentation(textEditor: TextEditor, session: RewriteSession) {
    if (!getShadowRequireManualLineBreaksAndIndentation()) {
        return false;
    }

    return getCurrentLineIndentUnit(textEditor, session).length > 0;
}

function canAdvanceShadowSession(textEditor: TextEditor, session: RewriteSession) {
    const cursors = textEditor.selections.map(({ active }) => ({
        line: active.line,
        character: active.character,
    }));
    return shouldUseShadowInput(session, cursors);
}

function insertTargetText(textEditor: TextEditor, session: RewriteSession, targetText: string) {
    if (!targetText) {
        return Promise.resolve(false);
    }

    const nowPosition = revealCurrentPosition(textEditor, session);
    return runShadowAwareEdit(textEditor, (editBuilder) => {
        editBuilder.insert(nowPosition, targetText);
    }).then((isEdited) => {
        if (commitShadowSessionEdit(session, targetText, isEdited)) {
            setEditorCursor(textEditor, getSessionPosition(session));
        }
        return isEdited;
    });
}

function canShadowTypeAdvance(typedText: string, session: RewriteSession) {
    if (session.beforeText.startsWith('\r\n', session.index)) {
        return true;
    }

    if (session.beforeText.startsWith('\n', session.index)) {
        return true;
    }

    const nextCharacter = session.beforeText[session.index];
    if (!isSymbolCharacter(nextCharacter)) {
        return typedText.length > 0;
    }

    if (!getShadowRequireSymbolKey()) {
        return typedText.length > 0;
    }

    return [...typedText].some((character) => isSymbolCharacter(character));
}

function canUseGenericShadowTyping(textEditor: TextEditor, session: RewriteSession) {
    return canUseGenericShadowTypingPolicy({
        requiresManualProgression: getShadowRequireManualLineBreaksAndIndentation(),
        isExpectingLineBreak: isExpectingLineBreak(session),
        requiresManualIndentation: requiresManualIndentation(textEditor, session),
    });
}

async function advanceShadowWithTypedInput(
    textEditor: TextEditor,
    shadowSession: RewriteSession,
    typedText: string
) {

    if (!canAdvanceShadowSession(textEditor, shadowSession)) {
        return;
    }

    if (!canUseGenericShadowTyping(textEditor, shadowSession)) {
        return;
    }

    if (!canShadowTypeAdvance(typedText, shadowSession)) {
        return;
    }

    const isEdited = await writeNextTargetChunk(textEditor, shadowSession);
    if (!isEdited) {
        return;
    }

    refreshInlineSuggestion();
}

async function handleShadowLineBreak(textEditor: TextEditor, shadowSession: RewriteSession) {
    if (!canAdvanceShadowSession(textEditor, shadowSession)) {
        return;
    }

    if (!isExpectingLineBreak(shadowSession)) {
        return;
    }

    const isEdited = await writeNextTargetChunk(textEditor, shadowSession);
    if (!isEdited) {
        return;
    }

    refreshInlineSuggestion();
}

async function handleShadowIndentation(textEditor: TextEditor, shadowSession: RewriteSession) {
    if (!canAdvanceShadowSession(textEditor, shadowSession)) {
        return;
    }

    const indentUnit = getCurrentLineIndentUnit(textEditor, shadowSession);
    if (!indentUnit) {
        return;
    }

    const isEdited = await insertTargetText(textEditor, shadowSession, indentUnit);
    if (!isEdited) {
        return;
    }

    refreshInlineSuggestion();
}

function rewriteCodeWithStartAndEnd({
    textEditor,
    edit,
}: {
    textEditor: TextEditor;
    edit: TextEditorEdit;
}) {
    const editorKey = getEditorKey(textEditor);
    const selectionRange = getSelectionRangeByStartAndEnd({
        start: textEditor.selection.start,
        end: textEditor.selection.end,
        textEditor,
    });
    const session = createRewriteSession(textEditor, selectionRange);
    initializeHumanRewritePlan(session);

    edit.delete(selectionRange);

    const recycleWrite = function(inputTimeout: NodeJS.Timeout) {
        clearTimeout(inputTimeout);
        finishWriting(editorKey);
    };

    const runWrite = function(delay: number) {
        const inputTimeout: NodeJS.Timeout = setTimeout(() => {
            if (!shouldContinueRewrite(
                isWritingCodeMap.get(editorKey),
                textEditor.document.isClosed
            )) {
                return recycleWrite(inputTimeout);
            }

            if (isWriteCodePauseMap.get(editorKey)) {
                return textEditor.edit(() => undefined)
                    .then(() => runWrite(delay), (reason) => {
                        recycleWrite(inputTimeout);
                        throw new Error(String(reason));
                    });
            }

            if (session.index >= session.beforeText.length) {
                if (getRewriteMode() === RewriteMode.Cycle) {
                    return resetRewriteSession(textEditor, session)
                        .then(() => {
                            const firstAction = getCurrentHumanRewriteAction(session);
                            runWrite(firstAction?.delayAfter ?? 250);
                        }, (reason) => {
                            recycleWrite(inputTimeout);
                            throw new Error(String(reason));
                        });
                }

                return recycleWrite(inputTimeout);
            }

            const action = getCurrentHumanRewriteAction(session);
            if (!action) {
                return recycleWrite(inputTimeout);
            }
            writeNextTargetChunk(textEditor, session, action.text)
                .then((isEdited) => {
                    if (isEdited) {
                        session.humanActionIndex = (session.humanActionIndex ?? 0) + 1;
                    }
                    runWrite(action.delayAfter);
                }, (reason) => {
                    recycleWrite(inputTimeout);
                    throw new Error(String(reason));
                });
        }, delay);
    };

    const firstAction = getCurrentHumanRewriteAction(session);
    runWrite(firstAction?.delayAfter ?? 250);
}

async function rewriteCodeAcrossEditors(textEditors: readonly TextEditor[]) {
    const targets: EditorRewriteTarget[] = textEditors.map((textEditor) => {
        const selectionRange = new Range(
            textEditor.selection.start,
            textEditor.selection.end
        );
        return {
            textEditor,
            session: createRewriteSession(textEditor, selectionRange),
        };
    });
    for (const target of targets) {
        initializeHumanRewritePlan(target.session);
    }

    if (targets.some(({ textEditor }) => isWritingCodeMap.get(getEditorKey(textEditor)))) {
        return window.showInformationMessage(l10n.t('Code rewriting is already in progress.'));
    }

    const preparedTargets: EditorRewriteTarget[] = [];
    for (const target of targets) {
        const editorKey = getEditorKey(target.textEditor);
        isWritingCodeMap.set(editorKey, true);
        isWriteCodePauseMap.set(editorKey, false);
        const isDeleted = await target.textEditor.edit((editBuilder) => {
            editBuilder.delete(new Range(
                target.textEditor.selection.start,
                target.textEditor.selection.end
            ));
        });
        if (!isDeleted) {
            finishWriting(editorKey);
            continue;
        }
        setEditorCursor(target.textEditor, getSessionPosition(target.session));
        preparedTargets.push(target);
    }

    let nextTargetIndex = 0;
    const runWrite = (delay: number) => {
        setTimeout(async () => {
            for (const target of preparedTargets) {
                const editorKey = getEditorKey(target.textEditor);
                if (target.textEditor.document.isClosed) {
                    finishWriting(editorKey);
                } else if (target.session.index >= target.session.beforeText.length
                    && getRewriteMode() === RewriteMode.Once) {
                    finishWriting(editorKey);
                }
            }

            const targetIndex = getNextRoundRobinIndex(
                preparedTargets.map(({ textEditor }) => {
                    const editorKey = getEditorKey(textEditor);
                    return isWritingCodeMap.get(editorKey) === true
                        && !isWriteCodePauseMap.get(editorKey);
                }),
                nextTargetIndex
            );
            if (targetIndex === undefined) {
                if (preparedTargets.some(({ textEditor }) => {
                    return isWritingCodeMap.get(getEditorKey(textEditor)) === true;
                })) {
                    runWrite(250);
                }
                return;
            }

            const target = preparedTargets[targetIndex];
            nextTargetIndex = (targetIndex + 1) % preparedTargets.length;
            if (target.session.index >= target.session.beforeText.length) {
                const isReset = await resetRewriteSession(target.textEditor, target.session);
                if (!isReset) {
                    finishWriting(getEditorKey(target.textEditor));
                    runWrite(250);
                    return;
                }
            }

            const action = getCurrentHumanRewriteAction(target.session);
            if (!action) {
                finishWriting(getEditorKey(target.textEditor));
                runWrite(250);
                return;
            }
            const isEdited = await writeNextTargetChunk(
                target.textEditor,
                target.session,
                action.text
            );
            if (isEdited) {
                target.session.humanActionIndex = (target.session.humanActionIndex ?? 0) + 1;
            }
            runWrite(action.delayAfter);
        }, delay);
    };

    const firstAction = preparedTargets.length
        ? getCurrentHumanRewriteAction(preparedTargets[0].session)
        : undefined;
    runWrite(firstAction?.delayAfter ?? 250);
}

function rewriteCode(
    textEditor: TextEditor,
    edit: TextEditorEdit,
    _args: any[]
) {
    const selectedEditors = getSelectedRewriteEditors(textEditor);
    if (selectedEditors.length > 1) {
        void rewriteCodeAcrossEditors(selectedEditors);
        return;
    }

    const editorKey = getEditorKey(textEditor);
    if (isWritingCodeMap.get(editorKey)) {
        return window.showInformationMessage(l10n.t('Code rewriting is already in progress.'));
    }

    isWritingCodeMap.set(editorKey, true);
    isWriteCodePauseMap.set(editorKey, false);
    rewriteCodeWithStartAndEnd({
        textEditor,
        edit,
    });
}

function shadowRewriteCode(
    textEditor: TextEditor,
    edit: TextEditorEdit,
    _args: any[]
) {
    const selectedEditors = getSelectedRewriteEditors(textEditor);
    if (selectedEditors.length > 1) {
        void shadowRewriteCodeAcrossEditors(selectedEditors);
        return;
    }

    const editorKey = getEditorKey(textEditor);
    if (isWritingCodeMap.get(editorKey)) {
        return window.showInformationMessage(l10n.t('Code rewriting is already in progress.'));
    }

    const selectionRange = getSelectionRangeByStartAndEnd({
        start: textEditor.selection.start,
        end: textEditor.selection.end,
        textEditor,
    });
    const session = createRewriteSession(textEditor, selectionRange);

    if (!session.beforeText) {
        return window.showInformationMessage(l10n.t('No code available for Shadow Rewriting.'));
    }

    edit.delete(selectionRange);
    shadowSessionMap.set(editorKey, session);
    shadowRoundRobinOrder = [editorKey];
    shadowRoundRobinIndex = 0;
    isWritingCodeMap.set(editorKey, true);
    isWriteCodePauseMap.set(editorKey, false);
    updateShadowContext();
    refreshInlineSuggestion();
    window.showInformationMessage(l10n.t('Shadow Rewriting started. Press Esc to exit.'));
}

async function shadowRewriteCodeAcrossEditors(textEditors: readonly TextEditor[]) {
    const targets = textEditors.map((textEditor) => {
        const selectionRange = new Range(
            textEditor.selection.start,
            textEditor.selection.end
        );
        return {
            textEditor,
            selectionRange,
            session: createRewriteSession(textEditor, selectionRange),
        };
    }).filter(({ session }) => session.beforeText.length > 0);

    if (!targets.length) {
        return window.showInformationMessage(l10n.t('No code available for Shadow Rewriting.'));
    }
    if (targets.some(({ textEditor }) => isWritingCodeMap.get(getEditorKey(textEditor)))) {
        return window.showInformationMessage(l10n.t('Code rewriting is already in progress.'));
    }

    const preparedKeys: string[] = [];
    for (const target of targets) {
        const isDeleted = await target.textEditor.edit((editBuilder) => {
            editBuilder.delete(target.selectionRange);
        });
        if (!isDeleted) {
            continue;
        }

        const editorKey = getEditorKey(target.textEditor);
        shadowSessionMap.set(editorKey, target.session);
        isWritingCodeMap.set(editorKey, true);
        isWriteCodePauseMap.set(editorKey, false);
        setEditorCursor(target.textEditor, getSessionPosition(target.session));
        preparedKeys.push(editorKey);
    }

    shadowRoundRobinOrder = preparedKeys;
    shadowRoundRobinIndex = 0;
    updateShadowContext();
    refreshInlineSuggestion();
    window.showInformationMessage(l10n.t(
        'Shadow Rewriting started across {0} editors. Press Esc to exit.',
        preparedKeys.length
    ));
}

function exitShadowRewrite() {
    const textEditor = window.activeTextEditor;
    if (!textEditor) {
        return;
    }

    const editorKey = getEditorKey(textEditor);
    if (!shadowSessionMap.has(editorKey)) {
        return;
    }

    if (shadowRoundRobinOrder.length > 1) {
        clearAllShadowSessions();
    } else {
        clearShadowSession(editorKey);
    }
    window.showInformationMessage(l10n.t('Shadow Rewriting stopped.'));
}

function closeWriteCode(
    _textEditor: TextEditor,
    _edit: TextEditorEdit,
    ..._args: any[]
) {
    clearAllShadowSessions();
    isWriteCodePauseMap.clear();
    isWritingCodeMap.clear();
}

function pauseWriteCode(
    textEditor: TextEditor,
    _edit: TextEditorEdit,
    ..._args: any[]
) {
    const editorKey = getEditorKey(textEditor);
    if (!isWritingCodeMap.get(editorKey)) {
        return window.showInformationMessage(
            l10n.t('Code rewriting is not active, so it cannot be paused.')
        );
    }
    const isPaused = !isWriteCodePauseMap.get(editorKey);
    if (shadowRoundRobinOrder.length > 1
        && shadowRoundRobinOrder.includes(editorKey)) {
        for (const targetKey of shadowRoundRobinOrder) {
            isWriteCodePauseMap.set(targetKey, isPaused);
        }
    } else {
        isWriteCodePauseMap.set(editorKey, isPaused);
    }
    showPauseinfo(textEditor);
}

async function switchWriteMode(
    _textEditor: TextEditor,
    _edit: TextEditorEdit,
    ..._args: any[]
) {
    let nowRewriteMode = getRewriteMode();
    if (nowRewriteMode === RewriteMode.Once) {
        nowRewriteMode = RewriteMode.Cycle;
    } else {
        nowRewriteMode = RewriteMode.Once;
    }
    await setRewriteMode(nowRewriteMode);
    window.showInformationMessage(l10n.t('Switched to {0} mode.', getRewriteMode()));
}

async function handleShadowType(
    context: ExtensionContext,
    args: { text?: string }
) {
    const textEditor = window.activeTextEditor;
    if (!textEditor) {
        return commands.executeCommand(DEFAULT_TYPE_COMMAND, args);
    }

    let typedText = typeof args.text === 'string' ? args.text : '';
    if (!typedText) {
        return;
    }

    typedText = await getUnhandledLookWhileTypingInput(context, typedText);
    if (!typedText) {
        return;
    }
    const unhandledArgs = { ...args, text: typedText };

    const editorKey = getEditorKey(textEditor);
    const sourceSession = shadowSessionMap.get(editorKey);

    if (!sourceSession || isWriteCodePauseMap.get(editorKey)) {
        return commands.executeCommand(DEFAULT_TYPE_COMMAND, unhandledArgs);
    }

    const queueKey = shadowRoundRobinOrder.length > 1 ? 'shadow:multi' : editorKey;
    return shadowInputQueue.enqueue(queueKey, async () => {
        if (shadowSessionMap.get(editorKey) !== sourceSession
            || isWriteCodePauseMap.get(editorKey)) {
            return commands.executeCommand(DEFAULT_TYPE_COMMAND, unhandledArgs);
        }

        if (textEditor.document.isClosed) {
            clearShadowSession(editorKey);
            return;
        }

        if (!canAdvanceShadowSession(textEditor, sourceSession)) {
            return commands.executeCommand(DEFAULT_TYPE_COMMAND, unhandledArgs);
        }

        const typedCharacters = getShadowInputCharacters(typedText);
        for (let index = 0; index < typedCharacters.length; index += 1) {
            if (!shadowSessionMap.has(editorKey)) {
                const remainingText = typedCharacters.slice(index).join('');
                return commands.executeCommand(DEFAULT_TYPE_COMMAND, { text: remainingText });
            }

            const target = getShadowInputTarget(textEditor);
            if (!target) {
                completeShadowGroupIfNeeded();
                const remainingText = typedCharacters.slice(index).join('');
                return commands.executeCommand(DEFAULT_TYPE_COMMAND, { text: remainingText });
            }
            await advanceShadowWithTypedInput(
                target.textEditor,
                target.session,
                typedCharacters[index]
            );
            completeShadowGroupIfNeeded();
        }
    });
}

async function handleShadowDeleteLeft() {
    const textEditor = window.activeTextEditor;
    if (!textEditor) {
        return;
    }

    const editorKey = getEditorKey(textEditor);
    const shadowSession = shadowSessionMap.get(editorKey);
    if (!shadowSession) {
        return commands.executeCommand(DEFAULT_DELETE_LEFT_COMMAND);
    }

    const queueKey = shadowRoundRobinOrder.length > 1 ? 'shadow:multi' : editorKey;
    return shadowInputQueue.enqueue(queueKey, async () => {
        if (shadowSessionMap.get(editorKey) !== shadowSession) {
            return commands.executeCommand(DEFAULT_DELETE_LEFT_COMMAND);
        }

        if (!canAdvanceShadowSession(textEditor, shadowSession)) {
            return commands.executeCommand(DEFAULT_DELETE_LEFT_COMMAND);
        }

        // Keep completed target text intact while the cursor is at the active anchor.
        return;
    });
}

async function handleShadowEnter() {
    const textEditor = window.activeTextEditor;
    if (!textEditor) {
        return;
    }

    const editorKey = getEditorKey(textEditor);
    const sourceSession = shadowSessionMap.get(editorKey);
    if (!sourceSession) {
        return commands.executeCommand(DEFAULT_TYPE_COMMAND, { text: '\n' });
    }

    const queueKey = shadowRoundRobinOrder.length > 1 ? 'shadow:multi' : editorKey;
    return shadowInputQueue.enqueue(queueKey, async () => {
        if (shadowSessionMap.get(editorKey) !== sourceSession) {
            return commands.executeCommand(DEFAULT_TYPE_COMMAND, { text: '\n' });
        }

        if (!canAdvanceShadowSession(textEditor, sourceSession)) {
            return commands.executeCommand(DEFAULT_TYPE_COMMAND, { text: '\n' });
        }

        const target = getShadowInputTarget(textEditor);
        if (!target) {
            completeShadowGroupIfNeeded();
            return commands.executeCommand(DEFAULT_TYPE_COMMAND, { text: '\n' });
        }

        if (!getShadowRequireManualLineBreaksAndIndentation()) {
            await advanceShadowWithTypedInput(target.textEditor, target.session, '\n');
            completeShadowGroupIfNeeded();
            return;
        }

        await handleShadowLineBreak(target.textEditor, target.session);
        completeShadowGroupIfNeeded();
    });
}

async function handleShadowTab() {
    const textEditor = window.activeTextEditor;
    if (!textEditor) {
        return;
    }

    const editorKey = getEditorKey(textEditor);
    const sourceSession = shadowSessionMap.get(editorKey);
    if (!sourceSession) {
        return commands.executeCommand(DEFAULT_TAB_COMMAND);
    }

    const queueKey = shadowRoundRobinOrder.length > 1 ? 'shadow:multi' : editorKey;
    return shadowInputQueue.enqueue(queueKey, async () => {
        if (shadowSessionMap.get(editorKey) !== sourceSession) {
            return commands.executeCommand(DEFAULT_TAB_COMMAND);
        }

        if (!canAdvanceShadowSession(textEditor, sourceSession)) {
            return commands.executeCommand(DEFAULT_TAB_COMMAND);
        }

        const target = getShadowInputTarget(textEditor);
        if (!target) {
            completeShadowGroupIfNeeded();
            return commands.executeCommand(DEFAULT_TAB_COMMAND);
        }

        if (!getShadowRequireManualLineBreaksAndIndentation()) {
            await advanceShadowWithTypedInput(target.textEditor, target.session, '\t');
            completeShadowGroupIfNeeded();
            return;
        }

        await handleShadowIndentation(target.textEditor, target.session);
        completeShadowGroupIfNeeded();
    });
}

const shadowInlineCompletionProvider: InlineCompletionItemProvider = {
    provideInlineCompletionItems(
        document: TextDocument,
        position: Position,
        _context: InlineCompletionContext,
        _token: CancellationToken
    ) {
        if (!getShadowShowInlineSuggestion()) {
            return [];
        }

        const textEditor = window.activeTextEditor;
        if (!textEditor || textEditor.document.uri.toString() !== document.uri.toString()) {
            return [];
        }

        const shadowSession = shadowSessionMap.get(getEditorKey(textEditor));
        if (!shadowSession || isWriteCodePauseMap.get(getEditorKey(textEditor))) {
            return [];
        }

        const currentLineRemainder = getGhostTextForCursor(shadowSession, position);
        if (!currentLineRemainder) {
            return [];
        }

        const inlineItem = new InlineCompletionItem(
            currentLineRemainder,
            new Range(position, position)
        );

        return [inlineItem];
    },
};

function registerShadowInlineCompletionProvider() {
    const selectors = [
        { scheme: 'file' },
        { scheme: 'untitled' },
    ];

    return languages.registerInlineCompletionItemProvider(
        selectors,
        shadowInlineCompletionProvider
    );
}

export function activate(context: ExtensionContext) {
    const textEditorCommandMap = [
        {
            command: 'extension.swimming.rewriteCode',
            callback: rewriteCode,
        },
        {
            command: 'extension.swimming.shadowRewriteCode',
            callback: shadowRewriteCode,
        },
        {
            command: 'extension.swimming.closeWriteCode',
            callback: closeWriteCode,
        },
        {
            command: 'extension.swimming.pauseWriteCode',
            callback: pauseWriteCode,
        },
        {
            command: 'extension.swimming.switchWriteMode',
            callback: switchWriteMode,
        },
    ];

    lookWhileTypingTarget = context.workspaceState.get<LookWhileTypingTarget>(
        LOOK_WHILE_TYPING_TARGET_STATE_KEY
    );
    lastClosedLookWhileTypingTarget = context.workspaceState.get<LookWhileTypingTarget>(
        LOOK_WHILE_TYPING_CLOSED_TARGET_STATE_KEY
    );
    lookWhileTypingTerminalName = context.workspaceState.get<string>(
        LOOK_WHILE_TYPING_TERMINAL_STATE_KEY
    );
    lookWhileTypingTerminal = window.terminals.find((terminal) => {
        return terminal.name === lookWhileTypingTerminalName;
    });
    lookWhileTypingCoverTarget = context.workspaceState.get<LookWhileTypingTarget>(
        LOOK_WHILE_TYPING_COVER_TARGET_STATE_KEY
    );
    hiddenLookWhileTypingTarget = context.workspaceState.get<LookWhileTypingTarget>(
        LOOK_WHILE_TYPING_HIDDEN_TARGET_STATE_KEY
    );
    hiddenLookWhileTypingTerminalName = context.workspaceState.get<string>(
        LOOK_WHILE_TYPING_HIDDEN_TERMINAL_STATE_KEY
    );
    hiddenLookWhileTypingTerminal = window.terminals.find((terminal) => {
        return terminal.name === hiddenLookWhileTypingTerminalName;
    });
    updateShadowContext();
    updateLookWhileTypingContext();

    context.subscriptions.push(
        registerShadowInlineCompletionProvider(),
        window.onDidChangeVisibleTextEditors(updateLookWhileTypingContext),
        window.onDidOpenTerminal(updateLookWhileTypingContext),
        window.onDidCloseTerminal((terminal) => {
            let hasChanged = false;
            if (terminal === lookWhileTypingTerminal) {
                lookWhileTypingTerminal = undefined;
                lookWhileTypingTerminalName = undefined;
                hasChanged = true;
            }
            if (terminal === hiddenLookWhileTypingTerminal) {
                clearHiddenLookWhileTypingTarget();
                hasChanged = true;
            }
            if (hasChanged) {
                void persistLookWhileTypingTargets(context);
            }
            updateLookWhileTypingContext();
        }),
        window.onDidChangeTextEditorSelection(({ textEditor, selections }) => {
            handleShadowSelectionChange(textEditor, selections);
        }),
        workspace.onDidChangeTextDocument(({ document, contentChanges }) => {
            handleShadowDocumentChange(document, contentChanges);
        }),
        workspace.onDidRenameFiles(({ files }) => {
            void updateLookWhileTypingTargetAfterWorkspaceRename(context, files);
        }),
        ...textEditorCommandMap.map(({ command, callback }) => {
            return commands.registerTextEditorCommand(command, callback);
        }),
        commands.registerCommand('extension.swimming.exitShadowRewrite', exitShadowRewrite),
        commands.registerCommand(
            LOOK_WHILE_TYPING_SELECT_TARGET_COMMAND,
            () => selectLookWhileTypingTarget(context)
        ),
        commands.registerCommand(
            LOOK_WHILE_TYPING_SELECT_COVER_COMMAND,
            () => selectLookWhileTypingCoverEditor(context)
        ),
        commands.registerCommand(
            LOOK_WHILE_TYPING_CLEAR_TARGET_COMMAND,
            () => clearLookWhileTypingTarget(context)
        ),
        commands.registerCommand(
            LOOK_WHILE_TYPING_SCROLL_UP_COMMAND,
            () => scrollLookWhileTypingTarget(-1)
        ),
        commands.registerCommand(
            LOOK_WHILE_TYPING_SCROLL_DOWN_COMMAND,
            () => scrollLookWhileTypingTarget(1)
        ),
        commands.registerCommand(
            LOOK_WHILE_TYPING_CLOSE_TARGET_COMMAND,
            () => closeOrHideLookWhileTypingTarget(context)
        ),
        commands.registerCommand(
            LOOK_WHILE_TYPING_REOPEN_TARGET_COMMAND,
            () => reopenLookWhileTypingTarget(context)
        ),
        commands.registerCommand(
            LOOK_WHILE_TYPING_RENAME_TARGET_COMMAND,
            () => renameLookWhileTypingTarget(context)
        ),
        commands.registerCommand(SHADOW_DELETE_LEFT_COMMAND, handleShadowDeleteLeft),
        commands.registerCommand(SHADOW_ENTER_COMMAND, handleShadowEnter),
        commands.registerCommand(SHADOW_TAB_COMMAND, handleShadowTab),
        commands.registerCommand(TYPE_COMMAND, (args) => handleShadowType(context, args))
    );
}

export function deactivate() {}
