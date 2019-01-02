/**
 * A module to manage a MOOSE input document 
 */
'use strict';

import ppath = require('path');
import * as fs from 'fs';

import * as moosedb from './moose_syntax';
import { stringify } from 'querystring';

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

export interface OutlineItem {
    start: [number, number];
    end: [number, number] | null;
    kind: 'block' | 'parameter';
    level: number;
    name: string;
    description: string;
    children: OutlineItem[];
}
export interface SyntaxError {
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
let blockOpenTop = /\[([^.\/][^\/]*)\]/;
let blockCloseTop = /\[\]/;
let blockOpenOneLevel = /\[\.\/([^.\/]+)\]/;
let blockCloseOneLevel = /\[\.\.\/\]/;

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

    /** find node for a cursor position, and the path to it
    * 
    * @param pos position of cursor
    * @param regex defines characters allowed in a word
    */
    public async findCurrentNode(pos: Position, regex: string = "_0-9a-zA-Z") {

        let match: null | moosedb.nodeMatch = null;

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
        } else if (line.slice(start - 3, end + 1) === "[./" + word + "]") {
            //sub-block
            configPath.push(word);
            match = await this.syntaxdb.matchSyntaxNode(configPath);
        } else if (/\s*type\s*=\s*/.test(line.slice(0, start - 1))) {
            // type parameter
            match = await this.syntaxdb.matchSyntaxNode(configPath);
            if (match !== null) {
                let typedPath = this.syntaxdb.getTypedPath(configPath, word, match.fuzzyOnLast);
                match = await this.syntaxdb.matchSyntaxNode(typedPath);
                configPath.push(word);
            }
        } else if (/\s*=.*/.test(line.slice(end + 1))) {
            // parameter name
            let params = await this.syntaxdb.fetchParameterList(configPath, explicitType);
            for (let param of params) {
                if (param.name === word) {
                    if (explicitType) {
                        configPath.push(explicitType);
                    }
                    configPath.push(param.name);
                    return { node: param, path: configPath, range: [start, end] };
                }
            }
        }

        if (match === null) {
            return null;
        }
        return { node: match.node, path: configPath, range: [start, end] };
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
                    completions = this.computeValueCompletion(param, isQuoted, hasSpace);
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

    /** gather sub-blocks of a given top block 
     *  
     * @param blockName the name of the top block (e.g. Functions, PostProcessors)
     * @param propertyNames include named properties of the subblock
     */
    private fetchSubBlockList(blockName: string, propertyNames: string[]) {
        let i = 0;
        let level = 0;
        let subBlockList: { name: string, properties: { [index: string]: string } }[] = [];
        var subBlock: {
            name: string,
            properties: { [index: string]: string }
        } = { name: '', properties: {} };
        let filterList = Array.from(propertyNames).map(property => ({ name: property, re: new RegExp(`^\\s*${property}\\s*=\\s*([^\\s#=\\]]+)$`) }));

        let nlines = this.getDoc().getLineCount();

        // find start of selected block
        while (i < nlines && this.getDoc().getTextForRow(i).indexOf(`[${blockName}]`) === -1) {
            i++;
        }

        // parse contents of subBlock block
        while (true) {

            if (i >= nlines) {
                break;
            }
            let line = this.getDoc().getTextForRow(i);
            if (blockCloseTop.test(line)) {
                break;
            }

            if (blockOpenOneLevel.test(line)) {
                if (level === 0) {
                    let blockopen = blockOpenOneLevel.exec(line);
                    if (blockopen !== null) {
                        subBlock = { name: blockopen[1], properties: {} };
                    }
                }
                level++;
            } else if (blockCloseOneLevel.test(line)) {
                level--;
                if (level === 0) {
                    subBlockList.push(subBlock);
                }
            } else if (level === 1) {
                for (let filter of Array.from(filterList)) {
                    var match;
                    if (match = filter.re.exec(line)) {
                        subBlock.properties[filter.name] = match[1];
                        break;
                    }
                }
            }

            i++;
        }

        return subBlockList;
    }

    /** generic completion list builder for subblock names
     * 
     * @param blockNames 
     * @param propertyNames 
     */
    private computeSubBlockNameCompletion(blockNames: string[], propertyNames: string[]) {
        let completions: Completion[] = [];
        for (let block of Array.from(blockNames)) {
            for (let { name, properties } of Array.from(this.fetchSubBlockList(block, propertyNames))) {
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
    private computeValueCompletion(param: moosedb.ParamNode, isQuoted: boolean = false, hasSpace: boolean = false) {
        let completions: Completion[] = [];
        let singleOK = !hasSpace;
        let vectorOK = isQuoted || !hasSpace;

        let hasType = (type: string) => {
            return param.cpp_type === type && singleOK || this.isVectorOf(param.cpp_type, type) && vectorOK;
        };

        if (param.cpp_type === 'bool' && singleOK || this.isVectorOf(param.cpp_type, 'bool') && vectorOK) {
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
        } else if (param.cpp_type === 'MooseEnum' && singleOK || param.cpp_type === 'MultiMooseEnum' && vectorOK) {
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
        } else if (param.cpp_type === 'OutputName' && singleOK || this.isVectorOf(param.cpp_type, 'OutputName') && vectorOK) {
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
                        completions = this.computeValueCompletion(param);
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

    /** assess the outline of the whole document
     * 
     * @param indentLength the number of spaces per indent
     * @returns outline structure, list of syntax errors, list of suggested text edits (to improve formatting)
     * 
     */
    public async assessOutline(indentLength: number = 4) {

        let outlineItems: OutlineItem[] = [];
        let syntaxErrors: SyntaxError[] = [];
        let textEdits: textEdit[] = [];

        let line: string = "";
        let currLevel = 0;
        let indentLevel = 0;
        let emptyLines: number[] = [];

        for (var row = 0; row < this.getDoc().getLineCount(); row++) {

            line = this.getDoc().getTextForRow(row);

            emptyLines = this.detectBlankLines(emptyLines, row, textEdits, line);

            if (blockOpenTop.test(line)) {
                await this.assessMainBlock(currLevel, syntaxErrors, row, line, outlineItems);
                currLevel = 1;
                indentLevel = 0;
            } else if (blockCloseTop.test(line)) {
                this.closeMainBlock(currLevel, syntaxErrors, row, line, outlineItems);
                currLevel = 0;
                indentLevel = 0;
            } else if (blockOpenOneLevel.test(line)) {
                currLevel = await this.assessSubBlock(currLevel, syntaxErrors, row, line, outlineItems);
                indentLevel = currLevel - 1;
            } else if (blockCloseOneLevel.test(line)) {
                currLevel = this.closeSubBlock(currLevel, syntaxErrors, row, line, outlineItems);
                indentLevel = currLevel;
            } else {
                indentLevel = currLevel;
            }
            // TODO get parameters and check against syntax

            // check all lines are at correct indentation level
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
                row: row, columns: [0, line.length],
                msg: 'final block(s) unclosed',
                insertionAfter: "[../]\n".repeat(currLevel - 1) + "[]\n"
            });
            MooseDoc.closeBlocks(outlineItems, 1, currLevel - 1, row, "");
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

    private async assessMainBlock(level: number, syntaxErrors: SyntaxError[], row: number, line: string, outlineItems: OutlineItem[]) {

        let blockName: string;

        // test we are not already in a top block
        if (level > 0) {
            syntaxErrors.push({
                row: row, columns: [0, line.length],
                msg: 'block opened before previous one closed',
                insertionBefore: "[../]\n".repeat(level - 1) + "[]\n"
            });
            MooseDoc.closeBlocks(outlineItems, 1, level - 1, row - 1, line);
            level = 0;
        }

        // get details of the block
        let blocknames = blockOpenTop.exec(line);
        blockName = blocknames !== null ? blocknames[1] : '';
        if (outlineItems.map(o => o.name).indexOf(blockName) !== -1) {
            syntaxErrors.push({
                row: row, columns: [0, line.length],
                msg: 'duplicate block name'
            });
        }
        let descript = '';
        let match = await this.syntaxdb.matchSyntaxNode([blockName]);
        // check the block name exists
        if (match === null) {
            syntaxErrors.push({
                row: row, columns: [0, line.length],
                msg: 'block name does not exist'
            });
        }
        else {
            descript = match.node.description;
        }

        // add the block to the outline 
        outlineItems.push({
            name: blockName,
            kind: 'block',
            description: descript,
            level: 1,
            start: [row, line.search(/\[/)],
            end: null,
            children: []
        });

        return;
    }

    private closeMainBlock(currLevel: number, syntaxErrors: SyntaxError[], row: number, line: string, outlineItems: OutlineItem[]) {

        // check all sub-blocks have been closed
        if (currLevel > 1) {
            syntaxErrors.push({
                row: row, columns: [0, line.length],
                msg: 'closed parent block before closing children',
                insertionBefore: "[../]\n".repeat(currLevel - 1)
            });
            MooseDoc.closeBlocks(outlineItems, 2, currLevel - 1, row - 1, line);
        }
        // check a main block has been opened
        else if (currLevel < 1) {
            syntaxErrors.push({
                row: row, columns: [0, line.length],
                msg: 'closed block before opening new one',
                insertionBefore: "[${1:name}]\n"
            });
        }
        MooseDoc.closeBlocks(outlineItems, 1, 0, row, line);
    }

    private async assessSubBlock(currLevel: number, syntaxErrors: SyntaxError[], row: number, line: string, outlineItems: OutlineItem[]) {

        let currBlockName: string;

        // check we are in a main block
        if (currLevel === 0) {
            syntaxErrors.push({
                row: row, columns: [0, line.length],
                msg: 'opening sub-block before main block open',
                insertionBefore: "[${1:name}]\n"
            });
            currLevel = 1;
        }

        // get parent node
        let { child, config } = MooseDoc.getFinalChild(outlineItems, currLevel);

        // get details of the block
        let blockregex = blockOpenOneLevel.exec(line);
        currBlockName = blockregex !== null ? blockregex[1] : '';
        if (child.children.map(o => o.name).indexOf(currBlockName) !== -1) {
            syntaxErrors.push({
                row: row, columns: [0, line.length],
                msg: 'duplicate block name'
            });
        }

        let descript = '';
        config.push(currBlockName);
        let match = await this.syntaxdb.matchSyntaxNode([currBlockName]);
        // check the block name exists
        if (match === null) {
        }
        else {
            descript = match.node.description;
        }

        currLevel++;
        child.children.push({
            name: currBlockName,
            kind: 'block',
            description: descript,
            level: currLevel,
            start: [row, line.search(/\[/)],
            end: null,
            children: []
        });
        return currLevel;
    }

    private closeSubBlock(currLevel: number, syntaxErrors: SyntaxError[], row: number, line: string, outlineItems: OutlineItem[]) {
        if (currLevel === 0) {
            syntaxErrors.push({
                row: row, columns: [0, line.length],
                msg: 'closing sub-block before opening main block',
            });
        }
        else if (currLevel === 1) {
            syntaxErrors.push({
                row: row, columns: [0, line.length],
                msg: 'closing sub-block before opening one',
            });
        }
        else {
            let { child } = MooseDoc.getFinalChild(outlineItems, currLevel);
            child.end = [row, line.length];
            currLevel--;
        }
        return currLevel;
    }

    /** Once we find a block's closure, we update its item with details of the end row
     * 
     * @param outline 
     * @param blockLevel the level of the block to close
     * @param childLevels the number of child levels to also close
     * @param row the row number of the closure
     * @param length the length of the closure line
     */
    private static closeBlocks(outline: OutlineItem[],
        blockLevel: number, childLevels: number, row: number, line: string) {
        if (outline.length === 0) {
            return;
        }
        let item: OutlineItem = outline[outline.length - 1];
        for (let l = 1; l < blockLevel + childLevels + 1; l++) {
            if (l === blockLevel) {
                let closePos = line.search(/\]/);
                item.end = [row, closePos >= 0 ? closePos + 1 : 0];
            } else if (l > blockLevel) {
                item.end = [row, 0];
            }
            if (item.children.length === 0) {
                break;
            }
            item = item.children[item.children.length - 1];
        }
    }

    /** navigate to the final child item of a certain level
     * 
     * @param outline 
     * @param level 
     */
    private static getFinalChild(outline: OutlineItem[], level: number) {

        let item: OutlineItem = outline[outline.length - 1];
        let config = [item.name];
        for (let l = 1; l < level; l++) {
            item = item.children[item.children.length - 1];
            config.push(item.name);
        }
        return { child: item, config: config };
    }

}
