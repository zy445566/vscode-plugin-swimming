import {
    Range,
    ExtensionContext,
    TextEditor,
    TextEditorEdit,
    commands,
    Position,
    workspace,
} from 'vscode';

function createPosition(textEditor: TextEditor) {
    const { line, character } = textEditor.selection.start;

    return new Position(line, character);
}

function getReWriteSpeed() {
    const reWriteSpeed = workspace
        .getConfiguration()
        .get<number>('vscodePluginSwimming.reWriteSpeed');

    return typeof reWriteSpeed === 'number' ? reWriteSpeed : 0;
}

function rewriteCode(
    textEditor: TextEditor,
    edit: TextEditorEdit,
    _args: any[]
) {
    const { start, end } = textEditor.selection;

    let i = 0;
    let selectionRange = new Range(start, end);

    if (selectionRange.isEmpty) {
        const end = new Position(textEditor.document.lineCount + 1, 0);
        selectionRange = new Range(new Position(0, 0), end);
    }

    const beforeText = textEditor.document.getText(selectionRange);

    edit.delete(selectionRange);

    const inputInterval: NodeJS.Timeout = setInterval(() => {
        if (i >= beforeText.length || textEditor.document.isClosed) {
            return clearInterval(inputInterval);
        }

        if (beforeText.startsWith('\r\n', i)) {
            return i++;
        }

        textEditor.edit((editBuilder) => {
            editBuilder.insert(createPosition(textEditor), beforeText[i++]);
        });
    }, getReWriteSpeed());
}

function closeWriteCode(
    _textEditor: TextEditor,
    _edit: TextEditorEdit,
    ..._args: any[]
) {
    commands.executeCommand('workbench.action.reloadWindow');
}

export function activate(context: ExtensionContext) {
    const textEditorCommandMap = [
        {
            command: 'extension.swimming.rewriteCode',
            callback: rewriteCode,
        },
        {
            command: 'extension.swimming.closeWriteCode',
            callback: closeWriteCode,
        },
    ];

    context.subscriptions.push(
        ...textEditorCommandMap.map(({ command, callback }) => {
            return commands.registerTextEditorCommand(command, callback);
        })
    );
}

export function deactivate() {}
