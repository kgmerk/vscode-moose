/**
 * A module to manage the MOOSE syntax nodes for an app
 */
'use strict';

import * as fs from 'fs';
import * as yaml from 'js-yaml';
import * as ppath from 'path';
import * as util from 'util';

// interface for dictionary returned by ./moose-app --yaml
export interface ParamNode {
    name: string;
    required: "Yes" | "No";
    default: string;
    cpp_type: string;
    group_name: string | null;
    description: string;
    options?: string | null;
}
export interface SyntaxNode {
    name: string;
    description: string;
    parameters: ParamNode[] | null;
    subblocks: SyntaxNode[] | null;
    file?: string;
}
export interface JsonNode {
    [item: string]: JsonNode | string | boolean | number;
}

// interface for node match
export interface nodeMatch {
    node: SyntaxNode;
    fuzz: number;
    fuzzyOnLast: boolean;
}

/**
 * A class to manage the MOOSE syntax nodes for an app
 * 
 * This class is agnostic to the implementing program
 */
export class MooseSyntaxDB {

    // path to the yaml syntax file, output by ./moose-app --yaml {--allow-test-objects}
    private yaml_path: string | null = null;
    private syntaxNodes: Promise<SyntaxNode[]> | null = null;
    // path to the yaml syntax file, output by ./moose-app --json {--allow-test-objects}
    private json_path: string | null = null;
    private jsonNodes: Promise<JsonNode> | null = null;
    // handles to deal with logging and errors
    private logHandles: ((message: string) => void)[] = [];
    private errHandles: ((error: Error) => void)[] = [];

    private handleLog(message: string) {
        for (let handle of this.logHandles) {
            handle(message);
        }
    }
    /** set list of functions to handle error messages (e.g. console.log) */
    public setLogHandles(handles: ((message: string) => void)[]) {
        this.logHandles = handles;
    }

    private handleError(err: Error) {
        for (let handle of this.errHandles) {
            handle(err);
        }
    }
    /** set list of functions to handle error messages (e.g. console.warn) */
    public setErrorHandles(handles: ((error: Error) => void)[]) {
        this.errHandles = handles;
    }

    /**
     * set the path path to the syntax files
     * 
     * The YAML file is the primary resource,
     * but the (optional) json file also provides additional definition and source file information
     * 
     * @param ypath path to yaml file: output by `./moose-app --yaml {--allow-test-objects}`
     * @param jpath path to json file: output by `./moose-app --json {--allow-test-objects}`
     */
    public setPaths(ypath: string | null = null, jpath: string | null = null) {

        let rebuild_yaml = false;
        if (ypath !== null) {
            if (!fs.existsSync(ypath)) {
                let err = Error("the yaml path does not exist: " + ypath);
                this.handleError(err);
                // throw err;
            } else {
                let new_yaml = ppath.resolve(ypath);
                if (this.yaml_path === null || this.yaml_path !== new_yaml) {
                    this.yaml_path = ypath;
                    rebuild_yaml = true;
                }
            }
        }

        let rebuild_json = false;
        if (jpath !== null) {
            if (!fs.existsSync(jpath)) {
                let err = Error("the json path does not exist: " + jpath);
                this.handleError(err);
                // throw err;
            } else {
                let new_json = ppath.resolve(jpath);
                if (this.json_path === null || this.json_path !== new_json) {
                    this.json_path = jpath;
                    rebuild_json = true;
                }
            }
        }

        this.rebuildAppData(rebuild_yaml, rebuild_json);
    }
    public getPaths() {
        return {
            yamlPath: this.yaml_path,
            jsonPath: this.json_path
        };
    }

    /**
     * reload the syntax data
     */
    public rebuildAppData(yaml: boolean = true, json: boolean = true) {

        let { yamlPath, jsonPath } = this.getPaths();

        if (yamlPath === null) {
            let err = Error("no yaml data path set");
            this.handleError(err);
            // throw err;
            return;
        }
        if (yaml) {
            this.syntaxNodes = this.loadYamlData(yamlPath);
            if (this.syntaxNodes !== null) {
                this.syntaxNodes.then(value => {
                    this.handleLog("Loaded Syntax Nodes");
                }).catch(reason => this.handleError(Error(reason)));
            }
        }

        if (json && jsonPath !== null) {
            this.jsonNodes = this.loadJsonData(jsonPath);
            if (this.jsonNodes !== null) {
                this.jsonNodes.then(value => {
                    this.handleLog("Loaded JSON Nodes");
                }).catch(reason => this.handleError(Error(reason)));
            }
        }

    }

    /** retrieve a list of all root syntax nodes
     */
    public retrieveSyntaxNodes() {
        if (this.syntaxNodes === null) {
            let err = Error("syntax data not set");
            this.handleError(err);
            // throw err;
            return new Promise<SyntaxNode[]>(resolve => { return [] as SyntaxNode[]; });
        }
        // this.syntaxNodes.catch(reason => this.handleError(Error(reason)));
        return this.syntaxNodes;
    }

    private removeMarkers(content: string, beginMarker: string, endMarker: string) {
        // remove the beginning and ending markers, if present
        let first_index: number | undefined;
        let beginId = content.indexOf(beginMarker);
        if (beginId < 0) {
            first_index = undefined;
        } else {
            first_index = beginId + beginMarker.length;
        }
        let last_index: number | undefined;
        let endId = content.indexOf(endMarker);
        if (endId < 0) {
            last_index = undefined;
        } else {
            last_index = beginId + endMarker.length;
        }
        content = content.slice(first_index, last_index);

        return content;

    }

    private async loadYamlData(yaml_path: string) {

        // read the file asynchronously
        const readFile = util.promisify(fs.readFile);
        // try {
        //     var yaml_content = await readFile(yaml_path, 'utf8');
        // } catch (err) {
        //     // this.handleError(err);
        //     throw err;
        // }
        var yaml_content = await readFile(yaml_path, 'utf8');


        // markers to remove at the beginning and end of the file
        yaml_content = this.removeMarkers(yaml_content,
            '**START YAML DATA**\n', '**END YAML DATA**\n');

        // convert the content to syntax nodes
        let data: SyntaxNode[] = yaml.safeLoad(yaml_content);

        return data;

    }

    private async loadJsonData(json_path: string) {

        // read the file asynchronously
        const readFile = util.promisify(fs.readFile);
        try {
            var json_content = await readFile(json_path, 'utf8');
        } catch (err) {
            //this.handleError(err);
            throw err;
        }

        // markers to remove at the beginning and end of the file
        json_content = this.removeMarkers(json_content,
            '**START JSON DATA**\n', '**END JSON DATA**\n');

        // convert the content to syntax nodes
        let data: JsonNode = await JSON.parse(json_content);

        return data;
    }

    /** recurse through the nodes sub-blocks to populate a match list 
    */
    private recurseSyntaxNode(node: SyntaxNode, configPath: string[], matchList: nodeMatch[]) {
        let yamlPath = node.name.substr(1).split('/');

        // no point in recursing deeper
        if (yamlPath.length > configPath.length) {
            return;
        }

        // compare paths if we are at the correct level
        if (yamlPath.length === configPath.length) {
            let fuzz = 0;
            let match = true;
            let fuzzyOnLast = false;

            // TODO compare with specificity depending on '*'
            for (let index = 0; index < configPath.length; index++) {
                let configPathElement = configPath[index];
                if (yamlPath[index] === '*') {
                    fuzz++;
                    fuzzyOnLast = true;
                } else if (yamlPath[index] !== configPathElement) {
                    match = false;
                    break;
                } else {
                    fuzzyOnLast = false;
                }
            }

            // match found
            if (match) {
                matchList.push({
                    fuzz: fuzz,
                    node: node,
                    fuzzyOnLast: fuzzyOnLast
                });
                return;
            }

            // recurse deeper otherwise
        } else {
            (node.subblocks || [] as SyntaxNode[]).map(subNode => this.recurseSyntaxNode(subNode, configPath, matchList));
            return;
        }
    }

    /**
     * finds a match for a syntax node
     * 
     * @param   configPath path to the node
     * @param   addJsonData if true, attempt to add additional data from the json file to the node
     * @returns a promise of a nodeMatch or null if no match found
     */
    public async matchSyntaxNode(configPath: string[], addJsonData = true) {

        // we need to match this to one node in the yaml tree. multiple matches may
        // occur we will later select the most specific match
        let data = await this.retrieveSyntaxNodes();
        let matchList: nodeMatch[] = [];

        for (let node of data) {
            this.recurseSyntaxNode(node, configPath, matchList);
        }

        // no match found
        if (matchList.length === 0) {
            // let match: nodeMatch = {
            //     fuzz: 0,
            //     fuzzyOnLast: false
            // };
            return null;
        }

        // sort least fuzz first and return minimum fuzz match
        matchList.sort((a, b) => a.fuzz - b.fuzz);
        let match = matchList[0];

        // append json data
        if (addJsonData && (util.isUndefined(match.node.file))) {
            await this.addJSONData(match.node, configPath);
        }

        return match;

    }

    // lazily add json data to a node (i.e. only add it when needed)
    private async addJSONData(node: SyntaxNode, configPath: string[]) {

        let success = false

        if (this.jsonNodes === null) {
            return success;
        }

        let jsonNode = null;
        if (configPath.length === 2) {
            jsonNode = this.getKeyPath(await this.jsonNodes, ["blocks", configPath[0], "star",
                "subblock_types", configPath[1]]);
        }
        if (configPath.length === 3) {
            if (configPath[1] === "<type>") {
                jsonNode = this.getKeyPath(await this.jsonNodes, ["blocks", configPath[0],
                    "types", configPath[2]]);
            }
        }
        if (jsonNode !== null) {
            if ("syntax_path" in jsonNode) {
                if (jsonNode["syntax_path"] === configPath.join("/")) {
                    success = true;
                    if ("description" in jsonNode) {
                        node.description = jsonNode["description"];
                    }
                    if ("register_file" in jsonNode) {
                        node.file = jsonNode["register_file"];
                    }
                }

            }
        }

        return success;
    }

    // TODO this should be a generator method (yield), 
    // but not sure can be implemented yet (see https://stackoverflow.com/questions/44883643/how-to-declare-async-generator-function)
    public async iterateSubBlocks (node: SyntaxNode, configPath: string[], addJsonData = true) {

        let subNodes = [];

        for (let subNode of Array.from(node.subblocks || [])) {
            // append json data
            if (addJsonData && (util.isUndefined(subNode.file))) {
                // TODO do we need to deal with typed paths?
                await this.addJSONData(subNode, subNode.name.substr(1).split("/"));
            }
            
            subNodes.push(subNode);
        }

        return subNodes;
    }

    // get the leaf node of a nested dictionary path
    private getKeyPath(nodes: any, keyPath: string[]) {
        for (let key of keyPath) {
            if (!util.isObject(nodes)) {
                return null;
            }
            if (key in nodes) {
                nodes = nodes[key];
            } else {
                return null;
            }
        }
        return nodes;
    }

    /** add the `/Type` (or `/<type>/Type` for top level blocks) pseudo path
    * if we are inside a typed block
    */
    public getTypedPath(configPath: string[], type: null | string, fuzzyOnLast: boolean) {
        let typedConfigPath = configPath.slice();

        if (type !== null && type !== '') {

            if (fuzzyOnLast) {
                typedConfigPath[configPath.length - 1] = type;
            } else {
                typedConfigPath.push(...Array.from(['<type>', type] || []));
            }
        }

        return typedConfigPath;
    }

    /** fetch a list of valid parameters for a syntax path
     * 
     * @param  {string[]} configPath
     * @param  {null|string} explicitType
     */
    public async fetchParameterList(configPath: string[], explicitType: null | string = null) {

        // parameters cannot exist outside of top level blocks
        if (configPath.length === 0) {
            return [] as ParamNode[];
        }

        let match = await this.matchSyntaxNode(configPath);

        // bail out if we are in an invalid path
        if (match === null) {
            return [] as ParamNode[];
        }

        let { node, fuzzyOnLast } = match;
        let searchNodes: SyntaxNode[] = [node];

        // add typed node if either explicitly set in input or if a default is known
        if (explicitType === null) {
            for (let param of Array.from(node.parameters || [])) {
                if (param.name === 'type') {
                    explicitType = param.default;
                    break;
                }
            }
        }

        if (explicitType !== null) {
            let typedPath = this.getTypedPath(configPath, explicitType, fuzzyOnLast);
            let result = await this.matchSyntaxNode(typedPath);
            if (result === null) {
                // return [] as paramNode[]; // TODO this was in original code but doesn't work?
            } else {
                searchNodes.unshift(result.node);
            }
        }

        let paramList: ParamNode[] = [];
        for (node of Array.from(searchNodes)) {
            if (node !== null) {
                paramList.push(...Array.from(node.parameters || [] as ParamNode[]));
            }
        }

        return paramList;

    }

    /**
     * 
     * @param node root node
     * @param basePath the required base path
     * @param matchList 
     */
    private recurseSubBlocks(node: SyntaxNode, basePath: string[], matchList: string[]) {

        let yamlPath = node.name.substr(1).split('/');

        // return if not matching base path 
        let length = basePath.length <= yamlPath.length ? basePath.length : yamlPath.length;
        let match = true;
        for (let index = 0; index < length; index++) {
            if (yamlPath[index] !== '*' && yamlPath[index] !== basePath[index]) {
                match = false;
                break;
            }
        }
        if (!match) { return; }

        // if (yamlPath.slice(0, length).join('/') !== basePath.slice(0, length).join('/')) {
        //     return;
        // }

        if ((node.subblocks !== null && yamlPath[yamlPath.length - 1] !== '<type>') || (yamlPath[yamlPath.length - 1] === '*')) {
            let name = node.name.substr(1);
            if (basePath.length < yamlPath.length && matchList.findIndex(value => value === name) === -1) {
                matchList.push(node.name.substr(1));
            }
        }
        if (node.subblocks !== null && yamlPath[yamlPath.length - 1] !== '<type>') {
            node.subblocks.map(subNode => this.recurseSubBlocks(subNode, basePath, matchList));
        }

    }

    /** get a list of possible sub block paths for a base path
     * 
     * @param basePath the required base path
     */
    public async getSubBlocks(basePath: string[] = []) {
        // TODO strictly should use `./moose-app --syntax` output

        let data = await this.retrieveSyntaxNodes();
        let matchList: string[] = [];

        for (let node of data) {
            this.recurseSubBlocks(node, basePath, matchList);
        }

        return matchList;
    }

}