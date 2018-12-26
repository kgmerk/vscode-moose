'use strict';

// import * as ppath from 'path';
import * as fs from 'fs';
import * as yaml from 'js-yaml';
import { resolve } from 'url';

const beginMarker = '**START YAML DATA**\n';
const endMarker = '**END YAML DATA**\n';

// interface for dictionary returned by ./app --yaml
export interface paramNode {
    name: string,
    required: boolean
    default: string
    cpp_type: string
    group_name: string
    description: string
  }
  export interface syntaxNode {
    name: string;
    description: string;
    parameters: paramNode[];
    subblocks: syntaxNode[];
  }

// interface for node match
export interface nodeMatch {
    node: syntaxNode;
    fuzz: number;
    fuzzyOnLast: boolean;
  }

// data for a specific app
export interface appData {
    data?: syntaxNode[];
    promise?: Promise<syntaxNode[]>;
  }

export class MooseObjectsDB {
    /**
     * A class to manage the MOOSE objects for an app
     */

    // path to the yaml syntax file, output by ./moose-app --yaml {--allow-test-objects}
    private yaml_path: string | null = null;
    // the app data, will contain a promise if still loading or root syntax node if not
    private appdata: appData = {};

    // constructor() {
    //     this.yaml_path = null;
    // }

    private logDebug(message: string) {
        console.log("Moose Objects: " + message);
    }
    // private raiseError(err: Error) {
    //     // console.warn("Moose Objects: " + err.message);
    //     throw err;
    // }

    public setYamlPath(path: string){
        if (this.yaml_path !== null) {
            throw Error("the path is already set");
        }
        // check exists before assigning
        if (!fs.existsSync(path)){
            throw Error("the path does not exist: "+path);
        }
        this.yaml_path = path;

    }
    public getYamlPath(){
        if (this.yaml_path === null) {
            throw Error('yaml path not set');
        }
        return this.yaml_path;
    }
    
    // reload the app data
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
            throw error;
        });

        let finishSyntaxSetup = load_yaml.then(result => {
            delete this.appdata.promise;
            this.appdata.data = result;
            return result;
          });

        this.appdata.promise = finishSyntaxSetup;
 
    }

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
 
    // recurse through the nodes sub-blocks to populate a match list 
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

    public matchSyntaxNode(configPath: string[]) {
        // we need to match this to one node in the yaml tree. multiple matches may
        // occur we will later select the most specific match
        let data_promise = this.retrieveSyntaxNodes();
        let matchList: nodeMatch[] = [];

        return data_promise.then(data => {
            for (let node of data) {
                this.recurseSyntaxNode(node, configPath, matchList);
              }
          
              // no match found
              if (matchList.length === 0) {
                // return { node: null, fuzzyOnLast: null };
                // let match: nodeMatch = {
                //     fuzz: 0,
                //     fuzzyOnLast: false
                // };
                return null;
              }
          
              // sort least fuzz first and return minimum fuzz match
              matchList.sort((a, b) => a.fuzz - b.fuzz);
              return matchList[0];              
        });
          
    }

}