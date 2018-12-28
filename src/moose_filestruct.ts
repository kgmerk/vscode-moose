'use strict';
// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import * as pathparse from 'path';
import * as globToregex from 'glob-to-regexp';
import * as fileread from 'fs';

export class MooseFileStruct {
    /**
     * this class handles maintaining a list of MOOSE object URIs and descriptions
     */
    
    // see https://github.com/Microsoft/vscode-cpptools-api and https://stackoverflow.com/questions/41559471/is-it-possible-to-call-command-between-extensions-in-vscode 
    // private context: vscode.ExtensionContext;
    private moose_objects: {
        [id: string]: vscode.Uri;
    };
    private moose_descripts: {
        [id: string]: string | null;
    };
    constructor() {
        // TODO persistently store moose object data, maybe using context.workspaceState or context.storagePath? (but what if files have been changed outside vs-code)
        // this.context = context
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
        let name = pathparse.parse(uri.fsPath).name;
        let alias: {
            [id: string]: string;
        };
        alias = vscode.workspace.getConfiguration('moose.object').get('alias', {});
        if (name in alias) {
            name = alias[name];
        }
        return name;
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
        const findModules = vscode.workspace.getConfiguration('moose.include').get('modules', []);
        const findTypes = vscode.workspace.getConfiguration('moose.include').get('types', []);
        let includePaths: string[] = [];
        for (let type of findTypes) {
            includePaths.push("**/framework/src/" + type + "/*.C");
            for (let module of findModules) {
                includePaths.push("**/modules/" + module + "/src/" + type + "/*.C");
            }
        }
        // include user defined objects
        const findOthers = vscode.workspace.getConfiguration('moose.include').get('relpaths', []);
        for (let other of findOthers) {
            includePaths.push(other);
        }
        return includePaths;
    }
    private buildExcludes() {
        return vscode.workspace.getConfiguration('moose.exclude').get('relpaths', []);
    }
    private ignoreWorkspace(uri: vscode.Uri) {
        const workpath = vscode.workspace.getWorkspaceFolder(uri);
        if (!workpath) {
            return true;
        }
        for (let wrkregex of vscode.workspace.getConfiguration('moose.exclude').get('workspaces', [])) {
            if (globToregex(wrkregex).test(workpath.uri.fsPath)) {
                return true;
            }
        }
        return false;
    }
    async findFilesInWorkspace(include: string, exclude = '', maxResults = 2) {
        const foundFiles = await vscode.workspace.findFiles(include, exclude, maxResults);
        return foundFiles;
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
        const uris = this.findFilesInWorkspace(include, exclude, 100000);
        // build names dict
        uris.then(uris_found => {
            let errors = ["duplicates found; "];
            for (let uri of uris_found) {
                if (!this.ignoreWorkspace(uri)) {
                    const objname = this.extractName(uri);
                    if (objname in this.moose_objects) {
                        errors.push(this.moose_objects[objname].fsPath + " & " + uri.fsPath);
                    }
                    else {
                        this.moose_objects[objname] = uri;
                    }
                }
            }
            if (errors.length > 1) {
                this.logError(errors.join("\n"));
            }
        });
        // build description dict
        uris.then(uris_found => {
            for (let uri of uris_found) {
                if (!this.ignoreWorkspace(uri)) {
                    const objname = this.extractName(uri);
                    if (!(objname in this.moose_descripts)) {
                        this.createDescription(uri);
                    }
                }
            }
        });
        sbar.dispose();
    }
    public removeMooseObject(uri: vscode.Uri) {
        const objname = this.extractName(uri);
        if (objname in this.moose_objects) {
            if (uri.fsPath === this.moose_objects[objname].fsPath) {
                this.logDebug("removing path " + uri.fsPath);
                delete this.moose_objects[objname];
                delete this.moose_descripts[objname];
            }
        }
    }
    public addMooseObject(uri: vscode.Uri) {
        // console.log("trigerred addMooseObject: "+uri.fsPath);
        if (!this.ignoreWorkspace(uri)) {
            return;
        }
        // we need the path relative to the workspace folder
        let wrkfolder = vscode.workspace.getWorkspaceFolder(uri);
        if (!wrkfolder) {
            return;
        }
        const path = pathparse.relative(wrkfolder.uri.fsPath, uri.fsPath);
        let adduri = false;
        for (let inregex of this.buildIncludes()) {
            let re = globToregex(inregex, { globstar: true });
            // console.log(String(inregex)+" & "+path+" -> "+String(re.test(path)));
            if (re.test(path)) {
                adduri = true;
                break;
            }
        }
        if (!adduri) {
            return;
        }
        for (let exregex of this.buildExcludes()) {
            let re = globToregex(exregex, { globstar: true });
            // console.log(String(exregex)+" & "+path+" -> "+String(re.test(path)));
            if (re.test(path)) {
                adduri = false;
                break;
            }
        }
        if (adduri) {
            const objname = this.extractName(uri);
            if (objname in this.moose_objects) {
                this.logError("duplicates found; " + this.moose_objects[objname].fsPath + " & " + uri.fsPath);
            }
            this.logDebug("adding path: " + path);
            this.moose_objects[objname] = uri;
            this.createDescription(uri);
        }
        return;
    }
    private extractClassdescript(uri: vscode.Uri, ftype: string = 'utf8') {
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
        return new Promise<string | null>(function (resolve, reject) {
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
    public createDescription(uri: vscode.Uri) {
        /** return a description of the moose object, based on params.addClassDescription value
         * if not available, an attempt to read it from the file will be made
         */
        const objname = this.extractName(uri);
        var descript: Promise<string | null>;
        if (objname in this.moose_descripts) {
            descript = new Promise((resolve, reject) => { resolve(this.moose_descripts[objname]); });
            return descript;
        }
        descript = this.extractClassdescript(uri);
        descript.then(value => this.moose_descripts[objname] = value);
        return descript;
    }
    public getDescription(uri: vscode.Uri) {
        /** return a description of the moose object, based on params.addClassDescription value
         *
         */
        const objname = this.extractName(uri);
        if (objname in this.moose_descripts) {
            return this.moose_descripts[objname];
        }
        return;
    }
}
