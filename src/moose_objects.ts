'use strict';

// import * as ppath from 'path';
import * as fs from 'fs';
import * as yaml from 'js-yaml';

const beginMarker = '**START YAML DATA**\n';
const endMarker = '**END YAML DATA**\n';

export class MooseObjectsDB {
    /**
     * A class to manage the MOOSE objects for an app
     */

    // path to the yaml syntax file, output by ./moose-app --yaml {--allow-test-objects}
    private yaml_path: string | null = null;
    // 
    private syntax_dict: Object = {};

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
        // TODO check exists before assigning
        this.yaml_path = path;
    }
    public getYamlPath(){
        if (this.yaml_path === null) {
            throw Error('yaml path not set');
        }
        return this.yaml_path;
    }
    
    public rebuildDB(){
        /** rebuild the database */

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
        let syntax_dict = content.then(value => {
            try {
                return yaml.safeLoad(value);
            } catch (err) {
                throw err;
            }
        }).catch(err => {throw err;});

        this.syntax_dict = syntax_dict;

        return syntax_dict;
    
    
        


        


    }




}