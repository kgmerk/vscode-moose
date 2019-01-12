/**
 * A module to manage a MOOSE input document 
 */
'use strict';

import ppath = require('path');
import * as fs from 'fs';

import * as moosedb from './moose_syntax';

/**
 * position within a document
 */
export interface Position {
    row: number;
    column: number;
}

/**
 * an implementation agnostic document interface
 */
export interface Document {
    /**
     * get path of document
     */
    getPath(): string;
    getLineCount(): number;
    /**
     * get full text of document
     */
    // getText(): string;
    /**
     * get text within a range
     * 
     * @param start [row, column]
     * @param end [row, column]
     */
    getTextInRange(start: [number, number], end: [number, number]): string;
    /**
     * get text for a single row/line
     * 
     * @param row
     */
    getTextForRow(row: number): string;
}

export interface Completion {
    kind: "block" | "parameter" | "type" | "value" | "closing";
    displayText: string;
    insertText: { type: "text" | "snippet", value: string };
    replacementPrefix?: string;
    description?: string;
    required?: boolean;
}

export interface OutlineParamItem {
    start: [number, number];
    end: [number, number];
    name: string;
    description: string;
    value: string | null;
}
export interface OutlineBlockItem {
    start: [number, number];
    end: [number, number] | null;
    level: number;
    name: string;
    description: string;
    children: OutlineBlockItem[];
    parameters: OutlineParamItem[];
    inactive: string[];  // a list of inactive children names
}
export interface SyntaxError {
    // closure = block not closed, 
    // duplication = duplication of block or parameter names
    // refcheck = internal reference checks (e.g. block or variable not found)
    // dbcheck =  checks against the syntax database (e.g. block or parameter not found)
    type: "closure" | "duplication" | "refcheck" | "dbcheck";
    row: number;
    columns: [number, number];
    msg: string;
    insertionBefore?: string;
    insertionAfter?: string;
}
export interface textEdit {
    type: "indent" | "blank-lines";
    start: [number, number];
    end: [number, number];
    text: string;
    msg: string;
}

/** an interface to describe a value in the document */
export interface ValueNode {
    description: string;
    // paramNode: moosedb.ParamNode;
    file?: string; // path to the definition (if undefined then in same document as value)
    defPosition: Position; // position of the definition
}

function __guard__(value: RegExpMatchArray | null,
    transform: (regarray: RegExpMatchArray) => string) {
    return typeof value !== 'undefined' && value !== null ? transform(value) : undefined;
}

// regexes
let emptyLine = /^\s*$/;
let insideBlockTag = /^\s*\[([^\]#\s]*)$/;
let blockTagContent = /^\s*\[([^\]]*)\]/;
let blockType = /^\s*type\s*=\s*([^#\s]+)/;
let typeParameter = /^\s*type\s*=\s*[^\s#=\]]*$/;
let parameterCompletion = /^\s*[^\s#=\]]*$/;
let otherParameter = /^\s*([^\s#=\]]+)\s*=\s*('\s*[^\s'#=\]]*(\s?)[^'#=\]]*|[^\s#=\]]*)$/;
let stdVector = /^std::([^:]+::)?vector<([a-zA-Z0-9_]+)(,\s?std::\1allocator<\2>\s?)?>$/;
// legacy regexp
let blockOpenTop = /^\s*\[([^.\/][^\/]*)\]/;
let blockCloseTop = /^\s*\[\]/;
let blockOpenOneLevel = /^\s*\[\.\/([^.\/]+)\]/;
let blockCloseOneLevel = /^\s*\[\.\.\/\]/;

/**
 * A class to manage a MOOSE input document
 * 
 * This class is agnostic to the implementing program 
 * and requires only a document object which provides a defined interface
 * 
 * @param doc the document object
 * @param syntaxdb
 * 
 */
export class MooseDoc {

    private syntaxdb: moosedb.MooseSyntaxDB;
    private doc: Document | null;

    constructor(syntaxdb: moosedb.MooseSyntaxDB, doc: Document | null = null) {
        this.doc = doc;
        this.syntaxdb = syntaxdb;
    }

    public setDoc(doc: Document) {
        this.doc = doc;
    }
    public getDoc() {
        if (this.doc === null) {
            throw Error('document no set');
        }
        return this.doc;
    }
    public getSyntaxDB() {
        return this.syntaxdb;
    }

    private static getWordAt(line: string, column: number, regex: string = "_0-9a-zA-Z") {

        let word: string;
        let range: [number, number];

        let left_regex = new RegExp("[" + regex + "]+$"); // $ matches the end of a line
        let right_regex = new RegExp("[^" + regex + "]");

        // Search for the word's beginning
        let left = line.slice(0, column + 1).search(left_regex);
        // Search for the word's end
        let right = line.slice(column).search(right_regex);

        if (left < 0) {
            // we are not in a word
            return null;
        } else if (right < 0) {
            // The last word in the string is a special case.
            word = line.slice(left);
            range = [left, line.length];
        } else {
            // Return the word, using the located bounds to extract it from the string.
            word = line.slice(left, right + column);
            range = [left, right + column];
        }

        if (word === "") {
            // don't allow empty strings
            return null;
        }
        return {
            word: word,
            start: range[0],
            end: range[1]
        };

    }

    /** find the node and path of the variable which the value is referencing
     * 
     * @param value the value to search for
     * @param paramName the parameter which it represents
     * @param valuePath the path to the value
     * @param explicitType the type of the sub-block
     */
    private async findValueReference(value: string, paramName: string, valuePath: string[], explicitType: string | null = null) {

        let node: ValueNode | null = null;
        let configPath: string[] | null = null;

        let paramsList = await this.syntaxdb.fetchParameterList(valuePath, explicitType);

        for (let param of paramsList) {
            if (param.name === paramName) {

                let hasType = (type: string, atype: string | null = null) => {
                    return param.cpp_type === type || this.isVectorOf(param.cpp_type, atype ? atype : type);
                };

                // if (hasType('bool')) {
                //     // no node
                // } else if (hasType('MooseEnum', 'MultiMooseEnum')) {
                //     // no node
                // } else if (hasType('OutputName')) {
                //     // no node
                // }

                let blockNames: string[] | null = null;
                if (hasType('NonlinearVariableName')) {
                    blockNames = ['Variables'];
                } else if (hasType('AuxVariableName')) {
                    blockNames = ['AuxVariables'];
                } else if (hasType('VariableName')) {
                    blockNames = ['Variables', 'AuxVariables'];
                } else if (hasType('FunctionName')) {
                    blockNames = ['Functions'];
                } else if (hasType('PostprocessorName')) {
                    blockNames = ['Postprocessors'];
                } else if (hasType('UserObjectName')) {
                    blockNames = ['Postprocessors', 'UserObjects'];
                } else if (hasType('VectorPostprocessorName')) {
                    blockNames = ['VectorPostprocessors'];
                } else if ((param.name === 'active' || param.name === "inactive") && valuePath.length === 1) {
                    blockNames = valuePath;
                }

                if (blockNames) {
                    for (let blockName of blockNames) {
                        for (let { name, row } of this.yieldSubBlockList([blockName])) {
                            if (name === value) {
                                // match = await this.syntaxdb.matchSyntaxNode([blockName, name]);
                                configPath = [blockName, name];
                                node = {
                                    description: "Referenced " + blockName.slice(0, blockName.length - 1),
                                    defPosition: { row: row, column: 0 }
                                };
                                break;
                            }
                        }
                        if (node) {
                            break;
                        }
                    }
                } else if (hasType('MaterialPropertyName')) {
                    // TODO DerivativeParsedMaterial blocks also has a parameter material_property_names 
                    // which can contain material name references in different ways (see https://mooseframework.inl.gov/old/wiki/PhysicsModules/PhaseField/DevelopingModels/FunctionMaterials/)
                    for (let { name, position, block, type } of this.yieldMaterialNameList()) {
                        if (name === value) {
                            configPath = ["Materials", block, type, name];
                            node = {
                                description: "Referenced Material",
                                defPosition: position
                            };
                            return { pnode: node, path: configPath };
                        } else if (name === null) {
                            // we want to try to find a default f_name
                            let paramList = await this.syntaxdb.fetchParameterList(["Materials", type]);
                            for (let mparam of paramList) {
                                if (["f_name", "h_name", "function_name"].indexOf(mparam.name) >= 0 && mparam.default === value) {
                                    configPath = ["Materials", block, type, mparam.default];
                                    node = {
                                        description: "Referenced Material",
                                        defPosition: position
                                    };
                                    return { pnode: node, path: configPath };
                                }
                            }
                        }
                    }
                } else if (hasType('FileName') || hasType('MeshFileName')) {
                    // let filePath = ppath.dirname(this.getDoc().getPath());
                    // TODO filename ValueNodes (what configpath?)
                    // need to convert relative paths to absolute path
                }
                return { pnode: node, path: configPath };
            }

        }

        return { pnode: node, path: configPath };
    }

    /** find node for a cursor position, and the path to it
    * 
    * @param pos position of cursor
    * @param regex defines characters allowed in a word
    */
    public async findCurrentNode(pos: Position, regex: string = "_0-9a-zA-Z") {

        let match: null | moosedb.nodeMatch = null;
        let node: moosedb.SyntaxNode | moosedb.ParamNode | ValueNode | null = null
        let rmatch: RegExpExecArray | null;

        let line = this.getDoc().getTextForRow(pos.row);
        let wordMatch = MooseDoc.getWordAt(line, pos.column, regex);
        if (wordMatch === null) {
            return null;
        }
        let { word, start, end } = wordMatch;

        let { configPath, explicitType } = await this.getCurrentConfigPath(pos);

        if (line.slice(start - 1, end + 1) === "[" + word + "]") {
            // block
            configPath.push(word);
            match = await this.syntaxdb.matchSyntaxNode(configPath);
            if (!match) {
                return null;
            }
            node = match.node;
        } else if (line.slice(start - 3, end + 1) === "[./" + word + "]") {
            //sub-block
            configPath.push(word);
            match = await this.syntaxdb.matchSyntaxNode(configPath);
            if (!match) {
                return null;
            }
            node = match.node;
        } else if (/\s*type\s*=\s*/.test(line.slice(0, start - 1))) {
            // type parameter
            match = await this.syntaxdb.matchSyntaxNode(configPath);
            if (match !== null) {
                let typedPath = this.syntaxdb.getTypedPath(configPath, word, match.fuzzyOnLast);
                match = await this.syntaxdb.matchSyntaxNode(typedPath);
                configPath.push(word);
            }
            if (!match) {
                return null;
            }
            node = match.node;
        } else if (/\s*=.*/.test(line.slice(end + 1))) {
            // parameter name
            let params = await this.syntaxdb.fetchParameterList(configPath, explicitType);
            for (let param of params) {
                if (param.name === word) {
                    if (explicitType) {
                        configPath.push(explicitType);
                    }
                    configPath.push(param.name);
                    node = param;
                }
            }
        } else if (!!(rmatch = /^\s*([^\s#=\]]+)\s*=.*/.exec(line))) {
            // value of parameter
            let paramName = rmatch[1];
            let { pnode, path } = await this.findValueReference(word, paramName, configPath, explicitType);
            if (pnode && path) {
                configPath = path;
                node = pnode;
            }
        }

        if (node === null) {
            return null;
        }

        return {
            node: node,
            path: configPath,
            range: [start, end]
        };
    }

    /** find available completions for a cursor position
     * 
     * @param pos position of cursor
     */
    public async findCompletions(pos: Position) {

        let completions: Completion[] = [];
        let completion: Completion;
        let match: RegExpExecArray | null;

        // get current line up to the cursor position
        let line = this.getDoc().getTextInRange([pos.row, 0], [pos.row, pos.column]);
        let prefix = this.getPrefix(line);

        let { configPath, explicitType } = await this.getCurrentConfigPath(pos);

        // for empty [] we suggest blocks
        if (this.isOpenBracketPair(line)) {
            completions = await this.completeOpenBracketPair(pos, configPath);
        } else if (this.isTypeParameter(line)) {
            completions = await this.completeTypeParameter(line, pos.column, configPath, explicitType);
        } else if (this.isParameterCompletion(line)) {
            completions = await this.completeParameter(configPath, explicitType);
        } else if (!!(match = otherParameter.exec(line))) {
            // special case where 'type' is an actual parameter (such as /Executioner/Quadrature)
            // TODO factor out, see above
            let param: moosedb.ParamNode;
            let paramName = match[1];
            let isQuoted = match[2][0] === "'";
            let hasSpace = !!match[3];
            for (param of Array.from(await this.syntaxdb.fetchParameterList(configPath, explicitType))) {
                if (param.name === paramName) {
                    completions = await this.computeValueCompletion(param, configPath, isQuoted, hasSpace);
                    break;
                }
            }
        }

        // set the custom prefix
        for (completion of Array.from(completions)) {
            completion.replacementPrefix = prefix;
        }

        return completions;
    }

    /** TODO add description
     * @param  {string} line
     */
    private getPrefix(line: string) {
        // Whatever your prefix regex might be
        let regex = /[\w0-9_\-.\/\[]+$/;

        // Match the regex to the line, and return the match
        return __guard__(line.match(regex), x => x[0]) || '';
    }

    /** determine the active block path at the current position
     * 
     * @param pos position of cursor
     */
    public async getCurrentConfigPath(pos: Position) {

        let configPath: string[] = [];
        let types: { config: string[], name: string }[] = [];
        let { row } = pos;
        let typePath;

        let line = this.getDoc().getTextInRange([pos.row, 0], [pos.row, pos.column]);

        let normalize = (configPath: string[]) => ppath.join.apply(undefined, configPath).split(ppath.sep);

        // find type path if below cursor line
        let trow = row;
        let tline = line;
        while (true) {
            if (trow + 1 >= this.getDoc().getLineCount()) {
                break;
            }

            if (blockTagContent.test(tline) || blockCloseTop.test(tline) || blockCloseOneLevel.test(tline)) {
                break;
            }

            let blockArray = blockType.exec(tline);
            if (blockArray !== null) {
                types.push({ config: [], name: blockArray[1] });
                break;
            }

            trow += 1;
            tline = this.getDoc().getTextForRow(trow);

            // remove comments
            let commentCharPos = tline.indexOf('#');
            if (commentCharPos >= 0) {
                tline = tline.substr(0, commentCharPos);
            }
        }

        while (true) {
            // test the current line for block markers
            let tagArray = blockTagContent.exec(line);
            let blockArray = blockType.exec(line);

            if (tagArray !== null) {
                // if (blockTagContent.test(line)) {
                let tagContent = tagArray[1].split('/');

                // [] top-level close
                if (tagContent.length === 1 && tagContent[0] === '') {
                    return { configPath: [] as string[], explicitType: null };
                } else {
                    // prepend the tagContent entries to configPath
                    Array.prototype.unshift.apply(configPath, tagContent);
                    for (typePath of Array.from(types)) {
                        Array.prototype.unshift.apply(typePath.config, tagContent);
                    }
                }

                if (tagContent[0] !== '.' && tagContent[0] !== '..') {
                    break;
                }
                // test for a type parameter
                // } else if (blockType.test(line)) {
            } else if (blockArray !== null) {
                types.push({ config: [], name: blockArray[1] });
            }

            // decrement row and fetch line (if we have not found a path we assume
            // we are at the top level)
            row -= 1;
            if (row < 0) {
                return { configPath: [] as string[], explicitType: null };
            }
            line = this.getDoc().getTextForRow(row);

            // remove comments
            let commentCharPos = line.indexOf('#');
            if (commentCharPos >= 0) {
                line = line.substr(0, commentCharPos);
            }
        }

        configPath = normalize(configPath);
        let type: string | null = null;
        for (typePath of Array.from(types)) {
            if (normalize(typePath.config).join('/') === configPath.join('/')) {
                type = typePath.name;
            }
        }
        return { configPath, explicitType: type };
    }

    /** check if there is an square bracket pair around the cursor
     * 
     * @param line 
     */
    private isOpenBracketPair(line: string) {
        return insideBlockTag.test(line);
    }

    /** provide completions for an open bracket pair
     * 
     * @param pos 
     * @param configPath 
     */
    private async completeOpenBracketPair(pos: Position, configPath: string[]) {

        let completions: Completion[] = [];
        let completion: string;

        // get the postfix (to determine if we need to append a ] or not)
        let postLine = this.getDoc().getTextInRange([pos.row, pos.column], [pos.row, pos.column + 1]);
        let blockPostfix = postLine.length > 0 && postLine[0] === ']' ? '' : ']';

        // handle relative paths
        //TODO this was in original code, but doesn't work with VSCode (as we don't use replacementPrefix)
        // let blockPrefix = configPath.length > 0 ? '[./' : '['; 
        let blockPrefix = configPath.length > 0 ? './' : '';

        // add block close tag to suggestions
        if (configPath.length > 0) {
            completions.push({
                kind: "closing",
                insertText: { type: "text", value: `../${blockPostfix}` }, // TODO originally included [ at start
                displayText: '../'
            });
        }

        // go over all possible syntax sub-blocks of the config path
        let syntax = await this.syntaxdb.getSubBlocks(configPath);

        for (let suggestionText of syntax) {
            let suggestion = suggestionText.split('/');

            completion = suggestion[configPath.length];

            // add to suggestions if it is a new suggestion
            if (completion === '*') {
                completions.push({
                    kind: 'block',
                    displayText: '*',
                    insertText: {
                        type: "snippet",
                        value: blockPrefix + '${1:name}' + blockPostfix
                    },
                });
            } else if (completion !== '') {
                if (completions.findIndex(c => c.displayText === completion) < 0) {
                    completions.push({
                        kind: "block",
                        insertText: {
                            type: "text",
                            value: blockPrefix + completion + blockPostfix
                        },
                        displayText: completion
                    });
                }
            }

        }

        return completions;
    }

    // check if the current line is a type parameter
    private isTypeParameter(line: string) {
        return typeParameter.test(line);
    }

    /** checks if this is a vector type build the vector cpp_type name 
     * for a given single type (checks for gcc and clang variants)
     * 
     * @param yamlType 
     * @param type 
     */
    private isVectorOf(yamlType: string, type: string) {
        let match = stdVector.exec(yamlType);
        return (match !== null) && (match[2] === type);
    }

    /** yield sub-blocks of a given set of top blocks
     *  
     * @param blockNames the names of the top blocks (e.g. Functions, PostProcessors)
     * @param gatherParameters if true, return parameters of the sub block
     * @param paramFilter if not null return only these parameters of the subblock
     */
    private * yieldSubBlockList(blockNames: string[],
        gatherParameters: Boolean = false, paramFilter: string[] | null = null) {
        let row = 0;
        let level = 0;
        let regexMatch: RegExpExecArray | null;
        let mainBlock: string | null = null;
        let subBlock: {
            mainBlock: string
            name: string,
            properties: { [index: string]: string },
            row: number
        } = { mainBlock: '', name: '', properties: {}, row: 0 };
 
        let nlines = this.getDoc().getLineCount();

        // parse contents of subBlock block
        while (true) {

            if (row >= nlines) {
                break;
            }

            let line = this.getDoc().getTextForRow(row);

            // scan through document, until a required block is open
            if (regexMatch = blockOpenTop.exec(line)) {
                if (blockNames.indexOf(regexMatch[1]) >= 0) {
                    // if the block has been found, remove it from the list
                    while (blockNames.indexOf(regexMatch[1]) >= 0) {
                        blockNames.splice(blockNames.indexOf(regexMatch[1]), 1);
                    }
                    mainBlock = regexMatch[1];
                }
            } else if (blockCloseTop.test(line)) {
                mainBlock = null;
                // if all blocks have been found, then finish
                if (blockNames.length <= 0) {
                    break;
                }
            }
            if (mainBlock === null) {
                // if we are not in a required block, then continue to next row
                row++;
                continue;
            }
            
            if (blockOpenOneLevel.test(line)) {
                if (level === 0) {
                    let blockopen = blockOpenOneLevel.exec(line);
                    if (blockopen !== null) {
                        subBlock = {
                            mainBlock: mainBlock,
                            name: blockopen[1],
                            properties: {},
                            row: row
                        };
                    }
                }
                level++;
            } else if (blockCloseOneLevel.test(line)) {
                level--;
                if (level === 0) {
                    yield subBlock;
                }
            } else if (level === 1 && gatherParameters && (regexMatch = otherParameter.exec(line))) {
                let paramName = regexMatch[1];
                if (paramFilter === null || paramFilter.indexOf(paramName) >= 0) {
                    subBlock.properties[paramName] = regexMatch[2];
                }
            }

            row++;
        }

    }

    /** yield names of materials in the Materials block (if present)
     *  
     */
    private * yieldMaterialNameList() {
        let row = 0;
        let level = 0;
        let subBlockName: string | null = null;
        let subBlockType: string | null = null;
        let matNames: { name: string | null, block: string, position: Position, type: string }[] = [];
        let regExec: RegExpExecArray | null;

        let nlines = this.getDoc().getLineCount();

        // find start of Materials block
        while (row < nlines) {
            let line = this.getDoc().getTextForRow(row);
            if (/^\s*\[Materials\]/.test(line)) {
                break;
            }
            row++;
        }
        let subblockRow = row;

        // parse contents of subBlock block
        while (true) {

            if (row >= nlines) {
                break;
            }
            let line = this.getDoc().getTextForRow(row);
            if (blockCloseTop.test(line)) {
                break;
            }

            if (blockOpenOneLevel.test(line)) {
                if (level === 0) {
                    let blockOpen = blockOpenOneLevel.exec(line);
                    if (blockOpen !== null) {
                        subBlockName = blockOpen[1];
                    }
                    subblockRow = row;
                }
                level++;
            } else if (blockCloseOneLevel.test(line)) {
                level--;
                //NB: we scan the whole block first, to find the type, before yielding names
                if (level === 0 && matNames.length === 0 && subBlockName && subBlockType) {
                    // we want to try to find a default f_name or function_name;
                    // let match = this.syntaxdb.fetchParameterList(["Materials", subBlockType])
                    // However, calling await in generators is only supported natively in Node v10+
                    // so for now we defer this to the calling function
                    yield {
                        name: null,
                        block: subBlockName,
                        type: subBlockType,
                        position: { row: subblockRow, column: 0 } as Position
                    };
                }
                if (level === 0 && subBlockType !== null) {
                    for (let matname of matNames) {
                        matname.type = subBlockType
                        yield matname;
                    }
                }
                if (level === 0) {
                    subBlockName = null;
                    subBlockType = null;
                    matNames = [];
                }
            } else if (level === 1 && subBlockName !== null) {
                // find type
                if (regExec = blockType.exec(line)) {
                    subBlockType = regExec[1];
                } else if (regExec = /^\s*(f_name|h_name|function_name)\s*=\s*[\'\"]*([^#\s\'\"]+)/.exec(line)) {
                    // find f_name or function_name (used for most materials)
                    let f_name = regExec[2];
                    matNames = [{
                        name: f_name,
                        block: subBlockName,
                        type: "",
                        position: { row: row, column: line.search(RegExp("[\\s\\\'\\\"]" + f_name + "[\\s\\\'\\\"]")) + 1 } as Position
                    }];
                } else if (regExec = /^\s*prop_names\s*=\s*[\'\"]*([^#\'\"]+)/.exec(line)) {
                    // find prop_names (used for constants)
                    let p_names = regExec[1].split(/\s+/).filter(Boolean); // filter removes zero-length strings
                    // TODO check prop_names can't overflow on to new line 
                    matNames = [];
                    for (let p_name of p_names) {
                        matNames.push({
                            name: p_name,
                            block: subBlockName,
                            type: "",
                            position: { row: row, column: line.search(RegExp("[\\s\\\'\\\"]" + p_name + "[\\s\\\'\\\"]")) + 1 } as Position
                        });
                    }
                }

                // TODO is there an obvious way to work out which parameter defines the materials names?
            }

            row++;
        }

    }

    /** generic completion list builder for subblock names
     * 
     * @param blockNames 
     * @param propertyNames 
     */
    private computeSubBlockNameCompletion(blockNames: string[], propertyNames: string[]) {
        let completions: Completion[] = [];
        for (let block of Array.from(blockNames)) {
            for (let { name, properties } of Array.from(this.yieldSubBlockList([block], true, propertyNames))) {
                let doc = [];
                for (let propertyName of Array.from(propertyNames)) {
                    if (propertyName in properties) {
                        doc.push(properties[propertyName]);
                    }
                }

                completions.push({
                    kind: "block",
                    insertText: {
                        type: "text",
                        value: name
                    },
                    displayText: name,
                    description: doc.join(' ')
                });
            }
        }

        return completions;
    }

    // variable completions
    private computeVariableCompletion(blockNames: string[]) {
        return this.computeSubBlockNameCompletion(blockNames, ['order', 'family']);
    }

    // Filename completions
    private computeFileNameCompletion(wildcards: string[]) {
        let filePath = ppath.dirname(this.getDoc().getPath());
        let dir = fs.readdirSync(filePath);  // TODO this should be async

        let completions: Completion[] = [];
        for (let name of Array.from(dir)) {
            completions.push({
                kind: "value",
                insertText: {
                    type: "text",
                    value: name
                },
                displayText: name
            });
        }

        return completions;
    }

    /** build the suggestion list for parameter values 
     * 
     * @param param 
     * @param isQuoted 
     * @param hasSpace 
     */
    private async computeValueCompletion(param: moosedb.ParamNode, configPath: string[], isQuoted: boolean = false, hasSpace: boolean = false) {
        let completions: Completion[] = [];
        let singleOK = !hasSpace;
        let vectorOK = isQuoted || !hasSpace;
        let hasType = (type: string, atype: string | null = null) => {
            return param.cpp_type === type && singleOK || this.isVectorOf(param.cpp_type, atype ? atype : type) && vectorOK;
        };

        if (hasType('bool')) {
            completions = [
                {
                    kind: 'value',
                    insertText: {
                        type: "text",
                        value: 'true'
                    },
                    displayText: 'true'
                },
                {
                    kind: 'value',
                    insertText: {
                        type: "text",
                        value: 'false'
                    },
                    displayText: 'false'
                }];
        } else if (hasType('MooseEnum', 'MultiMooseEnum')) {
            if (param.options !== null && param.options !== undefined) {
                for (let option of Array.from(param.options.split(' '))) {
                    completions.push({
                        kind: 'value',
                        insertText: {
                            type: "text",
                            value: option
                        },
                        displayText: option
                    });
                }
            }
        } else if (hasType('NonlinearVariableName')) {
            completions = this.computeVariableCompletion(['Variables']);
        } else if (hasType('AuxVariableName')) {
            completions = this.computeVariableCompletion(['AuxVariables']);
        } else if (hasType('VariableName')) {
            completions = this.computeVariableCompletion(['Variables', 'AuxVariables']);
        } else if (hasType('FunctionName')) {
            completions = this.computeSubBlockNameCompletion(['Functions'], ['type']);
        } else if (hasType('PostprocessorName')) {
            completions = this.computeSubBlockNameCompletion(['Postprocessors'], ['type']);
        } else if (hasType('UserObjectName')) {
            completions = this.computeSubBlockNameCompletion(['Postprocessors', 'UserObjects'], ['type']);
        } else if (hasType('VectorPostprocessorName')) {
            completions = this.computeSubBlockNameCompletion(['VectorPostprocessors'], ['type']);
        } else if (hasType('OutputName')) {
            for (let output of ['exodus', 'csv', 'console', 'gmv', 'gnuplot', 'nemesis', 'tecplot', 'vtk', 'xda', 'xdr']) {
                completions.push({
                    kind: "value",
                    insertText: {
                        type: "text",
                        value: output
                    },
                    displayText: output
                });
            }
        } else if (hasType('FileName') || hasType('MeshFileName')) {
            completions = this.computeFileNameCompletion(['*.e']);
        } else if (hasType('MaterialPropertyName')) {
            // TODO DerivativeParsedMaterial blocks also has a parameter material_property_names 
            // which can contain material name references in different ways (see https://mooseframework.inl.gov/old/wiki/PhysicsModules/PhaseField/DevelopingModels/FunctionMaterials/)
            for (let { name, block, type } of this.yieldMaterialNameList()) {
                if (name === null) {
                    // we want to try to find a default f_name
                    let paramList = await this.syntaxdb.fetchParameterList(["Materials", type]);
                    for (let mparam of paramList) {
                        if (["f_name", "h_name", "function_name"].indexOf(mparam.name) >= 0 && mparam.default) {
                            completions.push({
                                kind: "value",
                                displayText: mparam.default,
                                description: ["Materials", block, type, mparam.default].join("/"),
                                insertText: {
                                    type: "text",
                                    value: mparam.default
                                }
                            });
                            break;
                        }
                    }
                } else {
                    completions.push({
                        kind: "value",
                        displayText: name,
                        description: "Materials/" + block + "/" + type,
                        insertText: {
                            type: "text",
                            value: name
                        }
                    });
                }
            }
        } else if (param.name === 'active' || param.name === "inactive") {
            completions = this.computeSubBlockNameCompletion(configPath, ['type']);
        }

        return completions;
    }

    /** provide completions for a type parameter
      * 
      * @param line the text for the line
      * @param column the position of the cursor on the line
      * @param configPath 
      */
    private async completeTypeParameter(line: string, pos: number, configPath: string[], explicitType: string | null) {

        let completions: Completion[] = [];
        let completion: string;

        // transform into a '<type>' pseudo path
        let originalConfigPath = configPath.slice();

        // find yaml node that matches the current config path best
        let match = await this.syntaxdb.matchSyntaxNode(configPath);

        if (match === null) {
            return completions;
        }
        let { fuzzyOnLast } = match;

        if (fuzzyOnLast) {
            configPath.pop();
        } else {
            configPath.push('<type>');
        }

        // find yaml node that matches the current config path best
        let newMatch = await this.syntaxdb.matchSyntaxNode(configPath);
        if (newMatch !== null) {
            let { node } = newMatch;
            // iterate over subblocks and add final yaml path element to suggestions
            for (let subNode of await this.syntaxdb.iterateSubBlocks(node, configPath)) {
                completion = subNode.name.split('/').slice(-1)[0];
                completions.push({
                    kind: "type",
                    insertText: {
                        type: "text",
                        value: line[pos - 1] === "=" ? " " + completion : completion
                    },
                    displayText: completion,
                    description: subNode.description
                });
            }
        } else {
            // special case where 'type' is an actual parameter (such as /Executioner/Quadrature)
            // TODO factor out, see below
            let otherArray = otherParameter.exec(line);
            if (otherArray !== null) {
                let paramName = otherArray[1];
                let param: moosedb.ParamNode;
                for (param of Array.from(await this.syntaxdb.fetchParameterList(originalConfigPath, explicitType))) {
                    if (param.name === paramName) {
                        completions = await this.computeValueCompletion(param, originalConfigPath);
                        break;
                    }
                }
            }
        }
        return completions;

    }

    /** check if the current line is a parameter completion
     * 
     * @param line 
     */
    private isParameterCompletion(line: string) {
        return parameterCompletion.test(line);
    }

    private async completeParameter(configPath: string[], explicitType: string | null) {

        let completions: Completion[] = [];
        let paramNamesFound: string[] = [];
        let param: moosedb.ParamNode;

        // loop over valid parameters
        let params = await this.syntaxdb.fetchParameterList(configPath, explicitType);
        for (param of Array.from(params)) {
            if (paramNamesFound.findIndex(value => value === param.name) !== -1) {
                continue;
            }
            paramNamesFound.push(param.name);

            let defaultValue = param.default || '';
            if (defaultValue.indexOf(' ') >= 0) {
                defaultValue = `'${defaultValue}'`;
            }

            if (param.cpp_type === 'bool') {
                if (defaultValue === '0') {
                    defaultValue = 'false';
                }
                if (defaultValue === '1') {
                    defaultValue = 'true';
                }
            }

            let completion: Completion = {
                kind: param.name === 'type' ? 'type' : "parameter",
                required: param.required.toLowerCase() === "yes" ? true : false,
                displayText: param.name,
                insertText: {
                    type: "snippet",
                    value: param.name + ' = ${1:' + defaultValue + '}'
                },
                description: param.description,
            };
            // TODO remove existing "= <value>"

            completions.push(completion);
        }
        return completions;
    }

    // TODO issue when sub-block named the same as a type should include a warning if this is the case

    /** assess the outline of the whole document
     * 
     * Returns an object containing:
     * 
     * - **outline**: a heirarchical outline of the the documents blocks and subblocks
     * - **edits**: a list of ranges in the document where formatting edits are reccomended (and what those edits are)
     * - **errors**: a list of ranges in the document where there are syntactical errors (and what those erros are)
     * 
     * @param indentLength the number of spaces per indent
     * 
     */
    public async assessOutline(indentLength: number = 4) {

        let outlineItems: OutlineBlockItem[] = [];
        let syntaxErrors: SyntaxError[] = [];
        let textEdits: textEdit[] = [];

        let line: string = "";
        let currLevel = 0;
        let indentLevel = 0;
        let emptyLines: number[] = [];

        // ensure syntax DB has loaded
        try {
            await this.syntaxdb.retrieveSyntaxNodes();
        } catch (err) {
            // return { outline: outlineItems, errors: syntaxErrors, edits: textEdits };
        }

        for (var row = 0; row < this.getDoc().getLineCount(); row++) {

            line = this.getDoc().getTextForRow(row);

            emptyLines = this.detectBlankLines(emptyLines, row, textEdits, line);

            if (blockOpenTop.test(line)) {
                await this.assessMainBlock(currLevel, syntaxErrors, row, line, outlineItems);
                currLevel = 1;
                indentLevel = 0;
            } else if (blockCloseTop.test(line)) {
                await this.closeMainBlock(currLevel, syntaxErrors, row, line, outlineItems);
                currLevel = 0;
                indentLevel = 0;
            } else if (blockOpenOneLevel.test(line)) {
                currLevel = await this.assessSubBlock(currLevel, syntaxErrors, row, line, outlineItems);
                indentLevel = currLevel - 1;
            } else if (blockCloseOneLevel.test(line)) {
                currLevel = await this.closeSubBlock(currLevel, syntaxErrors, row, line, outlineItems);
                indentLevel = currLevel;
            } else if (/^\s*[_a-zA-Z0-9]+\s*=.*$/.test(line)) {
                await this.assessParameter(line, outlineItems, syntaxErrors, row, currLevel);
                indentLevel = currLevel;
            } else {
                indentLevel = currLevel;
            }

            // check all lines are at correct indentation level
            // TODO indent lines after parameter definitions (that are not just comments) by extra space == '<name> = '
            let firstChar = line.search(/[^\s]/);
            if (firstChar >= 0 && firstChar !== indentLevel * indentLength) {
                textEdits.push({
                    type: "indent",
                    start: [row, 0],
                    end: [row, firstChar],
                    text: " ".repeat(indentLevel * indentLength),
                    msg: "wrong indentation",
                });
            }

        }

        emptyLines = this.detectBlankLines(emptyLines, row, textEdits);
        // check no blocks are left unclosed
        if (currLevel !== 0) {
            syntaxErrors.push({
                type: "closure",
                row: row, columns: [0, line.length],
                msg: 'final block(s) unclosed',
                insertionAfter: "[../]\n".repeat(currLevel - 1) + "[]\n"
            });
            await this.closeFinalBlockAndChildren(outlineItems, 1, row, "", syntaxErrors);
        }
        emptyLines = this.detectBlankLines(emptyLines, row, textEdits, line);

        return { outline: outlineItems, errors: syntaxErrors, edits: textEdits };
    }

    /** detect multiple blank lines */
    private detectBlankLines(emptyLines: number[], row: number, textEdits: textEdit[], line: string | null = null) {
        if (line !== null && emptyLine.test(line)) {
            emptyLines.push(row);
        }
        else {
            if (emptyLines.length > 1) {
                textEdits.push({
                    type: "blank-lines",
                    start: [emptyLines[0], 0],
                    end: [row - 1, line === null ? 0 : line.length],
                    text: "",
                    msg: "multiple blank lines",
                });
            }
            emptyLines = [];
        }
        return emptyLines;
    }

    private async assessMainBlock(level: number, syntaxErrors: SyntaxError[], row: number, line: string, outlineItems: OutlineBlockItem[]) {

        let blockName: string;

        // test we are not already in a top block
        if (level > 0) {
            syntaxErrors.push({
                type: "closure",
                row: row, columns: [0, line.length],
                msg: 'block opened before previous one closed',
                insertionBefore: "[../]\n".repeat(level - 1) + "[]\n"
            });
            await this.closeFinalBlockAndChildren(outlineItems, 1, row - 1, line, syntaxErrors);
            level = 0;
        }

        // get name of the block
        let blocknames = blockOpenTop.exec(line);
        blockName = blocknames !== null ? blocknames[1] : '';
        if (outlineItems.map(o => o.name).indexOf(blockName) !== -1) {
            syntaxErrors.push({
                type: "duplication",
                row: row, columns: [0, line.length],
                msg: 'duplicate block name'
            });
        }

        // add the block to the outline 
        outlineItems.push({
            name: blockName,
            description: "",
            level: 1,
            start: [row, line.search(/\[/)],
            end: null,
            children: [],
            parameters: [],
            inactive: []
        });

        return;
    }

    private async closeMainBlock(currLevel: number, syntaxErrors: SyntaxError[], row: number, line: string, outlineItems: OutlineBlockItem[]) {

        // check all sub-blocks have been closed
        if (currLevel > 1) {
            syntaxErrors.push({
                type: "closure",
                row: row, columns: [0, line.length],
                msg: 'closed parent block before closing children',
                insertionBefore: "[../]\n".repeat(currLevel - 1)
            });
            await this.closeFinalBlockAndChildren(outlineItems, 2, row - 1, line, syntaxErrors);
        }
        // check a main block has been opened
        else if (currLevel < 1) {
            syntaxErrors.push({
                type: "closure",
                row: row, columns: [0, line.length],
                msg: 'closed block before opening new one',
                insertionBefore: "[${1:name}]\n"
            });
        }
        await this.closeFinalBlockAndChildren(outlineItems, 1, row, line, syntaxErrors);
    }

    private async assessSubBlock(currLevel: number, syntaxErrors: SyntaxError[], row: number, line: string, outlineItems: OutlineBlockItem[]) {

        let currBlockName: string;

        // check we are in a main block
        if (currLevel === 0) {
            syntaxErrors.push({
                type: "closure",
                row: row, columns: [0, line.length],
                msg: 'opening sub-block before main block open',
                insertionBefore: "[${1:name}]\n"
            });
            currLevel = 1;
        }

        // get parent node
        let { child } = MooseDoc.getFinalChild(outlineItems, currLevel);
        if (child === null) { 
            currLevel++;
            return currLevel;
        }

        // get name of the block
        let blockregex = blockOpenOneLevel.exec(line);
        currBlockName = blockregex !== null ? blockregex[1] : '';

        currLevel++;
        child.children.push({
            name: currBlockName,
            description: "",
            level: currLevel,
            start: [row, line.search(/\[/)],
            end: null,
            children: [],
            parameters: [],
            inactive: []
        });
        return currLevel;
    }

    private async closeSubBlock(currLevel: number, syntaxErrors: SyntaxError[], row: number, line: string, outlineItems: OutlineBlockItem[]) {
        if (currLevel === 0) {
            syntaxErrors.push({
                type: "closure",
                row: row, columns: [0, line.length],
                msg: 'closing sub-block before opening main block',
            });
        }
        else if (currLevel === 1) {
            syntaxErrors.push({
                type: "closure",
                row: row, columns: [0, line.length],
                msg: 'closing sub-block before opening one',
            });
        }
        else {
            let levelsClosed = await this.closeFinalBlockAndChildren(outlineItems, currLevel, row, line, syntaxErrors);
            currLevel = currLevel - levelsClosed;
        }
        return currLevel;
    }

    private async assessParameter(line: string, outlineItems: OutlineBlockItem[], syntaxErrors: SyntaxError[], row: number, currLevel: number) {

        let nameRegex = /^\s*([_a-zA-Z0-9]+)\s*=.*/.exec(line);
        let paramName = nameRegex !== null ? nameRegex[1] : '';

        let valueRegex = /^\s*[_a-zA-Z0-9]+\s*=\s*[\'\"]*([^#\'\"]+)/.exec(line);
        let paramValue = valueRegex !== null ? valueRegex[1].trim() === "" ? null : valueRegex[1].trim() : null;  // TODO this won't capture values which go over multiple lines 

        let { child: blockItem } = MooseDoc.getFinalChild(outlineItems, currLevel);
        if (blockItem !== null) {
            blockItem.parameters.push({
                name: paramName,
                description: "",
                start: [row, line.search(/[^\s]/)],
                end: [row, line.length], // TODO end before comments
                value: paramValue
            });
        }

    }

    /**
     * close a single block, updating its end row and active children
     */
    private async closeSingleBlock(block: OutlineBlockItem, endPos: [number, number], parentPath: string[]) {

        let syntaxErrors: SyntaxError[] = [];

        // update end row
        block.end = endPos;

        // construct a dictionary of child names
        let childDict: { [id: string]: OutlineBlockItem[] } = {};
        for (let child of block.children) {
            if (child.name in childDict) {
                childDict[child.name].push(child);
                // add syntax error for duplication
                syntaxErrors.push({
                    type: "duplication",
                    row: child.start[0], columns: [child.start[1], child.end ? ((child.start[0] === child.end[0]) ? child.end[1] : child.end[0]) : child.start[1]],
                    msg: 'duplicate block name'
                });
            } else {
                childDict[child.name] = [child];
            }
        }

        // construct a dictionary of paramter names
        let paramDict: { [id: string]: OutlineParamItem[] } = {};
        for (let param of block.parameters) {
            if (param.name in paramDict) {
                paramDict[param.name].push(param);
                // add syntax error for duplication
                syntaxErrors.push({
                    type: "duplication",
                    row: param.start[0], columns: [param.start[1], param.start[0] === param.end[0] ? param.end[1] : param.end[0]],
                    msg: 'duplicate parameter name'
                });
            } else {
                paramDict[param.name] = [param];
            }
        }

        // check if active / inactive parameters are present, and derive inactive children
        if ("active" in paramDict && "inactive" in paramDict) {
            // TODO does active override inactive or visa-versa, or are they not both allowed
            let error: SyntaxError = {
                type: "duplication",
                row: block.start[0],
                columns: [0, block.start[1]],
                msg: 'active and inactive parameters are not allowed in the same block'
            };
            syntaxErrors.push(error);
        } else if ("active" in paramDict) {
            // only use first instance
            let param = paramDict["active"][0];
            if (param.value) {
                let activeBlocks = param.value.split(/\s+/).filter(Boolean); // filter removes zero-length strings
                // check the specified blocks are present
                for (let activeBlock of activeBlocks) {
                    if (!(activeBlock in childDict)) {
                        let error: SyntaxError = {
                            type: "refcheck",
                            row: param.start[0],
                            columns: [param.start[1], param.start[0] === param.end[0] ? param.end[1] : param.end[0]],
                            msg: 'subblock specified in active parameter value not found: ' + activeBlock
                        };
                        syntaxErrors.push(error);
                    }
                }
                // add any subblock missing from active list to inactive 
                let inactiveChildren: string[] = [];
                for (let name in childDict) {
                    if (activeBlocks.indexOf(name) < 0) {
                        inactiveChildren.push(name);
                    }
                }
                block.inactive = inactiveChildren;
            }
        } else if ("inactive" in paramDict) {
            // only use first instance
            let param = paramDict["inactive"][0];
            if (param.value) {
                let inactiveBlocks = param.value.split(/\s+/).filter(Boolean); // filter removes zero-length strings
                // check the specified blocks are present
                for (let inactiveBlock of inactiveBlocks) {
                    if (!(inactiveBlock in childDict)) {
                        let error: SyntaxError = {
                            type: "refcheck",
                            row: param.start[0],
                            columns: [param.start[1], param.start[0] === param.end[0] ? param.end[1] : param.end[0]],
                            msg: 'subblock specified in inactive parameter value not found: ' + inactiveBlock
                        };
                        syntaxErrors.push(error);
                    }
                }
                // add any subblock included in inactive list to inactive 
                let inactiveChildren: string[] = [];
                for (let name in childDict) {
                    if (inactiveBlocks.indexOf(name) >= 0) {
                        inactiveChildren.push(name);
                    }
                }
                block.inactive = inactiveChildren;
            }
        }

        // find the path of the node for the block
        let configPath = parentPath.concat([block.name]);
        let blockMatch = await this.syntaxdb.matchSyntaxNode(configPath);
        let typeName: null | string = null;
        let typeMatch: null | moosedb.nodeMatch = null;
        let node: moosedb.SyntaxNode;
        if (blockMatch !== null) {
            // find type of block (use only first instance)
            if ("type" in paramDict && paramDict["type"][0].value) {
                typeName = paramDict["type"][0].value
                let typedPath = this.syntaxdb.getTypedPath(configPath, typeName, blockMatch.fuzzyOnLast);
                typeMatch = await this.syntaxdb.matchSyntaxNode(typedPath);
            }
        }
        if (blockMatch === null) {
            let error: SyntaxError = {
                type: "dbcheck",
                row: block.start[0],
                columns: [block.start[1], block.start[1]],
                msg: 'block path was not found in database: ' + configPath.join("/")
            };
            syntaxErrors.push(error);
        } else {
            // add details for block
            if (typeMatch) {
                node = typeMatch.node
            } else {
                node = blockMatch.node
            }
            block.description = node.description;

            // convert node parameters into dictionary
            let nodeParamDict: { [id: string]: moosedb.ParamNode } = {};
            for (let nparam of await this.syntaxdb.fetchParameterList(configPath, typeName)) {
                nodeParamDict[nparam.name] = nparam;
            }

            // add details and checks for parameters
            if (configPath[0] !== "GlobalParams") {
                for (let pname in paramDict) {
                    if (pname in nodeParamDict) {
                        for (let param of paramDict[pname]) {
                            param.description = nodeParamDict[pname].description;
                        }
                    } else {
                        for (let param of paramDict[pname]) {
                            let stringPath = (typeName !== null) ? configPath.concat([typeName]).join("/") : configPath.join("/");
                            let error: SyntaxError = {
                                type: "dbcheck",
                                row: param.start[0],
                                columns: [param.start[1], param.start[0] === param.end[0] ? param.end[1] : param.end[0]],
                                msg: 'parameter name "'+pname+'" was not found for this block in database: ' + stringPath
                            };
                            syntaxErrors.push(error);
                        }
                    }
                }
            }
            // TODO deal with parameters in GlobalParams block (must gather then on a first parse)
            
        }

        // TODO check all required parameters are present (but must account for parameters specified in GlobalParams)

        return syntaxErrors;
    }

    /** Close the final block, at a particular level, 
     * and update its item with details of the end row etc.
     * Also close any child blocks which are still open
     * 
     * @param outline 
     * @param blockLevel the level of the block to close
     * @param row the row number of the closure
     * @param length the length of the closure line
     * @param syntaxErrors the list of errors to add to
     * @returns number of levels closed
     */
    private async closeFinalBlockAndChildren(outline: OutlineBlockItem[],
        blockLevel: number, row: number, line: string, syntaxErrors: SyntaxError[]) {
        let levelsClosed = 0;
        let configPath: string[] = [];

        // if no blocks
        if (outline.length === 0) {
            return levelsClosed;
        }

        // navigate to required initial block level
        let item: OutlineBlockItem = outline[outline.length - 1];
        for (let l = 1; l < blockLevel; l++) {
            if (item.children.length === 0) {
                return levelsClosed;
            }
            configPath.push(item.name);
            item = item.children[item.children.length - 1];
        }

        // check if this block is already closed and, if not close it
        if (item.end !== null) {
            // throw Error('block already closed');
        } else {
            let closePos = line.search(/\]/);
            let errors = await this.closeSingleBlock(item, [row, closePos >= 0 ? closePos + 1 : 0], configPath)
            syntaxErrors.push(...errors);
            levelsClosed++;
        }
        // search for any open children and close them
        while (item.children.length > 0) {
            configPath.push(item.name);
            item = item.children[item.children.length - 1];
            if (item.end === null) {
                let errors = await this.closeSingleBlock(item, [row, 0], configPath)
                syntaxErrors.push(...errors);
                levelsClosed++;
            }
        }
        return levelsClosed;
    }

    /** navigate to the final child item of a certain level
     * 
     * @param outline 
     * @param level 
     */
    private static getFinalChild(outline: OutlineBlockItem[], level: number) {

        if (outline.length === 0) {
            return { child: null, config: [] as string[] };
        }
        let finalItem: OutlineBlockItem = outline[outline.length - 1];
        let item: OutlineBlockItem;
        let config = [finalItem.name];
        for (let l = 1; l < level; l++) {
            item = finalItem.children[finalItem.children.length - 1];
            finalItem = item;
            config.push(finalItem.name);
        }
        return { child: finalItem, config: config };
    }

}
