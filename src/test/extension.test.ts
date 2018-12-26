//
// Note: This example test is leveraging the Mocha test framework.
// Please refer to their documentation on https://mochajs.org/ for help.
//

// The module 'assert' provides assertion methods from node
import * as assert from 'assert';
import * as yaml from 'js-yaml';
import * as fs from 'fs';

// You can import and use all API from the 'vscode' module
// as well as import your extension to test it
// import * as vscode from 'vscode';
// import * as myExtension from '../extension';

// Defines a Mocha test suite to group tests of similar kind together
suite("Extension Tests", function () {

    // Defines a Mocha unit test
    test("Something 1", function() {
        assert.equal(-1, [1, 2, 3].indexOf(5));
        assert.equal(-1, [1, 2, 3].indexOf(0));
    });

    // Defines a Mocha unit test
    test("Something 2", function() {
        // TODO strip **START YAML DATA** and **END YAML DATA**
        // var doc = yaml.safeLoad(fs.readFileSync('/Users/cjs14/GitHub/vscode-moose/src/test/syntax.yaml', 'utf8'));
        // for (let key of doc){
        //     console.log(key.name);
        // }
   
    });

});