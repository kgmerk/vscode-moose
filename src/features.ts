'use strict';

import * as vscode from 'vscode';

import { MooseDoc, OutlineBlockItem, OutlineParamItem } from './moose_doc';
import { VSDoc } from './extension';


function selectSymbolKind(kind: string, level: number) {
    if (kind === "block") {
        if (level === 1) {
            return vscode.SymbolKind.Field;
        }
        else {
            return vscode.SymbolKind.Module;
        }
    }
    else if (kind === "parameter") {
        return vscode.SymbolKind.Variable;
    }
    else {
        return vscode.SymbolKind.Null;
    }
}
function selectCompleteKind(kind: string, required = false) {
    if (kind === "block") {
        return vscode.CompletionItemKind.Field;
    }
    else if (kind === "parameter") {
        if (required) {
            return vscode.CompletionItemKind.Value;
        } else {
            return vscode.CompletionItemKind.Variable;
        }
    }
    else if (kind === "value") {
        return vscode.CompletionItemKind.Value;
    }
    else if (kind === "type") {
        return vscode.CompletionItemKind.TypeParameter;
    }
    else if (kind === "closing") {
        return vscode.CompletionItemKind.Text;
    }
    else {
        return vscode.CompletionItemKind.Text;
    }
}
export class DefinitionProvider implements vscode.DefinitionProvider {
    private mooseDoc: MooseDoc;
    constructor(mooseDoc: MooseDoc) {
        this.mooseDoc = mooseDoc;
    }
    public async provideDefinition(document: vscode.TextDocument, position: vscode.Position, token: vscode.CancellationToken) {
        this.mooseDoc.setDoc(new VSDoc(document));
        let pos = { row: position.line, column: position.character };
        let match = await this.mooseDoc.findCurrentNode(pos);
        if (match !== null && "defPosition" in match.node) {
            return new vscode.Location(document.uri,
                new vscode.Position(match.node.defPosition.row, match.node.defPosition.column));
        } else if (match !== null && "file" in match.node) {
            if (match.node.file !== undefined) {
                return new vscode.Location(vscode.Uri.file(match.node.file), new vscode.Position(0, 0));
            }
        }
        throw Error('no definition available');
    }
}
export class HoverProvider implements vscode.HoverProvider {
    private mooseDoc: MooseDoc;
    constructor(mooseDoc: MooseDoc) {
        this.mooseDoc = mooseDoc;
    }
    public async provideHover(document: vscode.TextDocument, position: vscode.Position, token: vscode.CancellationToken): Promise<vscode.Hover> {
        this.mooseDoc.setDoc(new VSDoc(document));
        let { line, character } = position;
        let pos = { row: line, column: character };
        let match = await this.mooseDoc.findCurrentNode(pos);
        if (match !== null) {
            let { node, path, range } = match;
            let mkdown = new vscode.MarkdownString();
            let descript = "**" + path.join("/") + "**\n\n" + node.description;
            if ("cpp_type" in node) {
                if (node.cpp_type) {
                    descript += "\nType: " + node.cpp_type + "\n";
                }
            }
            if ("options" in node) {
                if (node.options) {
                    descript += "\nOptions: " + node.options.split(" ").join(", ");
                }
            }
            mkdown.appendMarkdown(descript);
            let hover = new vscode.Hover(mkdown, new vscode.Range(new vscode.Position(line, range[0]), new vscode.Position(line, range[1])));
            return hover;
        }
        throw Error('no data available');
        // return new vscode.Hover("No Data Available");
    }
}

export class OnTypeFormattingEditProvider implements vscode.OnTypeFormattingEditProvider {
    private mooseDoc: MooseDoc;
    constructor(mooseDoc: MooseDoc) {
        this.mooseDoc = mooseDoc;
    }
    public async provideOnTypeFormattingEdits(document: vscode.TextDocument, position: vscode.Position, ch: string, options: vscode.FormattingOptions, token: vscode.CancellationToken): Promise<vscode.TextEdit[]> {
        let vsEdits: vscode.TextEdit[] = [];
        let vsEdit: vscode.TextEdit;
        this.mooseDoc.setDoc(new VSDoc(document));

        let {edits} = await this.mooseDoc.assessOutline(vscode.workspace.getConfiguration('moose.tab').get('spaces', 4));
        let row = position.line;

        for (let edit of edits){
            if (row >= edit.start[0] && row <= edit.end[0] && edit.type === "indent"){
                vsEdit = new vscode.TextEdit(
                    new vscode.Range(
                        new vscode.Position(...edit.start), 
                        new vscode.Position(...edit.end)), 
                        edit.text);
                vsEdits.push(vsEdit);
            }
        }

        return vsEdits;
    }
}

export class DocumentFormattingEditProvider implements vscode.DocumentFormattingEditProvider {
    private mooseDoc: MooseDoc;
    constructor(mooseDoc: MooseDoc) {
        this.mooseDoc = mooseDoc;
    }
    public async provideDocumentFormattingEdits(document: vscode.TextDocument): Promise<vscode.TextEdit[]> {
        let vsEdits: vscode.TextEdit[] = [];
        let vsEdit: vscode.TextEdit;
        this.mooseDoc.setDoc(new VSDoc(document));

        let { edits } = await this.mooseDoc.assessOutline(
            vscode.workspace.getConfiguration('moose.tab').get('spaces', 4));

        for (let edit of edits){
            vsEdit = new vscode.TextEdit(
                new vscode.Range(
                    new vscode.Position(...edit.start), 
                    new vscode.Position(...edit.end)), 
                    edit.text);
            vsEdits.push(vsEdit);
        }

        return vsEdits;
    }
}

export class CompletionItemProvider implements vscode.CompletionItemProvider {
    private mooseDoc: MooseDoc;
    constructor(mooseDoc: MooseDoc) {
        this.mooseDoc = mooseDoc;
    }
    public async provideCompletionItems(document: vscode.TextDocument, position: vscode.Position, token: vscode.CancellationToken) {
        let completions: vscode.CompletionItem[] = [];
        this.mooseDoc.setDoc(new VSDoc(document));
        let { line, character } = position;
        let pos = { row: line, column: character };
        let mcomps = await this.mooseDoc.findCompletions(pos);
        for (let mcomp of mcomps) {
            let completion = new vscode.CompletionItem(mcomp.displayText);
            if (mcomp.required) {
                completion.documentation = mcomp.description + " (REQUIRED)";
            } else {
                completion.documentation = mcomp.description;
            }
            if (mcomp.insertText.type === "snippet") {
                completion.kind = selectCompleteKind(mcomp.kind, mcomp.required); //vscode.CompletionItemKind.Snippet;
                let snippet = new vscode.SnippetString(mcomp.insertText.value);
                completion.insertText = snippet;
            }
            else {
                completion.kind = selectCompleteKind(mcomp.kind, mcomp.required);
                completion.insertText = mcomp.insertText.value;

            }
            completions.push(completion);
        }
        return completions;
    }
}
export class DocumentSymbolProvider implements vscode.DocumentSymbolProvider {
    private mooseDoc: MooseDoc;
    constructor(mooseDoc: MooseDoc) {
        this.mooseDoc = mooseDoc;
    }
    private createSymbol(item: OutlineBlockItem | OutlineParamItem) {
        if (!item.end) {
            return null;
        }
        let range = new vscode.Range(new vscode.Position(...item.start), new vscode.Position(...item.end));
        let selectRange = new vscode.Range(new vscode.Position(...item.start), new vscode.Position(...item.start)); // TODO have correct selection range 
        let params = {
            name: item.name,
            detail: item.description,
            range: range,
            selectionRange: selectRange,
        };
        let kind: vscode.SymbolKind;
        if ("level" in item) {
            kind = selectSymbolKind("block", item.level);
        } else {
            kind = selectSymbolKind("parameter", 0);
        }
        let symbol = new vscode.DocumentSymbol(params.name, params.detail, kind, params.range, params.selectionRange);
        return symbol;
    }
    private recurseOutlineBlocks(item: OutlineBlockItem, symbol: vscode.DocumentSymbol) {
        let children: vscode.DocumentSymbol[] = [];
        for (let childItem of item.children) {
            let childSymbol = this.createSymbol(childItem);
            if (childSymbol) {
                this.recurseOutlineBlocks(childItem, childSymbol);
                children.push(childSymbol);
            }
        }
        // for (let paramItem of item.parameters) {
        //     let paramSymbol = this.createSymbol(paramItem);
        //     if (paramSymbol) {
        //         children.push(paramSymbol);
        //     }           
        // }
        symbol.children = children;
    }
    public async provideDocumentSymbols(document: vscode.TextDocument, token: vscode.CancellationToken): Promise<vscode.DocumentSymbol[]> {
        let symbols: vscode.DocumentSymbol[] = [];
        let symbol: vscode.DocumentSymbol | null;
        let outline: OutlineBlockItem[];
        this.mooseDoc.setDoc(new VSDoc(document));
        try {
            ({ outline } = await this.mooseDoc.assessOutline());
        } catch (err) {
            console.log(err);
            throw err;
        }

        for (let item of outline) {
            symbol = this.createSymbol(item);
            if (symbol) {
                this.recurseOutlineBlocks(item, symbol);
                symbols.push(symbol);
            }
        }
        return symbols;
    }
}
// adapted from https://github.com/hoovercj/vscode-extension-tutorial
export class CodeActionsProvider implements vscode.CodeActionProvider {
    private static commandId: string = 'moose.runCodeAction';
    private command: vscode.Disposable;
    private diagnosticCollection: vscode.DiagnosticCollection;
    private mooseDoc: MooseDoc;
    constructor(mooseDoc: MooseDoc, subscriptions: vscode.Disposable[]) {
        this.mooseDoc = mooseDoc;
        this.command = vscode.commands.registerCommand(CodeActionsProvider.commandId, this.runCodeAction, this);
        subscriptions.push(this);
        this.diagnosticCollection = vscode.languages.createDiagnosticCollection();
        vscode.workspace.onDidOpenTextDocument(this.doLint, this, subscriptions);
        vscode.workspace.onDidCloseTextDocument((textDocument) => {
            this.diagnosticCollection.delete(textDocument.uri);
        }, null, subscriptions);
        vscode.workspace.onDidSaveTextDocument(this.doLint, this);
        // lint all open moose documents
        vscode.workspace.textDocuments.forEach(this.doLint, this);
    }
    public dispose(): void {
        this.diagnosticCollection.clear();
        this.diagnosticCollection.dispose();
        this.command.dispose();
    }
    private async doLint(document: vscode.TextDocument) {
        if (document.languageId !== 'moose') {
            return;
        }
        let diagnostics: vscode.Diagnostic[] = [];
        if (!vscode.workspace.getConfiguration('moose').get('diagnostics', false)) {
            this.diagnosticCollection.set(document.uri, diagnostics);
            return;
        }
        let diagnostic: vscode.Diagnostic;
        let severity: vscode.DiagnosticSeverity;
        let message: string;
        let range: vscode.Range;
        this.mooseDoc.setDoc(new VSDoc(document));
        let { outline, errors, edits } = await this.mooseDoc.assessOutline();
        for (let error of errors) {
            severity = vscode.DiagnosticSeverity.Error;
            message = error.msg;
            range = new vscode.Range(new vscode.Position(error.row, error.columns[0]), new vscode.Position(error.row, error.columns[1]));
            diagnostic = new vscode.Diagnostic(range, message, severity);
            diagnostic.source = "moose";
            diagnostics.push(diagnostic);
        }
        for (let edit of edits) {
            severity = vscode.DiagnosticSeverity.Warning;
            message = edit.msg;
            range = new vscode.Range(
                new vscode.Position(...edit.start), 
                new vscode.Position(...edit.end));
            diagnostic = new vscode.Diagnostic(range, message, severity);
            diagnostic.source = "moose";
            diagnostics.push(diagnostic);
        }
        for (let block of outline) {
            this.recurseChildren(block, diagnostics);
        }
        this.diagnosticCollection.set(document.uri, diagnostics);
    }
    private recurseChildren(block: OutlineBlockItem, diagnostics: vscode.Diagnostic[]) {
        for (let child of block.children) {
            if (block.inactive.indexOf(child.name) >= 0 && child.end !== null) {
                let severity = vscode.DiagnosticSeverity.Hint;
                let message = "inactive block";   
                let range = new vscode.Range(
                    new vscode.Position(...child.start), 
                    new vscode.Position(...child.end));
                let diagnostic = new vscode.Diagnostic(range, message, severity);
                diagnostic.tags = [vscode.DiagnosticTag.Unnecessary];
                diagnostic.source = "moose";
                diagnostics.push(diagnostic);                    
            }
            this.recurseChildren(child, diagnostics);
        }        
    }
    public provideCodeActions(document: vscode.TextDocument, range: vscode.Range, context: vscode.CodeActionContext, token: vscode.CancellationToken): vscode.CodeAction[] {
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
