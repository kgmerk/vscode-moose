/**
 * A module to manage the MOOSE syntax nodes for an app
 */
'use strict';

import * as fs from 'fs';
import * as yaml from 'js-yaml';
import * as ppath from 'path';

// markeres to remove at the beginning and end of the file
const beginMarker = '**START YAML DATA**\n';
const endMarker = '**END YAML DATA**\n';

// interface for dictionary returned by ./moose-app --yaml
export interface paramNode {
    name: string;
    required: boolean;
    default: string;
    cpp_type: string;
    group_name: string | null;
    description: string;
    options?: string | null;
  }
  export interface syntaxNode {
    name: string;
    description: string;
    parameters: paramNode[] | null;
    subblocks: syntaxNode[] | null;
  }

// interface for node match
export interface nodeMatch {
    node: syntaxNode;
    fuzz: number;
    fuzzyOnLast: boolean;
  }

// interface of data for a specific app
export interface appData {
    data?: syntaxNode[];
    promise?: Promise<syntaxNode[]>;
  }

/**
 * A class to manage the MOOSE syntax nodes for an app
 * 
 * This class is agnostic to the implementing program
 */
export class MooseSyntaxDB {

    // path to the yaml syntax file, output by ./moose-app --yaml {--allow-test-objects}
    private yaml_path: string | null = null;
    // the app data, will contain a promise if still loading or root syntax node if not
    private appdata: appData = {};

    // constructor() {
    //     this.yaml_path = null;
    // }

    // TODO add additional debug / error handlers in constructor (store as attributes and require a particular interface)
    private logDebug(message: string) {
        console.log("Moose Objects: " + message);
    }
    private logError(err: Error) {
        console.warn("Moose Objects: " + err.message);
    }

    /**
     * set the path path to the yaml syntax file, output by `./moose-app --yaml {--allow-test-objects}`
     * 
     * If set, also call rebuild of app data
     * 
     * @param path 
     */
    public setYamlPath(path: string){
        // check exists before assigning
        if (!fs.existsSync(path)){
            throw Error("the path does not exist: "+path);
        }
        // check not same as already set
        if (this.yaml_path !== null) {
            if (this.yaml_path === ppath.normalize(path)){
                return;
            }
        }
        
        this.yaml_path = ppath.normalize(path);
        this.rebuildAppData();
    }
    public getYamlPath(){
        if (this.yaml_path === null) {
            throw Error('yaml path not set');
        }
        return this.yaml_path;
    }
    
    /**
     * reload the app data from the yaml path
     */
    public rebuildAppData(){

        // read the file
        var path = this.getYamlPath();
        let content = new Promise<string>(function(resolve, reject){
            fs.readFile(path, 'utf8', (err, content) => {
                if (err) {
                    reject(err);
                } else {
                    resolve(content);
                }
        });});

        // remove beginning and end markers if present
        content = content.then(text => {
            var first_index: number | undefined;
            let begin = text.indexOf(beginMarker);
            if (begin < 0){
                first_index = undefined;
            } else {
                first_index = begin + beginMarker.length;
            }
            var last_index: number | undefined;
            let end = text.lastIndexOf(endMarker);
            if (end < 0){
                last_index = undefined;
            } else {
                last_index = end + endMarker.length;
            }
            return text.slice(first_index, last_index);
        });   

        // get the content of the syntax yaml
        let load_yaml = content.then(value => {
            try {
                let data: syntaxNode[] = yaml.safeLoad(value);
                return data;
            } catch (err) {
                throw err;
            }
        });
        
        // handle load errors
        load_yaml.catch(error => {
            throw Error(String(error));
        });

        let finishSyntaxSetup = load_yaml.then(result => {
            delete this.appdata.promise;
            this.appdata.data = result;
            return result;
          }).catch(error => {
            throw Error(String(error));
          });

        this.appdata.promise = finishSyntaxSetup;
 
    }

    /** retrieve a list of all root syntax nodes
     */
    public retrieveSyntaxNodes() {
        var data_promise: Promise<syntaxNode[]>;
        if (this.appdata.promise !== undefined) {
            data_promise = this.appdata.promise
        } else if (this.appdata.data !== undefined) {
            // we always return a promise, for consistency
            data_promise = new Promise(
                (resolve, reject) => (resolve(this.appdata.data)));
        } else {
            throw Error('app data not set');
        }
        return data_promise;
    }
 
    /** recurse through the nodes sub-blocks to populate a match list 
    */
    private recurseSyntaxNode(node: syntaxNode, configPath: string[], matchList: nodeMatch[]) {
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
          (node.subblocks || [] as syntaxNode[]).map(subNode => this.recurseSyntaxNode(subNode, configPath, matchList));
          return;
        }
      }

    /**
     * finds a match for a syntax node
     * 
     * @param  {string[]} configPath path to the node
     * @returns a promise of a nodeMatch or null if no match found
     */
    public async matchSyntaxNode(configPath: string[]) {
       
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
        return matchList[0];              
          
    }

    /** add the `/Type` (or `/<type>/Type` for top level blocks) pseudo path
    * if we are inside a typed block
    */
    private getTypedPath(configPath: string[], type: null | string, fuzzyOnLast: boolean) {
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
            return [] as paramNode[];
        }

        let match = await this.matchSyntaxNode(configPath);

        // bail out if we are in an invalid path
        if (match === null) {
            return [] as paramNode[];
        }

        let { node, fuzzyOnLast } = match;
        let searchNodes: syntaxNode[] = [node];
              
        // add typed node if either explicitly set in input or if a default is known
        if (explicitType === null) {
            for (let param of Array.from(node.parameters || [])) {
                if (param.name === 'type') {
                    explicitType = param.default;
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
          
        let paramList: paramNode[] = [];
        for (node of Array.from(searchNodes)) {
            if (node !== null) {
                paramList.push(...Array.from(node.parameters || [] as paramNode[]));
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
    private recurseSubBlocks(node: syntaxNode, basePath: string[], matchList: string[]) {

        let yamlPath = node.name.substr(1).split('/');

        // return if not matching base path 
        let length = basePath.length <= yamlPath.length ?  basePath.length : yamlPath.length;
        let match = true;
        for (let index = 0; index < length; index++) {
            if (yamlPath[index] !== '*' && yamlPath[index] !== basePath[index]) {
                match = false;
                break;
            }
        }
        if (!match){return;}

        // if (yamlPath.slice(0, length).join('/') !== basePath.slice(0, length).join('/')) {
        //     return;
        // }

        if ((node.subblocks !== null && yamlPath[yamlPath.length-1] !== '<type>') || (yamlPath[yamlPath.length-1] === '*')) {
            let name = node.name.substr(1);
            if (basePath.length < yamlPath.length && matchList.findIndex(value => value === name) === -1){
                matchList.push(node.name.substr(1));
            }  
        } 
        if (node.subblocks !== null && yamlPath[yamlPath.length-1] !== '<type>') {
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