const vscode = require('vscode');


exports.activate = function(context) {
    context.subscriptions.push(vscode.commands.registerTextEditorCommand('extension.rewriteCode', function (textEditor,edit,args) {
        let selectionRange = new vscode.Range(textEditor.selection.start,textEditor.selection.end);
        if(selectionRange.isEmpty){
            const end = new vscode.Position(textEditor.document.lineCount + 1, 0);
            selectionRange = new vscode.Range(new vscode.Position(0, 0), end);
        }
        const beforeText = textEditor.document.getText(selectionRange);
        let i=0;
        edit.delete(selectionRange);
        const inputInterval = setInterval(()=>{
            if(i>=beforeText.length-1){clearInterval(inputInterval)}
            textEditor.edit(editBuilder => {
                editBuilder.replace(textEditor.selection.end, beforeText[i]);
                i++;
			});
        },200);
    }));
};

exports.deactivate = function() {
    console.log('swimming deactivate')
};