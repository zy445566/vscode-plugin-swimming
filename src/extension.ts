import {
    Range,
    ExtensionContext,
    TextEditor,
    TextEditorEdit,
    commands,
    Position,
    workspace,
    TextEditorRevealType,
    window,
} from 'vscode';

function getReWriteSpeed() {
    const reWriteSpeed = workspace
        .getConfiguration()
        .get<number>('vscodePluginSwimming.reWriteSpeed');

    return typeof reWriteSpeed === 'number' ? reWriteSpeed : 0;
}
const isWriteCodePauseMap:Map<string,boolean> = new Map();
const isWritingCodeMap:Map<string,boolean> = new Map();
const showPauseinfo = function(textEditor: TextEditor) {
    if(isWriteCodePauseMap.get(textEditor.document.fileName)) {
        window.showInformationMessage('pauseWriteCode Now')
    }
}
function rewriteCode(
    textEditor: TextEditor,
    edit: TextEditorEdit,
    _args: any[]
) {
    if(isWritingCodeMap.get(textEditor.document.fileName)) {
        return window.showInformationMessage('rewriteCode already in progress')
    }
    isWritingCodeMap.set(textEditor.document.fileName,true)
    isWriteCodePauseMap.set(textEditor.document.fileName,false)
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
    const recycleWrite = function(inputTimeout: NodeJS.Timeout) {
        isWritingCodeMap.set(textEditor.document.fileName,false)
        clearTimeout(inputTimeout);
    }
    const runWrite = function() {
        const inputTimeout: NodeJS.Timeout = setTimeout(() => {
            if(isWriteCodePauseMap.get(textEditor.document.fileName)) {
                return textEditor.edit((_editBuilder) => {})
                .then((_value:boolean)=>{
                    return runWrite();
                },(reason)=>{
                    recycleWrite(inputTimeout)
                    throw new Error(reason);
                })
            }
            if (i >= beforeText.length || textEditor.document.isClosed) {
                return recycleWrite(inputTimeout)
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
            }).then((_value:boolean)=>{
                return runWrite();
            },(reason)=>{
                recycleWrite(inputTimeout)
                throw new Error(reason);
            })
        }, getReWriteSpeed());
    }
    runWrite();
    
}

function closeWriteCode(
    _textEditor: TextEditor,
    _edit: TextEditorEdit,
    ..._args: any[]
) {
    isWriteCodePauseMap.clear();
    isWritingCodeMap.clear();
    commands.executeCommand('workbench.action.reloadWindow');
}

function pauseWriteCode(
    textEditor: TextEditor,
    _edit: TextEditorEdit,
    ..._args: any[]
) {
    if(!isWritingCodeMap.get(textEditor.document.fileName)) {
        return window.showInformationMessage('rewriteCode not run,cannot pause.')
    }
    isWriteCodePauseMap.set(textEditor.document.fileName,!isWriteCodePauseMap.get(textEditor.document.fileName))
    showPauseinfo(textEditor);
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
