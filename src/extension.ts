'use strict';
// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import * as pathparse from 'path';
import * as globToregex from 'glob-to-regexp';
import * as fileread from 'fs';

// this method is called when your extension is activated
// your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {

    // Use the console to output diagnostic information (console.log) and errors (console.error)
    // This line of code will only be executed once when your extension is activated
    // console.log('Congratulations, your extension "moose" is now active!');

    // TODO delete sayHello command
    let disposable = vscode.commands.registerCommand('extension.sayHello', () => {
        // The code you place here will be executed every time your command is executed
        // Display a message box to the user
        vscode.window.showInformationMessage('Hello World!');
    });
    context.subscriptions.push(disposable);

    var moose_selector = { scheme: 'file', language: "moose" };

    let moose_objects = new MooseObjects();
    let config_change = vscode.workspace.onDidChangeConfiguration(event => {
        if (event.affectsConfiguration('moose')) {moose_objects.resetMooseObjects();}
    });
    context.subscriptions.push(config_change);
    let workspace_change = vscode.workspace.onDidChangeWorkspaceFolders(event => {moose_objects.resetMooseObjects();});
    context.subscriptions.push(workspace_change);
    let fileSystemWatcher = vscode.workspace.createFileSystemWatcher('**', false, false, false);
    context.subscriptions.push(fileSystemWatcher.onDidCreate((filePath) => {
        moose_objects.addMooseObject(filePath);
    }));
    context.subscriptions.push(fileSystemWatcher.onDidChange((filePath) => {
        moose_objects.removeMooseObject(filePath);
        moose_objects.addMooseObject(filePath);
    }));
    context.subscriptions.push(fileSystemWatcher.onDidDelete((filePath) => {
        moose_objects.removeMooseObject(filePath);
    }));

    context.subscriptions.push(
        vscode.languages.registerCompletionItemProvider(
            moose_selector, new CompletionItemProvider(moose_objects), "[", "="));

    context.subscriptions.push(
        vscode.languages.registerDocumentSymbolProvider(
            moose_selector, new DocumentSymbolProvider()));

    context.subscriptions.push(
        vscode.languages.registerReferenceProvider(
            moose_selector, new ReferenceProvider()));

    context.subscriptions.push(
        vscode.languages.registerDefinitionProvider(
            moose_selector, new DefinitionProvider()));

    context.subscriptions.push(
        vscode.languages.registerHoverProvider(
            moose_selector, new HoverProvider(moose_objects)));

}

// this method is called when your extension is deactivated
export function deactivate() {
}

export default async function findFilesInWorkspace(include: string, exclude = '', maxResults = 2) {

    // TODO exclude whole workspace folders
    const foundFiles = await vscode.workspace.findFiles(
        include,
        exclude,
        maxResults,
    );
    return foundFiles;
}

function extract_classdescript(uri: vscode.Uri, ftype: string = 'utf8') {

    /** NB: originally used 
     * const descript = await vscode.workspace.openTextDocument(uri).then(docobj => {...});
     * but this triggered open event(s)
     */

    function extract(contents: string) {
        let search = contents.search("addClassDescription\\(");
        if (search === -1) {
            return null;
        }
        let descript = contents.substring(search + 20, contents.length - 1).trimLeft();
        search = descript.search('\\);');
        if (search === -1) {
            return null;
        }
        descript = descript.substr(1, search).trimRight();
        descript = descript.substr(0, descript.length - 2).replace(/("\s*\n\s*"|"\s*\r\s*")/gm, "");

        return descript;        
    }

    return new Promise<string|null>(function(resolve, reject){
        fileread.readFile(uri.fsPath, ftype, (err, content) => {
            // err ? reject(err) : resolve(data);
            if (err) {
                reject(err);
            }
            else {
                let descript = extract(content);
                resolve(descript);
            }
        });
      });
}

class MooseObjects {
    /**
     * this class handles maintaining a list of MOOSE object URI's
     */

    private moose_objects: { [id: string]: vscode.Uri; };
    private moose_descripts: { [id: string]: string | null; };

    constructor() {
        this.moose_objects = {};
        this.moose_descripts = {};
        this.resetMooseObjects();
    }

    public getMooseObjectsList() {
        let moose_list: vscode.Uri[] = [];
        for (let key in this.moose_objects) {
            moose_list.push(this.moose_objects[key]);
        }

        return moose_list;
    }
    public getMooseObjectsDict() {
        return this.moose_objects;
    }

    private extractName(uri: vscode.Uri) {
        const path = pathparse.parse(uri.fsPath);
        return path.name;
    }
    private logDebug(message: string) {
        console.log("Moose Objects: " + message);
    }
    private logError(message: string) {
        vscode.window.showWarningMessage("Moose Objects: " + message);
        console.warn("Moose Objects: " + message);
    }

    private buildIncludes() {
       // build search includes for moose library
       const findModules = vscode.workspace.getConfiguration('moose.autocomplete').get('modules', []);
       const findTypes = vscode.workspace.getConfiguration('moose.autocomplete').get('types', []);

       let includePaths: string[] = [];
       for (let type of findTypes) {
           includePaths.push("**/framework/src/" + type + "/*.C");
           for (let module of findModules) {
               includePaths.push("**/modules/" + module + "/src/" + type + "/*.C");
           }
       }

       // include user defined objects
       const findOthers = vscode.workspace.getConfiguration('moose.autocomplete').get('other', []);
       for (let other of findOthers) {
           includePaths.push(other);
       }
       return includePaths;
    }

    private buildExcludes() {
        return vscode.workspace.getConfiguration('moose.definitions').get('ignore', []);
    }

    public resetMooseObjects() {

        this.logDebug("called update");

        // clear existing moose_objects
        this.moose_objects = {};
        this.moose_descripts = {};

        // indicate updating in status bar
        // TODO status bar loading icon that only dissapears after all loaded (asynchronously)
        var sbar = vscode.window.setStatusBarMessage("Updating MOOSE objects list");

        // find moose objects
        const ignorePaths = this.buildExcludes();
        const includePaths = this.buildIncludes();

        var exclude = '';
        if (ignorePaths) {
            exclude = `{${ignorePaths.join(',')}}`;
        }
        var include = '';
        if (includePaths) {
            include = `{${includePaths.join(',')}}`;
        }

        const uri = findFilesInWorkspace(include, exclude, 100000);

        uri.then(
            uris_found => {
                let errors = ["duplicates found; "];
                for (let uri of uris_found) {
                    const objname = this.extractName(uri);
                    if (objname in this.moose_objects){
                        errors.push(this.moose_objects[objname].fsPath+" & "+uri.fsPath);
                    } else {
                        this.moose_objects[objname] = uri;
                    }
                }
                if (errors.length > 1){
                    this.logError(errors.join("\n"));
                }
            }
        );

        uri.then(
            uris_found => {
                for (let uri of uris_found) {
                    const objname = this.extractName(uri);
                    if (!(objname in this.moose_descripts)){
                        this.createDescription(uri);
                    }
                }
            }
        );

        sbar.dispose();

    }

    public removeMooseObject(uri: vscode.Uri){

        const objname = this.extractName(uri);
        if (objname in this.moose_objects) {
            if (uri.fsPath === this.moose_objects[objname].fsPath) {
                this.logDebug("removing path "+uri.fsPath);
                delete this.moose_objects[objname];
                delete this.moose_descripts[objname];
            }
        }
    }

    public addMooseObject(uri: vscode.Uri){
        // console.log("trigerred addMooseObject: "+uri.fsPath);

        // we need the path relative to the workspace folder
        let wrkfolder = vscode.workspace.getWorkspaceFolder(uri);
        if (!wrkfolder){
            return;
        }
        const path = pathparse.relative(wrkfolder.uri.fsPath, uri.fsPath);
        
        let adduri = false;

        for (let inregex of this.buildIncludes()) {
            let re = globToregex(inregex, {globstar: true});
            // console.log(String(inregex)+" & "+path+" -> "+String(re.test(path)));
            if (re.test(path)) {
                adduri = true;
                break;
            }
        }
        if (!adduri){
            return;
        }

        for (let exregex of this.buildExcludes()) {
            let re = globToregex(exregex, {globstar: true});
            // console.log(String(exregex)+" & "+path+" -> "+String(re.test(path)));
            if (re.test(path)) {
                adduri = false;
                break;
            }
        }

        if (adduri) {
            const objname = this.extractName(uri);
            if (objname in this.moose_objects){
                this.logError("duplicates found; "+this.moose_objects[objname].fsPath+" & "+uri.fsPath);
            }
            this.logDebug("adding path: "+path);
            this.moose_objects[objname] = uri;
            this.createDescription(uri);
        }

        return;

    }

    public createDescription(uri: vscode.Uri){
        /** return a description of the moose object, based on params.addClassDescription value
         * if not available, an attempt to read it from the file will be made
         */

        const objname = this.extractName(uri);
        var descript: Promise<string|null>;

        if (objname in this.moose_descripts){
            descript = new Promise((resolve, reject) => {resolve(this.moose_descripts[objname]);});
            return descript;
        }
        descript = extract_classdescript(uri);
        descript.then(value => this.moose_descripts[objname] = value);

        return descript;
        
    }

    public getDescription(uri: vscode.Uri){
        /** return a description of the moose object, based on params.addClassDescription value
         * 
         */
        const objname = this.extractName(uri);
        if (objname in this.moose_descripts){
            return this.moose_descripts[objname];
        }
        return;
    }
}

class DefinitionProvider implements vscode.DefinitionProvider {
    public provideDefinition(
        document: vscode.TextDocument, position: vscode.Position, token: vscode.CancellationToken):
        Thenable<vscode.Location> {
        return this.doFindDefinition(document, position, token);
    }
    private doFindDefinition(
        document: vscode.TextDocument, position: vscode.Position,
        token: vscode.CancellationToken): Thenable<vscode.Location> {
        return new Promise<vscode.Location>((resolve, reject) => {
            let wordRange = document.getWordRangeAtPosition(position);

            // ignore if empty
            if (!wordRange) {
                //TODO how to show error message at cursor position?
                vscode.window.showWarningMessage("empty string not definable");
                reject("empty string not definable");
                return;
            }
            let word_text = document.getText(wordRange);

            const ignorePaths = vscode.workspace.getConfiguration('moose.definitions').get('ignore', []);
            var exclude = '';
            if (ignorePaths) {
                exclude = `{${ignorePaths.join(',')}}`;
            }
            const includePaths = [
                '**/src/**/' + word_text + '.C'
            ];

            // TODO search outside workspace
            const uri = findFilesInWorkspace(`{${includePaths.join(',')}}`, exclude);

            uri.then(
                uris_found => {

                    if (uris_found.length === 0) {
                        reject("could not find declaration");
                        return;
                    }
                    if (uris_found.length > 1) {
                        vscode.window.showWarningMessage("multiple declarations found");
                        reject("multiple declarations found");
                        return;
                    }

                    var location = new vscode.Location(
                        uris_found[0],
                        new vscode.Position(0, 0));
                    resolve(location);
                },
                failure => {
                    reject("file finder failed");
                }
            );

        });
    }
}

class HoverProvider implements vscode.HoverProvider {

    private moose_objects: MooseObjects;
    constructor(moose_objects: MooseObjects) {
        this.moose_objects = moose_objects;
    }

    public provideHover(
        document: vscode.TextDocument, position: vscode.Position, token: vscode.CancellationToken):
        Thenable<vscode.Hover> {
        return this.doFindDefinition(document, position, token);
    }

    private doFindDefinition(
        document: vscode.TextDocument, position: vscode.Position,
        token: vscode.CancellationToken): Thenable<vscode.Hover> {
        return new Promise<vscode.Hover>((resolve, reject) => {

            if (!document.lineAt(position.line).text.trim().match("type*=*")) {
                reject('no definition available');
                return;
            }

            let wordRange = document.getWordRangeAtPosition(position);

            // ignore if empty
            if (!wordRange) {
                reject("empty string not definable");
                return;
            }
            let word_text = document.getText(wordRange);
            if (word_text === "type" || word_text === "=" || word_text === "") {
                reject('no definition available');
                return;
            }

            let moose_dict = this.moose_objects.getMooseObjectsDict();

            if (word_text in moose_dict) {
                const uri = moose_dict[word_text];

                let thenable = this.moose_objects.createDescription(uri);

                thenable.then(
                    descript => {
                        if (descript === null){
                            // reject('no definition description available');
                            const results = new vscode.Hover("No Class Description Available");
                            resolve(results);
                        } else {
                            let mkdown = new vscode.MarkdownString(descript); // "**"+word_text+"**:\n"+descript
                            const results = new vscode.Hover(mkdown);
                            resolve(results);
                        }        
                    }
                );                

            } else {
                // reject('no definition description available');
                const results = new vscode.Hover("No Class Description Available");
                resolve(results);
            }

        });
    }
}

// TODO implement change all occurences reference names; difficult because would have to account for when they are used in functions, etc

class ReferenceProvider implements vscode.ReferenceProvider {
    public provideReferences(
        document: vscode.TextDocument, position: vscode.Position,
        options: { includeDeclaration: boolean }, token: vscode.CancellationToken): Thenable<vscode.Location[]> {
        return this.doFindReferences(document, position, options, token);
    }

    private doFindReferences(
        document: vscode.TextDocument, position: vscode.Position,
        options: { includeDeclaration: boolean }, token: vscode.CancellationToken): Thenable<vscode.Location[]> {
        return new Promise<vscode.Location[]>((resolve, reject) => {
            // get current word
            let wordRange = document.getWordRangeAtPosition(position);

            // ignore if empty
            if (!wordRange) {
                //TODO how to show error message at cursor position?
                // vscode.window.showWarningMessage("empty string not referencable");
                // console.log("empty string not referencable");
                reject("empty string not referencable");

            }
            let word_text = document.getText(wordRange);

            // ignore if is a number
            if (!isNaN(Number(word_text))) {
                // return resolve([]);
                //TODO how to show error message at cursor position?
                // vscode.window.showWarningMessage("numbers are not referencable");
                // console.log("numbers are not referencable");
                reject("numbers are not referencable");

            }

            let results: vscode.Location[] = [];
            let in_variables = false;

            for (var i = 0; i < document.lineCount; i++) {
                var line = document.lineAt(i);

                // remove comments
                var line_text = line.text.trim().split("#")[0].trim();

                // reference variable instatiation in [Variables] block e.g. [./c]
                if (line_text === "[Variables]" || line_text === "[AuxVariables]") {
                    in_variables = true;
                }
                if (line_text === "[]") {
                    in_variables = false;
                }
                if (in_variables && line_text === "[./" + word_text + "]") {
                    results.push(new vscode.Location(document.uri, line.range));
                    continue;
                }

                // TODO account for if quoted string is continued over multiple lines

                // get right side of equals
                if (!line_text.includes("=")) {
                    continue;
                }
                var larray = line_text.split("=");
                if (larray.length < 2) {
                    continue;
                }
                var equals_text = larray[1].trim();

                // remove quotes
                if (equals_text.startsWith("'") && equals_text.endsWith("'")) {
                    equals_text = equals_text.substr(1, equals_text.length - 2);
                }
                if (equals_text.startsWith('"') && equals_text.endsWith('"')) {
                    equals_text = equals_text.substr(1, equals_text.length - 2);
                }

                // test if only reference
                if (equals_text === word_text) {
                    results.push(new vscode.Location(document.uri, line.range));
                } else {
                    // test if one of many references
                    for (let elem of equals_text.split(" ")) {
                        if (elem.trim() === word_text) {
                            results.push(new vscode.Location(document.uri, line.range));
                            break;
                        }
                    }
                }
                // TODO find reference when used in a function

            }
            resolve(results);
        });
    }
}

class CompletionItemProvider implements vscode.CompletionItemProvider {

    private moose_objects: MooseObjects;
    private moose_blocks: string[];
    constructor(moose_objects: MooseObjects) {
        this.moose_objects = moose_objects;
        this.moose_blocks = [
            "GlobalParams",
            "Variables",
            "AuxVariables",
            "Mesh",
            "BCs",
            "ICs",
            "Problem",
            "Precursors",
            "Kernels",
            "AuxKernels",
            "Functions",
            "Materials",
            "Executioner",
            "Preconditioning",
            "Outputs"
        ];

    }

    public provideCompletionItems(document: vscode.TextDocument, position: vscode.Position, token: vscode.CancellationToken) {

        var completions = [];

        // Block name completions after square bracket
        var before_sbracket = false;
        if (position.character !== 0) {
            var char = document.getText(new vscode.Range(position.translate(0, -1), position));
            if (char === "[") {
                before_sbracket = true;
            }
        }
        if (before_sbracket) {
            for (let bname of this.moose_blocks) {
                completions.push(new vscode.CompletionItem(bname, vscode.CompletionItemKind.Field));
            }
            completions.push(new vscode.CompletionItem("./"));
            completions.push(new vscode.CompletionItem("../"));
        }

        // MOOSE object name completions after 'type ='
        if (document.lineAt(position.line).text.trim().match("type*=*")) {
            // TODO MOOSE objects autocomplete could also be based on current block
            let moose_list = this.moose_objects.getMooseObjectsList();
            for (let uri of moose_list) {
                var path = pathparse.parse(uri.fsPath);
                let citem = new vscode.CompletionItem(" " + path.name, vscode.CompletionItemKind.Class);
                citem.detail = uri.fsPath; // this is at the top
                let descript = this.moose_objects.getDescription(uri);
                if (descript !== null){
                    citem.documentation = descript; // this is at the bottom
                }
                completions.push(citem);
            }
        }

        // new vscode.CompletionItem("active = ''"),  
        // TODO if `active` present in block, dim out non-active sub-blocks or action to fold them?

        return completions;
    }

}

class DocumentSymbolProvider implements vscode.DocumentSymbolProvider {
    public provideDocumentSymbols(document: vscode.TextDocument,
        token: vscode.CancellationToken): Thenable<vscode.SymbolInformation[]> {
        return new Promise((resolve, reject) => {
            var symbols = [];
            var head1_regex = new RegExp('\\[[_a-zA-Z0-9]+\\]');
            var head2_regex = new RegExp('\\[\\.\\/[_a-zA-Z0-9]+\\]');
            var in_variables = false;
            var kind = null;

            for (var i = 0; i < document.lineCount; i++) {
                var line = document.lineAt(i);

                // remove comments
                var text = line.text.trim().split("#")[0].trim();

                if (head1_regex.test(text)) {

                    // Check if in variables block
                    if (text.substr(1, text.length - 2).match('Variables') || text.substr(1, text.length - 2).match('AuxVariables')) {
                        in_variables = true;
                    } else {
                        in_variables = false;
                    }

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
                        name: text.substr(1, text.length - 2),
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

                    if (in_variables) {
                        kind = vscode.SymbolKind.Variable;
                    } else {
                        kind = vscode.SymbolKind.String;
                    }

                    symbols.push({
                        name: text.substr(3, text.length - 4),
                        containerName: "Sub Block",
                        kind: kind,
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