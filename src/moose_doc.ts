/**
 * A module to manage a MOOSE input document 
 */
'use strict';

import ppath = require('path');
import * as fs from 'fs';

import * as moosedb from './moose_syntax';
import { Position, Definition } from './shared';

/**
 * an implementation agnostic document interface
 */
export interface Document {
    /**
     * get path of document
     */
    getPath(): string;
    getLineCount(): number;
    // get full text of document
    // getText(): string;
    /**
     * get text within a range
     */
    getTextInRange(start: Position, end: Position): string;
    /**
     * get text for a single row/line
     */
    getTextForRow(row: number): string;
    /**
     * iterate over all lines of the document
     */
    iterLines(initRow: number): IterableIterator<{ row: number, line: string }>;
    // TODO add optional start/end rows to iterLines
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
    start: Position;
    end: Position;
    name: string;
    description: string;
    value: string | null;
}
export interface OutlineBlockItem {
    start: Position;
    end: Position | null;
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
    // matcheck = internal material checks (e.g. definition or reference not found)
    // dbcheck =  checks against the syntax database (e.g. block or parameter not found)
    // format = formatting warnings
    type: "closure" | "duplication" | "refcheck" | "matcheck" | "dbcheck" | "format";
    start: Position;
    end: Position;
    msg: string;
    correction?: {
        insertionBefore?: string;
        insertionAfter?: string;
        replace?: string;
    };
}
/** a dictionary to hold variables and where they were instantiated and referenced in the doc */
export interface VariableRefs {
    [id: string]: { // the key for the main block
        // instPos: Position, // the position on which the variable is instantiated
        // instSubBlock?: string,
        // instFile?: string,
        definition?: Definition,
        refs: Position[] // positions at which the variable is referenced
    };
}

/** an interface to describe a value in the document */
export interface ValueNode {
    name: string;
    description: string;
    definition: Definition;
}

export interface SubBlock {
    mainBlock: string;
    name: string | null;
    properties: {
        [name: string]: {
            row: number, line: string, value: string
        }
    };
    position: Position;
    comment: string | undefined;
}

function __guard__(value: RegExpMatchArray | null,
    transform: (regarray: RegExpMatchArray) => string) {
    return typeof value !== 'undefined' && value !== null ? transform(value) : undefined;
}

// regexes
let rgx = {
    emptyLine: /^\s*$/,
    insideBlockTag: /^\s*\[([^\]#\s]*)$/,
    blockTagContent: /^\s*\[([^\]]*)\]/,
    blockType: /^\s*type\s*=\s*([^#\s]+)/,
    typeParameter: /^\s*type\s*=\s*[^\s#=\]]*$/,
    parameterCompletion: /^\s*[^\s#=\]]*$/,
    valueCompletion: /^\s*([^\s#=\]]+)\s*=\s*('\s*[^\s'#=\]]*(\s?)[^'#=\]]*|[^\s#=\]]*)$/,
    stdVector: /^std::([^:]+::)?vector<([a-zA-Z0-9_]+)(,\s?std::\1allocator<\2>\s?)?>$/,

    // if match, returns [line, block name, all characters after block, comment | undefined]
    blockOpenTop: /^\s*\[([^.\/][^\/]*)\][\s]*(#(.*)|.*)/,
    blockCloseTop: /^\s*\[\]/,

    // if match, returns [line, block name, all characters after block, comment | undefined]
    blockOpenOneLevel: /^\s*\[\.\/([^.\/]+)\][\s]*(#(.*)|.*)/,
    blockCloseOneLevel: /^\s*\[\.\.\/\]/,

    paramLine: /^\s*([^\s#=\]]+)\s*=.*$/, // /^\s*([_a-zA-Z0-9]+)\s*=.*$/;

    // if match, returns [line w/out comment, name, value, unquoted value | undefined]
    paramValueLine: /^\s*([^\s#=\]]+)\s*=\s*('(\s*[^\s'#=\]]*[^'#=\]]*)'|[^\s#=\]]*)/, // /^\s*([_a-zA-Z0-9]+)\s*=\s*[\'\"]*([^#\'\"]+)/;

    materialDefines: /<defines:[\s]*(\s*[^\s>#=\]]*[^>#=\]]*)[\s]*>/,
};

/**
 * A class to manage a MOOSE input document
 * 
 * This class is agnostic to the implementing program 
 * and requires only a document object which provides a defined interface
 * 
 * @param doc the document object
 * @param syntaxdb the object containing the syntax database
 * @param indentLength the number of spaces per indent
  * 
 */
export class MooseDoc {

    private syntaxdb: moosedb.MooseSyntaxDB;
    private doc: Document | null;
    public indentLength: number;

    constructor(syntaxdb: moosedb.MooseSyntaxDB, doc: Document | null = null, indentLength: number = 4) {
        this.doc = doc;
        this.syntaxdb = syntaxdb;
        this.indentLength = indentLength;
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

    /** given a position in the document, get the word that it sits on
     * 
     * @param allowChars defines the characters that a word comprises of, e.g. "-_0-9a-zA-Z"
     */
    private static getWordAt(line: string, column: number, allowChars: string) {

        let word: string;
        let range: [number, number];

        let left_regex = new RegExp("[" + allowChars + "]+$"); // $ matches the end of a line
        let right_regex = new RegExp("[^" + allowChars + "]");

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

    /** find the blocks which may contain the definition of a referencing parameter */
    private getVariableDefinitionBlocks(param: moosedb.ParamNode) {

        let varType2Blocks: { [id: string]: string[] } = {
            NonlinearVariableName: ['Variables'],
            AuxVariableName: ['AuxVariables'],
            VariableName: ['Variables', 'AuxVariables'],
            FunctionName: ['Functions'],
            PostprocessorName: ['Postprocessors'],
            UserObjectName: ['Postprocessors', 'UserObjects'],
            VectorPostprocessorName: ['VectorPostprocessors'],
        };

        if (param.cpp_type in varType2Blocks) {
            return varType2Blocks[param.cpp_type];
        }
        let match = rgx.stdVector.exec(param.cpp_type);
        if (match !== null) {
            let vecType = match[2];
            if (vecType in varType2Blocks) {
                return varType2Blocks[vecType];
            }
        }

        return null;

    }

    private async getMaterialDefinitions(subBlock: SubBlock) {
        if (subBlock.comment) {
            let cMatch: RegExpExecArray | null;
            if (cMatch = rgx.materialDefines.exec(subBlock.comment)) {
                let type: undefined | string = undefined;
                if ("type" in subBlock.properties) {
                    type = subBlock.properties["type"].value;
                }
                let defNames = { names: [] as string[], property: undefined, type: type };
                for (let defName of cMatch[1].split(/\s+/).filter(Boolean)) {
                    defNames.names.push(defName);
                }
                return defNames;
            }
        }
        return await this.syntaxdb.getMaterialDefinitions(subBlock.properties);
    }

    //** find all material definitions  */
    private async getAllMaterialDefinitions() {
        let allDefs = [];

        for (let subBlock of this.yieldSubBlocks(["Materials"], true)) {
            if (subBlock.name === null) { continue; }
            let defs = await this.getMaterialDefinitions(subBlock);
            if (defs === null) { continue; }
            for (let defName of defs.names) {

                let position: Position;
                if (defs.property && defs.property in subBlock.properties) {
                    let prop = subBlock.properties[defs.property];
                    position = {
                        row: prop.row,
                        column: prop.line.search(RegExp("[=\\s\\\'\\\"]" + defName + "([\\s\\\'\\\"]|$)")) + 1
                    };
                } else {
                    position = subBlock.position;
                }

                allDefs.push({
                    name: defName,
                    block: subBlock.name,
                    type: defs.type,
                    position: position
                });
            }
        }

        return allDefs;
    }

    /** find a material definition for a referencing parameter
     * 
     * @param matName the name of the material
     * @param startRow the row at which to start searching for the Materials block
     */
    private async getMaterialDefinition(param: moosedb.ParamNode, matName: string, startRow: number = 0) {
        let node: ValueNode | null = null;
        let match = rgx.stdVector.exec(param.cpp_type);
        if (param.cpp_type === "MaterialPropertyName" || (match !== null && match[2] === "MaterialPropertyName")) {

            for (let subBlock of this.yieldSubBlocks(["Materials"], true, null, startRow)) {
                if (subBlock.name === null) { continue; }
                let defs = await this.getMaterialDefinitions(subBlock);
                if (defs === null) { continue; }
                if (defs.names.indexOf(matName) >= 0) {

                    let position: Position;
                    if (defs.property && defs.property in subBlock.properties) {
                        let prop = subBlock.properties[defs.property];
                        position = {
                            row: prop.row,
                            column: prop.line.search(RegExp("[=\\s\\\'\\\"]" + matName + "([\\s\\\'\\\"]|$)")) + 1
                        };
                    } else {
                        position = subBlock.position;
                    }

                    node = {
                        name: matName,
                        description: "Referenced Material",
                        definition: {
                            key: ["Materials", matName].join("/"),
                            position: position,
                            type: defs.type,
                            description: ""
                        }
                    };
                    return node;
                }
            }
        }
        return node;
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

        let paramsList = await this.syntaxdb.fetchParameterList(valuePath, explicitType);

        for (let param of paramsList) {
            if (param.name === paramName) {

                // search for reference definition in blocks that define variables
                let blockNames = this.getVariableDefinitionBlocks(param);
                if ((param.name === 'active' || param.name === "inactive") && valuePath.length === 1) {
                    blockNames = valuePath;
                }
                if (blockNames) {
                    for (let blockName of blockNames) {
                        for (let { name, position, comment } of this.yieldSubBlocks([blockName])) {
                            if (name === value) {
                                // match = await this.syntaxdb.matchSyntaxNode([blockName, name]);
                                node = {
                                    name: name,
                                    description: "Referenced " + blockName.slice(0, blockName.length - 1),
                                    definition: {
                                        key: [blockName, name].join("/"),
                                        position: position,
                                        description: !!comment ? comment : ""
                                    }
                                };
                                break;
                            }
                        }
                        if (node) {
                            break;
                        }
                    }
                    // else if (hasType('FileName') || hasType('MeshFileName')) {
                    //     // let filePath = ppath.dirname(this.getDoc().getPath());
                    //     // TODO filename ValueNodes (what configpath?)
                    //     // need to convert relative paths to absolute path
                } else {
                    // search for reference definition in the Materials block
                    node = await this.getMaterialDefinition(param, value);
                }

                return node;
            }

        }
        return node;
    }

    private replaceSubBlockNode(configPath: string[], replace: string = "*") {
        let path: string[];
        if (configPath.length > 1) {
            path = configPath.slice(0, configPath.length - 1).concat([replace]);
        } else {
            path = configPath;
        }
        return path
    }

    /** find node for a cursor position, and the path to it
    * 
    * @param pos position of cursor
    * @param wordChars defines characters allowed in a word
    */
    public async findCurrentNode(pos: Position, wordChars: string = "-_0-9a-zA-Z") {

        let matchBlock: null | moosedb.NodeMatch = null;
        let node: moosedb.SyntaxNode | moosedb.ParamNode | ValueNode | null = null;
        let rmatch: RegExpExecArray | null;
        let defines: string[] | null = null;

        let line = this.getDoc().getTextForRow(pos.row);
        let wordMatch = MooseDoc.getWordAt(line, pos.column, wordChars);
        if (wordMatch === null) {
            return null;
        }
        let { word, start, end } = wordMatch;

        let { configPath, explicitType } = await this.getCurrentConfigPath(pos);

        if (line.slice(start - 1, end + 1) === "[" + word + "]") {
            // block
            configPath.push(word);
            matchBlock = await this.syntaxdb.matchSyntaxNode(configPath);
            if (!matchBlock) {
                return null;
            }
            node = matchBlock.node;
        } else if (line.slice(start - 3, end + 1) === "[./" + word + "]") {
            //sub-block
            configPath.push(word);
            if (explicitType === null) {
                matchBlock = await this.syntaxdb.matchSyntaxNode(configPath);
            } else {
                // the type parameter value supercedes the subblock name
                matchBlock = await this.syntaxdb.matchSyntaxNode(
                    this.replaceSubBlockNode(configPath));
            }
            if (!matchBlock) {
                return null;
            }
            node = matchBlock.node;
            // check if the subblock is defining a variable or material
            if (configPath.length === 2 && ['Variables', 'AuxVariables', 'Functions',
                'Postprocessors', 'UserObjects', 'VectorPostprocessors'].indexOf(configPath[0]) >= 0) {
                defines = [[configPath[0], configPath[1]].join("/")];
            }
            else if (configPath.length === 2 && configPath[0] === "Materials") {
                let blockDefs: string[] = [];

                for (let subBlock of this.yieldSubBlocks(["Materials"], true)) {
                    if (subBlock.name !== configPath[1]) { continue; }
                    let defs = await this.getMaterialDefinitions(subBlock);
                    if (defs === null) { break; }
                    for (let matName of defs.names) {
                        blockDefs.push(["Materials", matName].join("/"));
                    }
                }
                if (blockDefs.length > 0) { defines = blockDefs; }
            }
        } else if (/\s*type\s*=\s*/.test(line.slice(0, start - 1))) {         
            matchBlock = await this.syntaxdb.matchSyntaxNode(
                this.replaceSubBlockNode(configPath)); // the type parameter value supercedes the subblock name
            if (matchBlock !== null) {
                let typedPath = this.syntaxdb.getTypedPath(configPath, word, matchBlock.fuzzyOnLast);
                matchBlock = await this.syntaxdb.matchSyntaxNode(typedPath);
                configPath.push(word);
            }
            if (!matchBlock) {
                return null;
            }
            node = matchBlock.node;
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
        } else if (!!(rmatch = rgx.paramLine.exec(line))) { // /^\s*([^\s#=\]]+)\s*=.*/
            // value of parameter
            let paramName = rmatch[1];
            let vnode = await this.findValueReference(word, paramName, configPath, explicitType);
            if (vnode) {
                node = vnode;
                configPath.push(paramName, word);
            }
        }

        if (node === null) {
            return null;
        }

        return {
            node: node,
            path: configPath,
            range: [start, end],
            defines: defines,
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
        let line = this.getDoc().getTextInRange({ row: pos.row, column: 0 }, pos);
        let prefix = this.getPrefix(line);

        let { configPath, explicitType } = await this.getCurrentConfigPath(pos);

        if (this.isOpenBracketPair(line)) {
            // for empty [] we suggest blocks
            completions = await this.completeOpenBracketPair(pos, configPath);
        } else if (this.isTypeParameter(line)) {
            // the type parameter value supercedes the subblock name
            let path = this.replaceSubBlockNode(configPath);
            completions = await this.completeTypeParameter(line, pos.column, path, explicitType);
        } else if (this.isParameterCompletion(line)) {
            completions = await this.completeParameter(configPath, explicitType);
        } else if (!!(match = rgx.valueCompletion.exec(line))) {
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
     * @returns explicitType represents the type set by `type = <value>`
     */
    public async getCurrentConfigPath(pos: Position) {

        let configPath: string[] = [];
        let types: { config: string[], name: string }[] = [];
        let typePath: { config: string[], name: string };
        let type: string | null = null;

        let { row } = pos;

        let normalize = (configPath: string[]) => ppath.join.apply(undefined, configPath).split(ppath.sep);

        // find type name if on or below cursor line
        let trow = row;
        let tline = this.getDoc().getTextForRow(trow);
        let typeOnCursorLine = false;
        while (true) {

            if (trow + 1 >= this.getDoc().getLineCount()) {
                break;
            } else if (rgx.blockCloseTop.test(tline) || rgx.blockCloseOneLevel.test(tline)) {
                break;
            } else if (rgx.blockOpenTop.test(tline) || rgx.blockOpenOneLevel.test(tline)) {
                if (trow !== row) {
                    break;  // TODO for completeness should not break but skip over sub-blocks
                }
            }

            let typeArray = rgx.blockType.exec(tline);
            if (typeArray !== null) {
                if (trow === row) { typeOnCursorLine = true; }
                types.push({ config: [], name: typeArray[1] });
                break;
            }

            trow += 1;
            tline = this.getDoc().getTextForRow(trow);
        }

        // for the first line we only use up to to the cursor position
        let line = this.getDoc().getTextInRange({ row: pos.row, column: 0 }, pos);
        while (true) {
            // test the current line for block and type markers
            let blockNameRegex = rgx.blockTagContent.exec(line);
            let typeNameRegex = rgx.blockType.exec(line);

            if (blockNameRegex !== null) {

                let blockName = blockNameRegex[1].split('/');

                // [] top-level closure
                if (blockName.length === 1 && blockName[0] === '') {
                    return { configPath: [] as string[], explicitType: null };
                } else {
                    // prepend the blockName entries to the configPath
                    Array.prototype.unshift.apply(configPath, blockName);
                    // prepend the blockName entries to the typePath(s)
                    for (typePath of Array.from(types)) {
                        Array.prototype.unshift.apply(typePath.config, blockName);
                    }
                }

                if (blockName[0] !== '.' && blockName[0] !== '..') {
                    break;
                }
            } else if (typeNameRegex !== null && !typeOnCursorLine) {
                types.push({ config: [], name: typeNameRegex[1] });
            }

            // decrement row and fetch line 
            // (if we have not found a path we assume we are at the top level)
            row -= 1;
            if (row < 0) {
                return { configPath: [] as string[], explicitType: null };
            }
            line = this.getDoc().getTextForRow(row);

        }

        configPath = normalize(configPath);
        for (typePath of types) {
            if (normalize(typePath.config).join('/') === configPath.join('/')) {
                type = typePath.name;
                break;
            }
        }
        return { configPath, explicitType: type };
    }

    /** check if there is an square bracket pair around the cursor
     * 
     * @param line 
     */
    private isOpenBracketPair(line: string) {
        return rgx.insideBlockTag.test(line);
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
        let postLine = this.getDoc().getTextInRange(pos, { row: pos.row, column: pos.column + 1 });
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
        return rgx.typeParameter.test(line);
    }

    /** checks if this is a vector type build the vector cpp_type name 
     * for a given single type (checks for gcc and clang variants)
     */
    private isVectorOf(cpp_type: string, type: string) {
        let match = rgx.stdVector.exec(cpp_type);
        return (match !== null) && (match[2] === type);
    }

    /** yield sub-blocks of a given set of top blocks
     *  
     * @param blockNames the names of the top blocks (e.g. Functions, PostProcessors)
     * @param gatherParameters if true, return parameters of the block and sub blocks
     * @param paramFilter if not null return only these parameters of the subblock
     * @param startRow the row in the document to start searching from
     * @yields objects containing the mainBlock name, sub block name, opening row and dict of properties, 
     *         Note that, if the name is null, this is the properties for the main block
     */
    private * yieldSubBlocks(blockNames: string[],
        gatherParameters: Boolean = false, paramFilter: string[] | null = null, startRow: number = 0) {
        let level = 0;
        let regexMatch: RegExpExecArray | null;
        let mainBlockName: string | null = null;
        let subBlock: SubBlock = { mainBlock: '', name: '', properties: {}, position: { row: 0, column: 0 }, comment: undefined };
        let mainBlock: SubBlock = { mainBlock: '', name: null, properties: {}, position: { row: 0, column: 0 }, comment: undefined };

        for (let { line, row } of this.getDoc().iterLines(startRow)) {

            // scan through document, until a required block is open
            if (regexMatch = rgx.blockOpenTop.exec(line)) {
                if (blockNames.indexOf(regexMatch[1]) >= 0) {
                    // if the block has been found, remove it from the list
                    while (blockNames.indexOf(regexMatch[1]) >= 0) {
                        blockNames.splice(blockNames.indexOf(regexMatch[1]), 1);
                    }
                    mainBlockName = regexMatch[1];
                    mainBlock = {
                        mainBlock: mainBlockName,
                        name: null,
                        properties: {},
                        position: { row: row, column: line.indexOf('[') },
                        comment: !!regexMatch[3] ? regexMatch[3].trim() : regexMatch[3]
                    };
                }
            } else if (rgx.blockCloseTop.test(line)) {
                yield mainBlock;
                mainBlockName = null;
                // if all blocks have been found, then finish
                if (blockNames.length <= 0) {
                    break;
                }
            }
            if (mainBlockName === null) {
                // if we are not in a required block, then continue to next row
                continue;
            }

            if (rgx.blockOpenOneLevel.test(line)) {
                if (level === 0) {
                    let blockOpen = rgx.blockOpenOneLevel.exec(line);
                    if (blockOpen !== null) {
                        subBlock = {
                            mainBlock: mainBlockName,
                            name: blockOpen[1],
                            properties: {},
                            position: { row: row, column: line.indexOf('[') + 2 },
                            comment: !!blockOpen[3] ? blockOpen[3].trim() : blockOpen[3]
                        };
                    }
                }
                level++;
            } else if (rgx.blockCloseOneLevel.test(line)) {
                level--;
                if (level === 0) {
                    yield subBlock;
                }
            } else if (level === 1 && gatherParameters && (regexMatch = rgx.paramValueLine.exec(line))) {
                let paramName = regexMatch[1];
                let paramValue: string;
                if (regexMatch[3] !== undefined) {
                    paramValue = regexMatch[3]; // unquoted list of values 
                } else {
                    paramValue = regexMatch[2]; // single value
                }
                if (paramFilter === null || paramFilter.indexOf(paramName) >= 0) {
                    // TODO raise warning if paramName already set
                    subBlock.properties[paramName] = { row: row, line: line, value: paramValue };
                }
            } else if (level === 0 && gatherParameters && (regexMatch = rgx.paramValueLine.exec(line))) {
                let paramName = regexMatch[1];
                let paramValue: string;
                if (regexMatch[3] !== undefined) {
                    paramValue = regexMatch[3]; // unquoted list of values 
                } else {
                    paramValue = regexMatch[2]; // single value
                }
                if (paramFilter === null || paramFilter.indexOf(paramName) >= 0) {
                    // TODO raise warning if paramName already set
                    mainBlock.properties[paramName] = { row: row, line: line, value: paramValue };
                }
            }

        }

    }

    /** generic completion list builder for sub-block names
     * 
     * @param blockNames 
     * @param propertyNames 
     */
    private computeSubBlockNameCompletion(blockNames: string[], propertyNames: string[]) {
        let completions: Completion[] = [];
        for (let block of Array.from(blockNames)) {
            for (let { name, properties, comment } of this.yieldSubBlocks([block], true, propertyNames)) {
                if (name === null) { continue; }
                let doc: string[] = [];
                if (!!comment && comment.length > 0) {
                    doc.push(comment + "\n\n");
                }
                for (let propertyName of Array.from(propertyNames)) {
                    if (propertyName in properties) {
                        doc.push(properties[propertyName].value);
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
        let hasType = (type: string, vectorType: string | null = null) => {
            return param.cpp_type === type && singleOK || this.isVectorOf(param.cpp_type, vectorType ? vectorType : type) && vectorOK;
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
            for (let def of await this.getAllMaterialDefinitions()) {
                completions.push({
                    kind: "value",
                    displayText: def.name,
                    description: ["Materials", def.block, def.name].join("/") + " (" + def.type + ")",
                    insertText: {
                        type: "text",
                        value: def.name
                    }
                });
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
            let otherArray = rgx.valueCompletion.exec(line);
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
        return rgx.parameterCompletion.test(line);
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

    /** assess the outline of the whole document
     * 
     * Returns an object containing:
     * 
     * - **outline**: a heirarchical outline of the the documents blocks and subblocks
     * - **errors**: a list of syntactical errors
     * 
     * @param incReferences if true include assessment of internal references
     * 
     */
    public async assessDocument(incReferences: boolean = false) {

        let outlineItems: OutlineBlockItem[] = [];
        let syntaxErrors: SyntaxError[] = [];
        let refsDict: VariableRefs | null = null;

        let line: string = "";
        let row: number = 0;
        let currLevel = 0;
        let indentLevel = 0;
        let emptyLines: number[] = [];

        // ensure syntax DB has loaded
        try {
            await this.syntaxdb.retrieveSyntaxNodes();
        } catch (err) {
            // return { outline: outlineItems, errors: syntaxErrors };
        }

        // perform an initial pass to gather global parameters
        let globalParamDict: { [index: string]: string } = {}; // {name: value}
        for (let { properties } of this.yieldSubBlocks(["GlobalParams"], true)) {
            for (let param in properties) {
                globalParamDict[param] = properties[param].value;
            }
        }
        // gather variable definitions
        if (incReferences) {
            refsDict = {};
            for (let { mainBlock, name, position } of this.yieldSubBlocks([
                "Variables", "AuxVariables", "Postprocessors", "VectorPostprocessors",
                "UserObjects", "Functions"
            ])) {
                if (name !== null) {
                    let key = [mainBlock, name].join("/");
                    if (key in refsDict) {
                        // error already handled when checking for subblock duplication
                        continue;
                    }
                    refsDict[key] = {
                        definition: {
                            position: position,
                            description: "",
                            key: key
                            // subblock: name
                        },
                        refs: []
                    };
                }
            }
            for (let { name, block, position } of await this.getAllMaterialDefinitions()) {
                if (name !== null) {
                    let key = ["Materials", name].join("/");
                    if (key in refsDict) {
                        syntaxErrors.push({
                            type: "duplication",
                            start: position,
                            end: { row: position.row, column: position.column + name.length },
                            msg: 'duplicate material name: ' + name
                        });
                        continue;
                    }
                    refsDict[key] = {
                        definition: {
                            position: position,
                            description: "",
                            key: key
                            // subblock: block
                        },
                        refs: []
                    };
                }
            }
        }

        // step through document
        for ({ line, row } of this.getDoc().iterLines(0)) {

            emptyLines = this.detectBlankLines(emptyLines, row, syntaxErrors, line);

            if (rgx.blockOpenTop.test(line)) {
                await this.assessMainBlock(
                    currLevel, syntaxErrors, row, line, outlineItems, globalParamDict, refsDict);
                currLevel = 1;
                indentLevel = 0;
            } else if (rgx.blockCloseTop.test(line)) {
                await this.closeMainBlock(
                    currLevel, syntaxErrors, row, line, outlineItems, globalParamDict, refsDict);
                currLevel = 0;
                indentLevel = 0;
            } else if (rgx.blockOpenOneLevel.test(line)) {
                currLevel = await this.assessSubBlock(currLevel, syntaxErrors, row, line, outlineItems);
                indentLevel = currLevel - 1;
            } else if (rgx.blockCloseOneLevel.test(line)) {
                currLevel = await this.closeSubBlock(
                    currLevel, syntaxErrors, row, line, outlineItems, globalParamDict, refsDict);
                indentLevel = currLevel;
            } else if (rgx.paramValueLine.test(line)) {
                await this.assessParameter(line, outlineItems, row, currLevel);
                indentLevel = currLevel;
            } else {
                indentLevel = currLevel;
            }

            // check all lines are at correct indentation level
            // TODO indent lines after parameter definitions (that are not just comments) by extra space == '<name> = '
            let firstChar = line.search(/[^\s]/);
            if (firstChar >= 0 && firstChar !== indentLevel * this.indentLength) {
                syntaxErrors.push({
                    type: "format",
                    start: { row: row, column: 0 },
                    end: { row: row, column: firstChar },
                    correction: {
                        replace: " ".repeat(indentLevel * this.indentLength),
                    },
                    msg: "wrong indentation",
                });
            }

        }

        emptyLines = this.detectBlankLines(emptyLines, row, syntaxErrors);
        // check no blocks are left unclosed
        if (currLevel !== 0) {
            let insert = "[]\n";
            for (let i = 1; i < currLevel; i++) {
                insert = " ".repeat(this.indentLength * i) + "[../]\n" + insert;
            }
            syntaxErrors.push({
                type: "closure",
                start: { row: row, column: 0 },
                end: { row: row, column: line.length },
                msg: 'final block(s) unclosed',
                correction: {
                    // insertionAfter: "[../]\n".repeat(currLevel - 1) + "[]\n"
                    insertionAfter: insert
                }
            });
            await this.closeFinalBlockAndChildren(
                outlineItems, 1, row, "", syntaxErrors, globalParamDict, refsDict);
        }
        emptyLines = this.detectBlankLines(emptyLines, row, syntaxErrors, line);

        return { outline: outlineItems, errors: syntaxErrors, refs: refsDict };
    }

    /** detect multiple blank lines */
    private detectBlankLines(emptyLines: number[], row: number, syntaxErrors: SyntaxError[], line: string | null = null) {
        if (line !== null && rgx.emptyLine.test(line)) {
            emptyLines.push(row);
        }
        else {
            if (emptyLines.length > 1) {
                syntaxErrors.push({
                    type: "format",
                    start: { row: emptyLines[0], column: 0 },
                    end: { row: row - 1, column: line === null ? 0 : line.length },
                    msg: "multiple blank lines",
                    correction: {
                        replace: ""
                    }
                });
            }
            emptyLines = [];
        }
        return emptyLines;
    }

    private async assessMainBlock(level: number, syntaxErrors: SyntaxError[], row: number, line: string,
        outlineItems: OutlineBlockItem[], globalParamDict: { [index: string]: string }, refsDict: VariableRefs | null) {

        let blockName: string;

        // test we are not already in a top block
        if (level > 0) {
            let insert = "[]\n";
            for (let i = 1; i < level; i++) {
                insert = " ".repeat(this.indentLength * i) + "[../]\n" + insert;
            }
            syntaxErrors.push({
                type: "closure",
                start: { row: row, column: 0 },
                end: { row: row, column: line.length },
                msg: 'block opened before previous one closed',
                correction: {
                    // insertionBefore: "[../]\n".repeat(level - 1) + "[]\n"
                    insertionBefore: insert
                }
            });
            await this.closeFinalBlockAndChildren(
                outlineItems, 1, row - 1, line, syntaxErrors, globalParamDict, refsDict);
            level = 0;
        }

        // get name of the block
        let blocknames = rgx.blockOpenTop.exec(line);
        blockName = blocknames !== null ? blocknames[1] : '';
        if (outlineItems.map(o => o.name).indexOf(blockName) !== -1) {
            syntaxErrors.push({
                type: "duplication",
                start: { row: row, column: 0 },
                end: { row: row, column: line.length },
                msg: 'duplicate block name'
            });
        }

        // add the block to the outline 
        outlineItems.push({
            name: blockName,
            description: "",
            level: 1,
            start: { row: row, column: line.search(/\[/) },
            end: null,
            children: [],
            parameters: [],
            inactive: []
        });

        return;
    }

    private async closeMainBlock(currLevel: number, syntaxErrors: SyntaxError[], row: number, line: string,
        outlineItems: OutlineBlockItem[], globalParamDict: { [index: string]: string },
        refsDict: VariableRefs | null) {

        // check all sub-blocks have been closed
        if (currLevel > 1) {
            let insert = "";
            for (let i = 1; i < currLevel; i++) {
                insert = " ".repeat(this.indentLength * i) + "[../]\n" + insert;
            }
            syntaxErrors.push({
                type: "closure",
                start: { row: row, column: 0 },
                end: { row: row, column: line.length },
                msg: 'closed parent block before closing children',
                correction: {
                    // insertionBefore: "[../]\n".repeat(currLevel - 1)
                    insertionBefore: insert
                }
            });
            await this.closeFinalBlockAndChildren(
                outlineItems, 2, row - 1, line, syntaxErrors, globalParamDict, refsDict);
        }
        // check a main block has been opened
        else if (currLevel < 1) {
            syntaxErrors.push({
                type: "closure",
                start: { row: row, column: 0 },
                end: { row: row, column: line.length },
                msg: 'closed block before opening new one',
                correction: {
                    // insertionBefore: "[${1:name}\n]" // TODO correct with snippets
                }
            });
        }
        await this.closeFinalBlockAndChildren(
            outlineItems, 1, row, line, syntaxErrors, globalParamDict, refsDict);
    }

    private async assessSubBlock(currLevel: number, syntaxErrors: SyntaxError[], row: number, line: string, outlineItems: OutlineBlockItem[]) {

        let currBlockName: string;

        // check we are in a main block
        if (currLevel === 0) {
            syntaxErrors.push({
                type: "closure",
                start: { row: row, column: 0 },
                end: { row: row, column: line.length },
                msg: 'opening sub-block before main block open',
                correction: {
                    // insertionBefore: "[${1:name}]\n" // TODO correct with snippets
                }
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
        let blockregex = rgx.blockOpenOneLevel.exec(line);
        currBlockName = blockregex !== null ? blockregex[1] : '';

        currLevel++;
        child.children.push({
            name: currBlockName,
            description: "",
            level: currLevel,
            start: { row: row, column: line.search(/\[/) },
            end: null,
            children: [],
            parameters: [],
            inactive: []
        });
        return currLevel;
    }

    private async closeSubBlock(currLevel: number, syntaxErrors: SyntaxError[], row: number, line: string,
        outlineItems: OutlineBlockItem[], globalParamDict: { [index: string]: string },
        refsDict: VariableRefs | null) {
        if (currLevel === 0) {
            syntaxErrors.push({
                type: "closure",
                start: { row: row, column: 0 },
                end: { row: row, column: line.length },
                msg: 'closing sub-block before opening main block',
            });
        }
        else if (currLevel === 1) {
            syntaxErrors.push({
                type: "closure",
                start: { row: row, column: 0 },
                end: { row: row, column: line.length },
                msg: 'closing sub-block before opening one',
            });
        }
        else {
            let levelsClosed = await this.closeFinalBlockAndChildren(
                outlineItems, currLevel, row, line, syntaxErrors, globalParamDict, refsDict);
            currLevel = currLevel - levelsClosed;
        }
        return currLevel;
    }

    private async assessParameter(line: string, outlineItems: OutlineBlockItem[], row: number, currLevel: number) {

        // let nameRegex = paramLine.exec(line);
        // let paramName = nameRegex !== null ? nameRegex[1] : '';

        let regex = rgx.paramValueLine.exec(line);

        if (regex === null) { return; }

        let paramName = regex[1];
        let paramValue: string | null;
        if (regex[3] !== undefined) {
            paramValue = regex[3]; // unquoted list of values 
        } else {
            paramValue = regex[2]; // single value
        }
        if (paramValue.trim().length === 0) {
            paramValue = null;
        }
        // TODO capture values which go over multiple lines

        let { child: blockItem } = MooseDoc.getFinalChild(outlineItems, currLevel);
        if (blockItem !== null) {
            blockItem.parameters.push({
                name: paramName,
                description: "",
                start: { row: row, column: line.search(/[^\s]/) },
                end: { row: row, column: line.length }, // TODO end before comments
                value: paramValue
            });
        }

    }

    /**
     * close a single block, updating its end row and active children
     */
    private async closeSingleBlock(block: OutlineBlockItem, endPos: Position, parentPath: string[],
        globalParamDict: { [index: string]: string }, refsDict: VariableRefs | null) {

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
                    start: child.start,
                    end: {
                        row: child.start.row,
                        column: child.start.column + ("[./" + child.name + "]").length
                    },
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
                    start: param.start,
                    end: param.end,
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
                start: block.start,
                end: {
                    row: block.start.row,
                    column: block.start.column + (block.level > 1 ? ("[./" + block.name + "]").length : ("[" + block.name + "]").length)
                },
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
                            start: param.start,
                            end: param.end,
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
                            start: param.start,
                            end: param.end,
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
        let typeMatch: null | moosedb.NodeMatch = null;
        let node: moosedb.SyntaxNode;
        if (blockMatch !== null) {
            // find type of block (use only first instance)
            if ("type" in paramDict && paramDict["type"][0].value) {
                typeName = paramDict["type"][0].value;
                let typedPath = this.syntaxdb.getTypedPath(configPath, typeName, blockMatch.fuzzyOnLast);
                typeMatch = await this.syntaxdb.matchSyntaxNode(typedPath);
            }
        }
        if (blockMatch === null) {
            let error: SyntaxError = {
                type: "dbcheck",
                start: block.start,
                end: {
                    row: block.start.row,
                    column: block.start.column + (block.level > 1 ? ("[./" + block.name + "]").length : ("[" + block.name + "]").length)
                },
                msg: 'block path was not found in database: ' + configPath.join("/")
            };
            syntaxErrors.push(error);
        } else {
            // add details for block
            if (typeMatch) {
                node = typeMatch.node;
            } else {
                node = blockMatch.node;
            }
            block.description = node.description;

            // convert node parameters into dictionary
            let nodeParamDict: { [id: string]: moosedb.ParamNode } = {};
            for (let nparam of await this.syntaxdb.fetchParameterList(configPath, typeName)) {
                nodeParamDict[nparam.name] = nparam;
            }

            // add details and checks for parameters
            // TODO issue when sub-block named the same as a type, should include a warning if this is the case
            let stringPath = (typeName !== null) ? configPath.concat([typeName]).join("/") : configPath.join("/");
            if (configPath[0] !== "GlobalParams") {
                for (let pname in paramDict) {
                    if (pname in nodeParamDict) {
                        for (let param of paramDict[pname]) {
                            param.description = nodeParamDict[pname].description;
                        }
                    } else {
                        for (let param of paramDict[pname]) {
                            let error: SyntaxError = {
                                type: "dbcheck",
                                start: param.start,
                                end: param.end,
                                msg: 'parameter name "' + pname + '" was not found for this block in database: ' + stringPath
                            };
                            syntaxErrors.push(error);
                        }
                    }
                }
                // check all required parameters, that don't have default values, are present
                let missingParams: string[] = [];
                for (let npname in nodeParamDict) {
                    let pnode = nodeParamDict[npname];
                    if (pnode.required === "Yes" && pnode.default === "") {
                        if (!((npname in paramDict) || (npname in globalParamDict))) {
                            if (npname === "variable" && parentPath.length > 1 && ["Variables", "AuxVariables"].indexOf(parentPath[0]) >= 0) {
                                // e.g. if [./InitialCondition] is subblock of variable it does not require the "variable" parameter
                                // TODO generalise this rule
                            } else {
                                missingParams.push(npname);
                            }
                        }
                    }
                }
                if (missingParams.length > 0) {
                    let indent = " ".repeat(block.level * this.indentLength);
                    let error: SyntaxError = {
                        type: "dbcheck",
                        start: block.start,
                        end: {
                            row: block.start.row,
                            column: block.start.column + (block.level > 1 ? ("[./" + block.name + "]").length : ("[" + block.name + "]").length)
                        },
                        msg: 'required parameter(s) "' + missingParams.join(", ") + '" not present in block: ' + stringPath,
                        correction: {
                            insertionAfter: "\n" + indent + missingParams.join(" = \n" + indent) + " = "
                        }
                    };
                    syntaxErrors.push(error);
                }
            }

            // update reference dict
            if (refsDict !== null) {
                for (let pname in paramDict) {
                    if (!(pname in nodeParamDict)) { continue; }
                    let node = nodeParamDict[pname];
                    let vBlocks = this.getVariableDefinitionBlocks(node);
                    for (let param of paramDict[pname]) {
                        if (!param.value) { continue; }
                        // split vector values (e.g. 'a b c')
                        for (let pvalue of param.value.split(/\s+/).filter(Boolean)) {
                            if (vBlocks !== null) {
                                let instanceInBlock = null;
                                for (let vBlock of vBlocks) {
                                    if ([vBlock, pvalue].join("/") in refsDict) {
                                        instanceInBlock = vBlock;
                                        break;
                                    }
                                }
                                if (instanceInBlock !== null) {
                                    refsDict[[instanceInBlock, pvalue].join("/")]["refs"].push(param.start);
                                } else if (vBlocks.indexOf("Functions") >= 0) {
                                    // FunctionName variables can be a string of the actual function, e.g. func = 'x+y'
                                } else {
                                    let error: SyntaxError = {
                                        type: "refcheck",
                                        msg: pvalue + " references a variable that was not found in the document",
                                        start: param.start,
                                        end: param.end
                                    };
                                    syntaxErrors.push(error);
                                }
                            } if (param.name === "type") { 
                                // TODO make optional, also want to ensure that doesn't overwrite variable/material keys
                                // let key: string;
                                // let path: string[]
                                // if (parentPath.length === 0) {
                                //     key = [block.name, param.value].join("/");
                                //     path = [block.name, "<type>", param.value];
                                // } else {
                                //     key = [parentPath[0], param.value].join("/");
                                //     path = [parentPath[0], param.value];
                                // }
                                // if (key in refsDict) {
                                //     refsDict[key].refs.push(param.start);
                                // } else {
                                //     let match = await this.syntaxdb.matchSyntaxNode(path);
                                //     if (match && !!match.node.definition) {
                                //         refsDict[key] = {
                                //             definition: match.node.definition,
                                //             refs: [param.start]
                                //         };
                                //     } else {
                                //         refsDict[key] = {
                                //             refs: [param.start]
                                //         };
                                //         // TODO add warning that definition not found
                                //     }
                                // }
                            } else {
                                let paramTypeMatch = rgx.stdVector.exec(node.cpp_type);
                                if (node.cpp_type === "MaterialPropertyName" || (paramTypeMatch !== null && paramTypeMatch[2] === "MaterialPropertyName")) {
                                    if ("Materials/" + pvalue in refsDict) {
                                        refsDict["Materials/" + pvalue]["refs"].push(param.start);
                                    } else if (!isNaN(parseInt(pvalue))) {
                                        // MaterialPropertyName may be able to be a number e.g. see kks_mechanics_VTS.i    
                                    } else {
                                        let error: SyntaxError = {
                                            type: "matcheck",
                                            msg: pvalue + " references a material that was not found in the document",
                                            start: param.start,
                                            end: param.end
                                        };
                                        syntaxErrors.push(error);
                                    }
                                }
                            }
                        }
                    }
                }
            }

            // TODO checks of values (e.g. reference is available)

        }

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
     * @param globalParamDict dictionary of global parameters {name: value}
     * @param refsDict dictionary of references
     
     * @returns number of levels closed
     */
    private async closeFinalBlockAndChildren(outline: OutlineBlockItem[],
        blockLevel: number, row: number, line: string, syntaxErrors: SyntaxError[],
        globalParamDict: { [index: string]: string }, refsDict: VariableRefs | null) {
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
            let errors = await this.closeSingleBlock(
                item, { row: row, column: closePos >= 0 ? closePos + 1 : 0 },
                configPath, globalParamDict, refsDict);
            syntaxErrors.push(...errors);
            levelsClosed++;
        }
        // search for any open children and close them
        while (item.children.length > 0) {
            configPath.push(item.name);
            item = item.children[item.children.length - 1];
            if (item.end === null) {
                let errors = await this.closeSingleBlock(item, { row: row, column: 0 }, configPath, globalParamDict, refsDict);
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
