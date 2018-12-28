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
    getText(): string;
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
    required?: boolean;
    displayText?: string;
    text?: string;
    description?: string;
    snippet?: string;
    replacementPrefix?: string;
}

export interface OutlineItem {
    start: number;
    end: number | null;
    kind: 'block' | 'parameter';
    level: number;
    name: string;
    description: string;
    children: OutlineItem[];
}
export interface SyntaxError {
    row: number;
    msg: string;
    insertionBefore?: string;
    insertionAfter?: string;
}

function __guard__(value: RegExpMatchArray | null,
    transform: (regarray: RegExpMatchArray) => string) {
    return typeof value !== 'undefined' && value !== null ? transform(value) : undefined;
}

// regexes
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
    private doc: Document;

    constructor(doc: Document, syntaxdb: moosedb.MooseSyntaxDB) {
        this.doc = doc
        this.syntaxdb = syntaxdb;
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
        let line = this.doc.getTextInRange([pos.row, 0], [pos.row, pos.column]);
        let prefix = this.getPrefix(line);

        let { configPath, explicitType } = await this.getCurrentConfigPath(pos);

        // for empty [] we suggest blocks
        if (this.isOpenBracketPair(line)) {
            completions = await this.completeOpenBracketPair(pos, configPath);
        } else if (this.isTypeParameter(line)) {
            completions = await this.completeTypeParameter(line, configPath, explicitType);
        } else if (this.isParameterCompletion(line)) {
            completions = await this.completeParameter(configPath, explicitType);
        } else if (!!(match = otherParameter.exec(line))) {
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
    private async getCurrentConfigPath(pos: Position) {

        let configPath: string[] = [];
        let types: { config: string[], name: string }[] = [];
        let { row } = pos;
        let typePath;

        let line = this.doc.getTextInRange([pos.row, 0], [pos.row, pos.column]);

        let normalize = (configPath: string[]) => ppath.join.apply(undefined, configPath).split(ppath.sep);

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
            line = this.doc.getTextForRow(row);

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
        let postLine = this.doc.getTextInRange([pos.row, pos.column], [pos.row, pos.column + 1]);
        let blockPostfix = postLine.length > 0 && postLine[0] === ']' ? '' : ']';

        // handle relative paths
        let blockPrefix = configPath.length > 0 ? '[./' : '[';

        // add block close tag to suggestions
        if (configPath.length > 0) {
            completions.push({
                kind: "closing",
                text: `[../${blockPostfix}`,
                displayText: '..'
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
                    snippet: blockPrefix + '${1:name}' + blockPostfix
                });
            } else if (completion !== '') {
                if (completions.findIndex(c => c.displayText === completion) < 0) {
                    completions.push({
                        kind: "block",
                        text: blockPrefix + completion + blockPostfix,
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

    /** gather subblocks of a given top block 
     *  
     * @param blockName the name of the top block (e.g. Functions, PostProcessors)
     * @param propertyNames 
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

        let nlines = this.doc.getLineCount();

        // find start of selected block
        while (i < nlines && this.doc.getTextForRow(i).indexOf(`[${blockName}]`) === -1) {
            i++;
        }

        // parse contents of subBlock block
        while (true) {

            if (i >= nlines) {
                break;
            }
            let line = this.doc.getTextForRow(i);
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
                    text: name,
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
        let filePath = ppath.dirname(this.doc.getPath());
        let dir = fs.readdirSync(filePath);  // TODO this should be async

        let completions: Completion[] = [];
        for (let name of Array.from(dir)) {
            completions.push({ kind: "value", text: name });
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
            completions = [{ kind: 'value', text: 'true' }, { kind: 'value', text: 'false' }];
        } else if (param.cpp_type === 'MooseEnum' && singleOK || param.cpp_type === 'MultiMooseEnum' && vectorOK) {
            if (param.options !== null && param.options !== undefined) {
                for (let option of Array.from(param.options.split(' '))) {
                    completions.push({
                        kind: 'value',
                        text: option
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
                completions.push({ text: output, kind: "value" });
            }
        } else if (hasType('FileName') || hasType('MeshFileName')) {
            completions = this.computeFileNameCompletion(['*.e']);
        }

        return completions;
    }

    /** provide completions for a type parameter
      * 
      * @param pos 
      * @param configPath 
      */
    private async completeTypeParameter(line: string, configPath: string[], explicitType: string | null) {

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
        let newmatch = await this.syntaxdb.matchSyntaxNode(configPath);
        if (newmatch !== null) {
            let { node } = newmatch;
            // iterate over subblocks and add final yaml path element to suggestions
            for (let subNode of Array.from(node.subblocks || [])) {
                completion = subNode.name.split('/').slice(-1)[0];
                completions.push({
                    kind: "type",
                    text: completion,
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

            completions.push({
                kind: param.name === 'type' ? 'type' : "parameter",
                required: param.required.toLowerCase() === "yes" ? true : false,
                displayText: param.name,
                snippet: param.name + ' = ${1:' + defaultValue + '}',
                description: param.description,
            });
        }
        return completions;
    }

    /**
     * assess the outline of the whole document,
     * returning the outline structure of the document,
     * and a list of syntax errors
     */
    public async assessOutline() {

        let outline: OutlineItem[] = [];
        let syntaxErrors: SyntaxError[] = [];

        let level = 0;
        let blockName: string;

        for (var row = 0; row < this.doc.getLineCount(); row++) {
            let line = this.doc.getTextForRow(row);

            // remove comments and leading/trailing spaces
            // TODO what if if within "string" definition? (should use better regex)
            line = line.trim().split("#")[0].trim();

            if (blockOpenTop.test(line)) {

                // test we are not already in a top block
                if (level > 0) {
                    syntaxErrors.push({
                        row: row, msg: 'block opened before previous closed',
                        insertionBefore: "[../]\n".repeat(level - 1) + "[]\n"
                    });
                    this.updateEndRows(outline, 1, level, row - 1);
                    level = 0;
                }

                // get details of the block
                let blocknames = blockOpenTop.exec(line);
                blockName = blocknames !== null ? blocknames[1] : '';
                if (outline.map(o => o.name).indexOf(blockName) !== -1) {
                    syntaxErrors.push({
                        row: row, msg: 'duplicate block name'
                    });
                }
                let descript = '';
                let match = await this.syntaxdb.matchSyntaxNode([blockName]);

                // check the block name exists
                if (match === null) {
                    syntaxErrors.push({
                        row: row, msg: 'block name does not exist'
                    });
                } else {
                    descript = match.node.description;
                }

                // add the block to the outline 
                outline.push({
                    name: blockName,
                    kind: 'block',
                    description: descript,
                    level: 1,
                    start: row,
                    end: null,
                    children: []
                });
                level = 1;

            } else if (blockCloseTop.test(line)) {
                if (level > 1) {
                    syntaxErrors.push({
                        row: row, msg: 'closed parent block before closing children',
                        insertionBefore: "[../]\n".repeat(level - 1)
                    });
                    this.updateEndRows(outline, 2, level, row - 1);

                } else if (level < 1) {
                    syntaxErrors.push({
                        row: row, msg: 'closed block before opening one',
                        insertionBefore: "[${1:name}]\n"
                    });
                }
                this.updateEndRows(outline, 1, 1, row);
                level = 0;
            } else if (blockOpenOneLevel.test(line)) {

                // check for errors
                if (level === 0) {
                    syntaxErrors.push({
                        row: row, msg: 'opening sub-block before main block',
                        insertionBefore: "[${1:name}]\n"
                    });
                    level = 1;
                }

                // get parent node
                let {child, config} = this.getInnerChild(outline, level);

                // get details of the block
                let blockregex = blockOpenOneLevel.exec(line);
                blockName = blockregex !== null ? blockregex[1] : '';
                if (child.children.map(o => o.name).indexOf(blockName) !== -1) {
                    syntaxErrors.push({
                        row: row, msg: 'duplicate block name'
                    });
                }
                let descript = '';
                config.push(blockName);
                let match = await this.syntaxdb.matchSyntaxNode([blockName]);

                // check the block name exists
                if (match === null) {

                } else {
                    descript = match.node.description;
                }

                level++;
                child.children.push({
                    name: blockName,
                    kind: 'block',
                    description: descript,
                    level: level,
                    start: row,
                    end: null,
                    children: []
                });

            } else if (blockCloseOneLevel.test(line)) {
                if (level === 0) {
                    syntaxErrors.push({
                        row: row, msg: 'closing sub-block when outside blocks',
                        // insertionAfter: "[]\n"
                    });
                } else if (level === 1) {
                    syntaxErrors.push({
                        row: row, msg: 'closing sub-block when inside main block',
                        // insertionAfter: "[]\n"
                    });
                } else {
                    let {child} = this.getInnerChild(outline, level);
                    child.end = row;
                    level--;
                }
            } // TODO get parameters and check against syntax
        }

        if (level !== 0) {
            syntaxErrors.push({
                row: row, msg: 'block(s) unclosed',
                insertionAfter: "[../]\n".repeat(level - 1) + "[]\n"
            });
            this.updateEndRows(outline, 1, level, row);
        }

        return { outline: outline, errors: syntaxErrors };
    }

    // update the end row for blocks
    private updateEndRows(outline: OutlineItem[],
        startLevel: number, endLevel: number, row: number) {
        if (outline.length === 0) {
            return;
        }
        let item: OutlineItem = outline[outline.length - 1];
        for (let l = 1; l < endLevel + 1; l++) {
            if (l >= startLevel) {
                item.end = row;
            }
            if (item.children.length === 0) {
                break;
            }
            item = item.children[item.children.length - 1];
        }
    }

    private getInnerChild(outline: OutlineItem[], level: number){

        let item: OutlineItem = outline[outline.length - 1];
        let config = [item.name];
        for (let l = 1; l < level; l++) {
            item = item.children[item.children.length - 1];
            config.push(item.name);
        }
        return {child: item, config: config};
    }

}
