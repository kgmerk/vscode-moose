'use strict';

//
// Note: This example test is leveraging the Mocha test framework.
// Please refer to their documentation on https://mochajs.org/ for help.
//

// The module 'assert' provides assertion methods from node
// import * as assert from 'assert';
import * as chai from 'chai';
import * as chaiAsPromised from 'chai-as-promised';
chai.use(chaiAsPromised);
var assert = chai.assert;
var expect = chai.expect;

// You can import and use all API from the 'vscode' module
// as well as import your extension to test it
// import * as vscode from 'vscode';
import * as moosedb from '../moose_objects';
// import {appData, syntaxNode} from '../moose_objects';

// Defines a Mocha test suite to group tests of similar kind together
suite("MooseObjectsDB Tests", function () {

    test("Initialise", function () {
        let db = new moosedb.MooseObjectsDB();
    });

    test("Rebuild (no yaml set)", function () {
        let db = new moosedb.MooseObjectsDB();
        return assert.throws(() => db.rebuildAppData(), Error);
    });

    test("Rebuild (non-existent yaml)", function () {
        let db = new moosedb.MooseObjectsDB();
        assert.throws(() => db.setYamlPath('non-existent'), Error);
 
        // old way to do it without chaiAsPromised
        // if (db.appdata.promise !== undefined) {
        //     return db.appdata.promise
        //         .then(
        //             () => Promise.reject(new Error('Expected method to reject.')),
        //             err => assert.instanceOf(err, Error)
        //         );
        // }
    });
 
    test("Rebuild (bad yaml)", function () {
        let db = new moosedb.MooseObjectsDB();
        db.setYamlPath('/Users/cjs14/GitHub/vscode-moose/src/test/bad.yaml');
        // TODO how to specify relative data path for test
        db.rebuildAppData();
        return expect(db.retrieveSyntaxNodes()).to.eventually.be.rejectedWith(Error);
    });

    test("Rebuild (success)", function () {
        let db = new moosedb.MooseObjectsDB();
        db.setYamlPath('/Users/cjs14/GitHub/vscode-moose/src/test/syntax.yaml');
        db.rebuildAppData();
        return expect(db.retrieveSyntaxNodes()).to.eventually.be.instanceOf(Array);
        // TODO how to test for instance of interface or array of interfaces (can create a test class implementing syntaxNode?)
    });

    test("Match Syntax Node (failure)", function () {
        let db = new moosedb.MooseObjectsDB();
        db.setYamlPath('/Users/cjs14/GitHub/vscode-moose/src/test/syntax.yaml');
        db.rebuildAppData();
        return expect(db.matchSyntaxNode(['wrong'])).to.eventually.be.equal(null);
    });

    test("Match Syntax Node (success)", function () {
        let db = new moosedb.MooseObjectsDB();
        db.setYamlPath('/Users/cjs14/GitHub/vscode-moose/src/test/syntax.yaml');
        db.rebuildAppData();
        return expect(db.matchSyntaxNode(['Kernels'])).to.eventually.be.instanceOf(Object);
    });

});

