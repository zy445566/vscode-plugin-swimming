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


enum RewriteMode {
    Cycle = 'cycle', // 循环写
    Once = 'once' // 写一次结束
}

function getRewriteMode():RewriteMode {
    const nowRewriteMode = workspace
        .getConfiguration()
        .get<RewriteMode>('vscodePluginSwimming.rewriteMode');
    return nowRewriteMode || RewriteMode.Once;
}

function setRewriteMode(nowRewriteMode:RewriteMode) {
    return workspace
        .getConfiguration()
        .update('vscodePluginSwimming.rewriteMode', nowRewriteMode)
}

const isWriteCodePauseMap:Map<string,boolean> = new Map();
const isWritingCodeMap:Map<string,boolean> = new Map();
const showPauseinfo = function(textEditor: TextEditor) {
    if(isWriteCodePauseMap.get(textEditor.document.fileName)) {
        window.showInformationMessage('pauseWriteCode Now')
    }
}

function getSelectionRangeByStartAndEnd({
    start, 
    end, 
    textEditor
}:{
    start:Position, 
    end:Position, 
    textEditor: TextEditor,
}) {
    let selectionRange = new Range(start, end);

    if (selectionRange.isEmpty) {
        const end = new Position(textEditor.document.lineCount + 1, 0);
        selectionRange = new Range(new Position(0, 0), end);
    }
    return selectionRange
}

function rewriteCodeWithStartAndEnd({
    start, 
    end, 
    textEditor,
    edit
}:{
    start:Position, 
    end:Position, 
    textEditor: TextEditor,
    edit: TextEditorEdit,
}) {
    let i = 0;
    let selectionRange = getSelectionRangeByStartAndEnd({
        start, 
        end, 
        textEditor
    })
    const beforeText = textEditor.document.getText(selectionRange);

    edit.delete(selectionRange);
    let { line, character } = textEditor.selection.start;
    const initLine = line;
    const initCharacter = character;
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
            if (textEditor.document.isClosed) {
                return recycleWrite(inputTimeout)
            }
            if(i >= beforeText.length) {
                if(getRewriteMode()===RewriteMode.Cycle) {
                    return textEditor.edit((editBuilder) => {
                        i = 0
                        editBuilder.delete(selectionRange);
                        line = initLine;
                        character = initCharacter;
                        return runWrite();
                    })
                } else {
                    return recycleWrite(inputTimeout)
                }
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
    rewriteCodeWithStartAndEnd({
        start, 
        end, 
        textEditor,
        edit
    });
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

async function switchWriteMode(
    _textEditor: TextEditor,
    _edit: TextEditorEdit,
    ..._args: any[]
) {
    let nowRewriteMode = getRewriteMode();
    if(nowRewriteMode===RewriteMode.Once) {
        nowRewriteMode = RewriteMode.Cycle;
    } else {
        nowRewriteMode = RewriteMode.Once;
    }
    await setRewriteMode(nowRewriteMode)
    window.showInformationMessage('switch to :' + getRewriteMode())
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
        {
            command: 'extension.swimming.switchWriteMode',
            callback: switchWriteMode,
        },
    ];

    context.subscriptions.push(
        ...textEditorCommandMap.map(({ command, callback }) => {
            return commands.registerTextEditorCommand(command, callback);
        })
    );
}

export function deactivate() {}
