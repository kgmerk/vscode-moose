'use strict';
// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';

// this method is called when your extension is activated
// your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {

    // Use the console to output diagnostic information (console.log) and errors (console.error)
    // This line of code will only be executed once when your extension is activated
    // console.log('Congratulations, your extension "moose" is now active!');

    // The command has been defined in the package.json file
    // Now provide the implementation of the command with  registerCommand
    // The commandId parameter must match the command field in package.json
    let disposable = vscode.commands.registerCommand('extension.sayHello', () => {
        // The code you place here will be executed every time your command is executed
        // Display a message box to the user
        vscode.window.showInformationMessage('Hello World!');
    });
    context.subscriptions.push(disposable);

    context.subscriptions.push(
        vscode.languages.registerCompletionItemProvider('*', {
        provideCompletionItems(document: vscode.TextDocument, position: vscode.Position, token: vscode.CancellationToken) {
            return [
                new vscode.CompletionItem("[GlobalParams]"),
                new vscode.CompletionItem("[Variables]"),
                new vscode.CompletionItem("[AuxVariables]"),
                new vscode.CompletionItem("[Mesh]"),
                new vscode.CompletionItem("[BCS]"),
                new vscode.CompletionItem("[ICS]"),
                new vscode.CompletionItem("[Problem]"),
                new vscode.CompletionItem("[Precursors]"),
                new vscode.CompletionItem("[Kernels]"),
                new vscode.CompletionItem("[AuxKernels]"),
                new vscode.CompletionItem("[Functions]"),
                new vscode.CompletionItem("[Materials]"),
                new vscode.CompletionItem("[Executioner]"),
                new vscode.CompletionItem("[Preconditioning]"),
                new vscode.CompletionItem("[Outputs]"),
                new vscode.CompletionItem("active = ''"),
            ];
        }})
        );

    context.subscriptions.push(vscode.languages.registerDocumentSymbolProvider(
            {language: "moose"}, new DocumentSymbolProvider()
        ));
}

// this method is called when your extension is deactivated
export function deactivate() {
}

class DocumentSymbolProvider implements vscode.DocumentSymbolProvider {
    public provideDocumentSymbols(document: vscode.TextDocument,
            token: vscode.CancellationToken): Thenable<vscode.SymbolInformation[]> {
        return new Promise((resolve, reject) => {
            var symbols = [];
            var head1_regex = new RegExp('\\[[_a-zA-Z0-9]+\\]');
            var head2_regex = new RegExp('\\[\\.\\/[_a-zA-Z0-9]+\\]');
           
            for (var i = 0; i < document.lineCount; i++) {
                var line = document.lineAt(i);
                var text = line.text.trim();

                if (head1_regex.test(text)) {

                    // Find the closing []
                    var last_line = line;
                    for (var j = i; j < document.lineCount; j++) {
                        var line2 = document.lineAt(j);
                        var text2 = line2.text.trim();
                        if (text2 === "[]") {
                            last_line = line2;
                            break;
                        }
                    }

                    symbols.push({
                        name: text.substr(1, text.length-2),
                        containerName: "Main Block",
                        kind: vscode.SymbolKind.Field,
                        location: new vscode.Location(document.uri, 
                            new vscode.Range(new vscode.Position(line.lineNumber, 1), 
                            new vscode.Position(last_line.lineNumber, last_line.text.length)))
                    });
                }
                if (head2_regex.test(text)) {
 
                    // Find the closing [../]
                    var last_line2 = line;
                    for (var k = i; k < document.lineCount; k++) {
                        var line3 = document.lineAt(k);
                        var text3 = line3.text.trim();
                        if (text3 === "[../]") {
                            last_line2 = line3;
                            break;
                        }
                    }

                    symbols.push({
                            name: text.substr(3, text.length-4),
                            containerName: "Sub Block",
                            kind: vscode.SymbolKind.String,
                            location: new vscode.Location(document.uri, 
                                new vscode.Range(new vscode.Position(line.lineNumber, 1), 
                                new vscode.Position(last_line2.lineNumber, last_line2.text.length)))
                            });
                }
           }

            resolve(symbols);
        });
    }
}


// TODO move to DocumentSymbol API: https://code.visualstudio.com/updates/v1_25#_document-symbols
// Like this (although this isn't working)
// class DocumentSymbolProvider implements vscode.DocumentSymbolProvider {
//     public provideDocumentSymbols(document: vscode.TextDocument,
//             token: vscode.CancellationToken): Thenable<vscode.DocumentSymbol[]> {
//         return new Promise((resolve, reject) => {
//             var symbols = [];
//             var head1_regex = new RegExp('\\[[a-zA-Z0-9]+\\]');
//             var head2_regex = new RegExp('\\[\\.\\/[a-zA-Z0-9]+\\]');
           
//             for (var i = 0; i < document.lineCount; i++) {
//                 var line = document.lineAt(i);
//                 var text = line.text.trim();
//                 // if (line.text.startsWith("[")) {
//                 if (head1_regex.test(text)) {
//                     // var location = new vscode.Location(document.uri, line.range)
//                     symbols.push({
//                         name: text.substr(1, text.length-2),
//                         detail: "Main Module",
//                         kind: vscode.SymbolKind.String,
//                         range: new vscode.Range(new vscode.Position(line.lineNumber, 1), 
//                                                 new vscode.Position(line.lineNumber, line.text.length)),
//                         selectionRange: new vscode.Range(new vscode.Position(line.lineNumber, 1), 
//                                                 new vscode.Position(line.lineNumber, line.text.length)),
//                         children: []
//                     });
//                 }
//                 if (head2_regex.test(text)) {
//                     symbols.push({
//                         name: text.substr(3, text.length-4),
//                         detail: "Submodule",
//                         kind: vscode.SymbolKind.String,
//                         range: new vscode.Range(new vscode.Position(line.lineNumber, 1), 
//                                                 new vscode.Position(line.lineNumber, line.text.length)),
//                         selectionRange: new vscode.Range(new vscode.Position(line.lineNumber, 1), 
//                                                 new vscode.Position(line.lineNumber, line.text.length)),
//                         children: []
//                     });
//                 }
//            }

//             resolve(symbols);
//         });
//     }
// }