import {
    Range,
    ExtensionContext,
    TextEditor,
    TextEditorEdit,
    commands,
    Position,
    workspace,
    TextEditorRevealType,
} from 'vscode';

function getReWriteSpeed() {
    const reWriteSpeed = workspace
        .getConfiguration()
        .get<number>('vscodePluginSwimming.reWriteSpeed');

    return typeof reWriteSpeed === 'number' ? reWriteSpeed : 0;
}
let isWriteCodepause = false;

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
    let { line, character } = textEditor.selection.start;

    const inputInterval: NodeJS.Timeout = setInterval(() => {
        if(isWriteCodepause) {return;}
        if (i >= beforeText.length || textEditor.document.isClosed) {
            return clearInterval(inputInterval);
        }
        const nowPosition = new Position(line, character);
        textEditor.edit((editBuilder) => {
            textEditor.revealRange(
                new Range(nowPosition, nowPosition),
                TextEditorRevealType.InCenter
            )
            if (beforeText.startsWith('\r\n', i)) {
                character = 0;
                line++
                editBuilder.insert(nowPosition, '\r\n');
                return i+=2;
            }
            if (beforeText.startsWith('\n', i)) {
                character = 0;
                line++
                editBuilder.insert(nowPosition, '\n');
                return i+=1;
            }
            editBuilder.insert(nowPosition, beforeText[i++]);
            character++;
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

function pauseWriteCode(
    _textEditor: TextEditor,
    _edit: TextEditorEdit,
    ..._args: any[]
) {
    isWriteCodepause = !isWriteCodepause;
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
        {
            command: 'extension.swimming.pauseWriteCode',
            callback: pauseWriteCode,
        },
    ];

    context.subscriptions.push(
        ...textEditorCommandMap.map(({ command, callback }) => {
            return commands.registerTextEditorCommand(command, callback);
        })
    );
}

export function deactivate() {}
