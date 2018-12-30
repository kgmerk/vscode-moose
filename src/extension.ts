'use strict';
// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import * as ppath from 'path';

import { MooseSyntaxDB } from './moose_syntax';
import { MooseDoc, Document, OutlineItem } from './moose_doc';

class VSDoc implements Document {
    private vsdoc: vscode.TextDocument;
    constructor(vsdoc: vscode.TextDocument) {
        this.vsdoc = vsdoc
    }
    getPath() {
        return this.vsdoc.uri.fsPath;
    }
    getLineCount() {
        return this.vsdoc.lineCount;
    }
    getTextInRange(start: [number, number], end: [number, number]) {
        let pos1 = new vscode.Position(start[0], start[1]);
        let pos2 = new vscode.Position(end[0], end[1]);
        return this.vsdoc.getText(new vscode.Range(pos1, pos2));
    }
    getTextForRow(row: number) {
        // TODO this method seems quite slow
        return this.vsdoc.lineAt(row).text;
    }
}

// this method is called when your extension is activated
// your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {

    console.log('Activated MOOSE for VSCode extension');

    var moose_selector = { scheme: 'file', language: "moose" };
    let wrkPath = "";
    if (vscode.workspace.workspaceFolders) {
        wrkPath = vscode.workspace.workspaceFolders[0].uri.fsPath;
    }

    // Initialise MOOSE syntax DB
    var syntaxDB = new MooseSyntaxDB();
    if (vscode.workspace.getConfiguration('moose.log').get('debug', false)) {
        syntaxDB.setLogHandles([console.log]);
        syntaxDB.setWarningHandles([err => console.warn(err.message)]);
    }
    syntaxDB.setErrorHandles(
        [error => vscode.window.showErrorMessage("Moose for VBCode: " + error.message)]);

    function updateDBPaths() {
        let yamlPath: string | null = null;
        let jsonPath: string | null = null;

        let config = vscode.workspace.getConfiguration('moose.syntax');
        if (config.get('yaml', null) !== null) {
            yamlPath = config.get('yaml', '');
            yamlPath = yamlPath.replace("${workspaceFolder}", wrkPath);
        }
        if (config.get('json', null) !== null) {
            jsonPath = config.get('json', '');
            jsonPath = jsonPath.replace("${workspaceFolder}", wrkPath);
        }
        // TODO resolve relative paths?
        syntaxDB.setPaths(yamlPath, jsonPath);
    }
    updateDBPaths();

    // allow manual reset of MOOSE syntax DB
    context.subscriptions.push(
        vscode.commands.registerCommand('moose.ResetMooseObjects', () => {
            syntaxDB.rebuildAppData();
        }));
    // create MOOSE syntax files
    context.subscriptions.push(
        vscode.commands.registerCommand('moose.createFiles', async () => {
            
            let uri = await vscode.window.showOpenDialog({
                canSelectMany: false,
                canSelectFolders: false,
                openLabel: 'Select MOOSE App',
                filters: {
                    'All files': ['*']
                }
                });

            if (uri === undefined){
                return;
            }
            syntaxDB.createFiles(uri[0].fsPath);
        }));


    // Keep MOOSE syntax DB up-to-date
    let config_change = vscode.workspace.onDidChangeConfiguration(event => {
        if (event.affectsConfiguration('moose.syntax')) { updateDBPaths(); }
    });
    context.subscriptions.push(config_change);

    let workspace_change = vscode.workspace.onDidChangeWorkspaceFolders(event => { updateDBPaths(); });
    context.subscriptions.push(workspace_change);

    function checkPath(filePath: vscode.Uri) {

        let { yamlPath, jsonPath } = syntaxDB.getPaths();

        if (yamlPath !== null) {
            if (ppath.resolve(yamlPath) === ppath.resolve(filePath.fsPath)) {
                syntaxDB.rebuildAppData();
            }
        } else if (jsonPath !== null) {
            if (ppath.resolve(jsonPath) === ppath.resolve(filePath.fsPath)) {
                syntaxDB.rebuildAppData();
            }
        }
    }

    let fileSystemWatcher = vscode.workspace.createFileSystemWatcher('**', false, false, false);
    context.subscriptions.push(fileSystemWatcher.onDidCreate((filePath) => {
        checkPath(filePath);
    }));
    context.subscriptions.push(fileSystemWatcher.onDidChange((filePath) => {
        checkPath(filePath);
    }));
    context.subscriptions.push(fileSystemWatcher.onDidDelete((filePath) => {
        checkPath(filePath);
    }));

    // create the moose document instance
    let mooseDoc = new MooseDoc(syntaxDB);

    // register all functionality providers
    // See: https://code.visualstudio.com/api/language-extensions/programmatic-language-features

    context.subscriptions.push(
        vscode.languages.registerDefinitionProvider(
            moose_selector, new DefinitionProvider(mooseDoc)));

    context.subscriptions.push(
        vscode.languages.registerHoverProvider(
            moose_selector, new HoverProvider(mooseDoc)));

    context.subscriptions.push(
        vscode.languages.registerCompletionItemProvider(
            moose_selector, new CompletionItemProvider(mooseDoc), "[", "="));

    context.subscriptions.push(
        vscode.languages.registerDocumentSymbolProvider(
            moose_selector, new DocumentSymbolProvider(mooseDoc)));

    let linter = new CodeActionsProvider(mooseDoc, context.subscriptions);
    vscode.languages.registerCodeActionsProvider(moose_selector, linter);

    // context.subscriptions.push(
    //     vscode.languages.registerReferenceProvider(
    //         moose_selector, new ReferenceProvider(mooseDoc)));

}

// this method is called when your extension is deactivated
export function deactivate() {
}

function selectSymbolKind(kind: string, level: number) {
    if (kind === "block") {
        if (level === 1) {
            return vscode.SymbolKind.Field;
        } else {
            return vscode.SymbolKind.Module;
        }
    } else if (kind === "parameter") {
        return vscode.SymbolKind.Variable;
    } else {
        return vscode.SymbolKind.Null;
    }
}

function selectCompleteKind(kind: string) {
    if (kind === "block") {
        return vscode.CompletionItemKind.Field;
    } else if (kind === "parameter") {
        return vscode.CompletionItemKind.Variable;
    } else if (kind === "value") {
        return vscode.CompletionItemKind.Value;
    } else if (kind === "type") {
        return vscode.CompletionItemKind.TypeParameter;
    } else if (kind === "closing") {
        return vscode.CompletionItemKind.Text;
    } else {
        return vscode.CompletionItemKind.Text;
    }
}

class DefinitionProvider implements vscode.DefinitionProvider {

    private mooseDoc: MooseDoc;
    constructor(mooseDoc: MooseDoc) {
        this.mooseDoc = mooseDoc;
    }

    public async provideDefinition(
        document: vscode.TextDocument, position: vscode.Position,
        token: vscode.CancellationToken) {

        this.mooseDoc.setDoc(new VSDoc(document));
        let pos = { row: position.line, column: position.character };

        let match = await this.mooseDoc.findCurrentNode(pos);

        if (match !== null && "file" in match.node) {
            if (match.node.file !== undefined) {
                return new vscode.Location(vscode.Uri.file(match.node.file), position);
            }
        }

        throw Error('no definition available');

    }
}

class HoverProvider implements vscode.HoverProvider {

    private mooseDoc: MooseDoc;
    constructor(mooseDoc: MooseDoc) {
        this.mooseDoc = mooseDoc;
    }

    public async provideHover(
        document: vscode.TextDocument, position: vscode.Position, token: vscode.CancellationToken):
        Promise<vscode.Hover> {

        this.mooseDoc.setDoc(new VSDoc(document));
        let { line, character } = position;
        let pos = { row: line, column: character };
        let match = await this.mooseDoc.findCurrentNode(pos);
        if (match !== null) {
            let { node, path, range } = match;

            let mkdown = new vscode.MarkdownString();
            let descript = "**" + path.join("/") + "**\n\n" + node.description
            if ("options" in node) {
                if (node.options) {
                    descript += "\n**Options**: " + node.options.split(" ").join(", ");
                }
            }
            mkdown.appendMarkdown(descript);
            let hover = new vscode.Hover(mkdown,
                new vscode.Range(new vscode.Position(line, range[0]),
                    new vscode.Position(line, range[1])));
            return hover;
        }

        throw Error('no data available');
        // return new vscode.Hover("No Data Available");

    }
}

class CompletionItemProvider implements vscode.CompletionItemProvider {

    private mooseDoc: MooseDoc;
    constructor(mooseDoc: MooseDoc) {
        this.mooseDoc = mooseDoc;
    }

    public async provideCompletionItems(document: vscode.TextDocument,
        position: vscode.Position, token: vscode.CancellationToken) {
        let completions: vscode.CompletionItem[] = [];

        this.mooseDoc.setDoc(new VSDoc(document));
        let { line, character } = position;
        let pos = { row: line, column: character };

        let mcomps = await this.mooseDoc.findCompletions(pos);

        for (let mcomp of mcomps) {
            let completion = new vscode.CompletionItem(mcomp.displayText);
            completion.documentation = mcomp.description;

            if (mcomp.insertText.type === "snippet") {
                completion.kind = vscode.CompletionItemKind.Snippet;
                let snippet = new vscode.SnippetString(mcomp.insertText.value);
                completion.insertText = snippet;

            } else {
                completion.kind = selectCompleteKind(mcomp.kind);
                completion.insertText = mcomp.insertText.value;
            }

            completions.push(completion);

        }

        return completions;
    }
}

class DocumentSymbolProvider implements vscode.DocumentSymbolProvider {

    private mooseDoc: MooseDoc;

    constructor(mooseDoc: MooseDoc) {
        this.mooseDoc = mooseDoc;
    }

    private createSymbol(item: OutlineItem) {

        if (!item.end) {
            return null;
        }

        let range = new vscode.Range(
            new vscode.Position(...item.start),
            new vscode.Position(...item.end));
        let selectRange = new vscode.Range(
            new vscode.Position(...item.start),
            new vscode.Position(...item.start));

        let params = {
            name: item.name,
            detail: item.description,
            kind: selectSymbolKind(item.kind, item.level),
            range: range,
            selectionRange: selectRange
        };

        let symbol = new vscode.DocumentSymbol(
            params.name, params.detail, params.kind,
            params.range, params.selectionRange
        );

        return symbol;
    }

    private recurseSymbols(item: OutlineItem, symbol: vscode.DocumentSymbol) {

        let children: vscode.DocumentSymbol[] = [];
        for (let childItem of item.children) {
            let childSymbol = this.createSymbol(childItem);
            if (childSymbol) {
                this.recurseSymbols(childItem, childSymbol);
                children.push(childSymbol);
            }
        }
        symbol.children = children;

    }

    public async provideDocumentSymbols(document: vscode.TextDocument,
        token: vscode.CancellationToken): Promise<vscode.DocumentSymbol[]> {

        let symbols: vscode.DocumentSymbol[] = [];
        let symbol: vscode.DocumentSymbol | null;

        this.mooseDoc.setDoc(new VSDoc(document));
        let { outline } = await this.mooseDoc.assessOutline();

        for (let item of outline) {

            symbol = this.createSymbol(item);
            if (symbol) {
                this.recurseSymbols(item, symbol);
                symbols.push(symbol);
            }

        }

        return symbols;

    }
}

// adapted from https://github.com/hoovercj/vscode-extension-tutorial
class CodeActionsProvider implements vscode.CodeActionProvider {

    private static commandId: string = 'moose.runCodeAction';
    private command: vscode.Disposable;
    private diagnosticCollection: vscode.DiagnosticCollection;
    private mooseDoc: MooseDoc;

    constructor(mooseDoc: MooseDoc, subscriptions: vscode.Disposable[]) {
        this.mooseDoc = mooseDoc;

        this.command = vscode.commands.registerCommand(CodeActionsProvider.commandId, this.runCodeAction, this);
        subscriptions.push(this);
        this.diagnosticCollection = vscode.languages.createDiagnosticCollection();

        vscode.workspace.onDidOpenTextDocument(this.dolint, this, subscriptions);
        vscode.workspace.onDidCloseTextDocument((textDocument) => {
            this.diagnosticCollection.delete(textDocument.uri);
        }, null, subscriptions);

        vscode.workspace.onDidSaveTextDocument(this.dolint, this);

        // lint all open moose documents
        vscode.workspace.textDocuments.forEach(this.dolint, this);
    }

    public dispose(): void {
        this.diagnosticCollection.clear();
        this.diagnosticCollection.dispose();
        this.command.dispose();
    }

    private async dolint(document: vscode.TextDocument) {

        if (document.languageId !== 'moose') {
            return;
        }

        let diagnostics: vscode.Diagnostic[] = [];
        let diagnostic: vscode.Diagnostic;
        let severity: vscode.DiagnosticSeverity;
        let message: string;
        let range: vscode.Range
        this.mooseDoc.setDoc(new VSDoc(document));

        let { errors } = await this.mooseDoc.assessOutline();

        for (let error of errors) {

            severity = vscode.DiagnosticSeverity.Error;
            message = error.msg;
            range = new vscode.Range(
                new vscode.Position(error.row, error.columns[0]),
                new vscode.Position(error.row, error.columns[1])
            );

            diagnostic = new vscode.Diagnostic(range, message, severity);
            diagnostics.push(diagnostic);
        }

        this.diagnosticCollection.set(document.uri, diagnostics);

    }

    public provideCodeActions(
        document: vscode.TextDocument, range: vscode.Range,
        context: vscode.CodeActionContext, token: vscode.CancellationToken):
        vscode.CodeAction[] {

        this.mooseDoc.setDoc(new VSDoc(document));

        let commands: vscode.CodeAction[] = [];

        // TODO create CodeActionsProvider
        // let a = new vscode.CodeAction("hi");
        // commands.push(a);

        return commands;
    }

    private runCodeAction(document: vscode.TextDocument, range: vscode.Range, message: string): any {
        // TODO create runCodeAction
        // let edit = new vscode.WorkspaceEdit();
        // edit.replace(document.uri, range, newText);
        // return vscode.workspace.applyEdit(edit);
    }

}

// TODO make a proper "find all references function" (account for when they are used in functions, etc)
// TODO implement change all occurences reference names

// class ReferenceProvider implements vscode.ReferenceProvider {

//     private mooseDoc: MooseDoc;
//     constructor(mooseDoc: MooseDoc) {
//         this.mooseDoc = mooseDoc;
//     }

//     public provideReferences(
//         document: vscode.TextDocument, position: vscode.Position,
//         options: { includeDeclaration: boolean }, token: vscode.CancellationToken): Thenable<vscode.Location[]> {
//         return new Promise<vscode.Location[]>((resolve, reject) => {
//             // get current word
//             let wordRange = document.getWordRangeAtPosition(position);

//             // ignore if empty
//             if (!wordRange) {
//                 //TODO how to show error message at cursor position?
//                 // vscode.window.showWarningMessage("empty string not referencable");
//                 // console.log("empty string not referencable");
//                 reject("empty string not referencable");

//             }
//             let word_text = document.getText(wordRange);

//             // ignore if is a number
//             if (!isNaN(Number(word_text))) {
//                 // return resolve([]);
//                 //TODO how to show error message at cursor position?
//                 // vscode.window.showWarningMessage("numbers are not referencable");
//                 // console.log("numbers are not referencable");
//                 reject("numbers are not referencable");

//             }

//             let results: vscode.Location[] = [];
//             let in_variables = false;

//             for (var i = 0; i < document.lineCount; i++) {
//                 var line = document.lineAt(i);

//                 // remove comments
//                 var line_text = line.text.trim().split("#")[0].trim();

//                 // reference variable instatiation in [Variables] block e.g. [./c]
//                 if (line_text === "[Variables]" || line_text === "[AuxVariables]") {
//                     in_variables = true;
//                 }
//                 if (line_text === "[]") {
//                     in_variables = false;
//                 }
//                 if (in_variables && line_text === "[./" + word_text + "]") {
//                     results.push(new vscode.Location(document.uri, line.range));
//                     continue;
//                 }

//                 // TODO account for if quoted string is continued over multiple lines

//                 // get right side of equals
//                 if (!line_text.includes("=")) {
//                     continue;
//                 }
//                 var larray = line_text.split("=");
//                 if (larray.length < 2) {
//                     continue;
//                 }
//                 var equals_text = larray[1].trim();

//                 // remove quotes
//                 if (equals_text.startsWith("'") && equals_text.endsWith("'")) {
//                     equals_text = equals_text.substr(1, equals_text.length - 2);
//                 }
//                 if (equals_text.startsWith('"') && equals_text.endsWith('"')) {
//                     equals_text = equals_text.substr(1, equals_text.length - 2);
//                 }

//                 // test if only reference
//                 if (equals_text === word_text) {
//                     results.push(new vscode.Location(document.uri, line.range));
//                 } else {
//                     // test if one of many references
//                     for (let elem of equals_text.split(" ")) {
//                         if (elem.trim() === word_text) {
//                             results.push(new vscode.Location(document.uri, line.range));
//                             break;
//                         }
//                     }
//                 }
//                 // TODO find reference when used in a function

//             }
//             resolve(results);
//         });
//     }
// }
