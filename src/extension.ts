import * as vscode from 'vscode';

export function activate(context: vscode.ExtensionContext) {
    context.subscriptions.push(vscode.commands.registerTextEditorCommand('extension.rewriteCode', function (
        textEditor:vscode.TextEditor,edit:vscode.TextEditorEdit,args) {
        let selectionRange = new vscode.Range(textEditor.selection.start,textEditor.selection.end);
        if(selectionRange.isEmpty){
            const end = new vscode.Position(textEditor.document.lineCount + 1, 0);
            selectionRange = new vscode.Range(new vscode.Position(0, 0), end);
        }
        const beforeText = textEditor.document.getText(selectionRange);
        let i=0;
        edit.delete(selectionRange);
        let writePosition = new vscode.Position(
            textEditor.selection.start.line,
            textEditor.selection.start.character
        );
        vscode.EventEmitter
        const speed = vscode.workspace.getConfiguration().get<number>('vscodePluginSwimming.reWriteSpeed')
        const inputInterval = setInterval(()=>{
            if(i>=beforeText.length || textEditor.document.isClosed){
                return clearInterval(inputInterval)
            }
            if(beforeText[i]==='\r' && beforeText[i+1]==='\n') {i++;return;}
            textEditor.edit(editBuilder => {
                editBuilder.insert(writePosition, beforeText[i]);
                if(beforeText[i]==='\n') {
                    writePosition = new vscode.Position(writePosition.line+1,0)
                } else {
                    writePosition = new vscode.Position(writePosition.line,writePosition.character+1)
                }
                i++;
			});
        },speed?speed:0);
    }));
}

export function deactivate() {}