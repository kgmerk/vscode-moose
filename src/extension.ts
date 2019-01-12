'use strict';
// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import * as ppath from 'path';

import { MooseSyntaxDB } from './moose_syntax';
import { Document } from './moose_doc';
import { DefinitionProvider, HoverProvider, OnTypeFormattingEditProvider, DocumentFormattingEditProvider, CompletionItemProvider, DocumentSymbolProvider, CodeActionsProvider } from './features';

export class VSDoc implements Document {
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

function getPaths(wrkPath: string) {
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
    return { yamlPath: yamlPath, jsonPath: jsonPath }
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
        let { yamlPath, jsonPath } = getPaths(wrkPath);
        syntaxDB.setPaths(yamlPath, jsonPath);
    }
    updateDBPaths();

    // Command: allow manual reset of MOOSE syntax DB
    context.subscriptions.push(
        vscode.commands.registerCommand('moose.ResetMooseObjects', () => {
            syntaxDB.rebuildAppData();
        }));
    // Command: create MOOSE syntax files
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

            if (uri === undefined) {
                return;
            }
            await syntaxDB.createFiles(uri[0].fsPath);
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

    // register all functionality providers
    // See: https://code.visualstudio.com/api/language-extensions/programmatic-language-features

    context.subscriptions.push(
        vscode.languages.registerDefinitionProvider(
            moose_selector, new DefinitionProvider(syntaxDB)));

    context.subscriptions.push(
        vscode.languages.registerHoverProvider(
            moose_selector, new HoverProvider(syntaxDB)));

    context.subscriptions.push(
        vscode.languages.registerOnTypeFormattingEditProvider(
            moose_selector, new OnTypeFormattingEditProvider(syntaxDB), "]", " "));

    context.subscriptions.push(
        vscode.languages.registerDocumentFormattingEditProvider(
            moose_selector, new DocumentFormattingEditProvider(syntaxDB)));

    context.subscriptions.push(
        vscode.languages.registerCompletionItemProvider(
            moose_selector, new CompletionItemProvider(syntaxDB), "[", "="));

    context.subscriptions.push(
        vscode.languages.registerDocumentSymbolProvider(
            moose_selector, new DocumentSymbolProvider(syntaxDB)));

    let linter = new CodeActionsProvider(syntaxDB, context.subscriptions);
    vscode.languages.registerCodeActionsProvider(moose_selector, linter);

    // context.subscriptions.push(
    //     vscode.languages.registerReferenceProvider(
    //         moose_selector, new ReferenceProvider(mooseDoc)));

}

// this method is called when your extension is deactivated
export function deactivate() {
}