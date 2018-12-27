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

    // TODO how to specify relative data path for test?
    // TODO how to that an object (or all objects in an array) matches an interface?

    var db: moosedb.MooseObjectsDB;

    // setup before each test (NB: use SuiteSetup for setup for whole suite)
    setup(function() {
        // console.log("setup test")
        db = new moosedb.MooseObjectsDB();
    });
    teardown(function() {
        // console.log("teardown test")
    });

    test("Rebuild (no yaml set)", function () {
        return assert.throws(() => db.rebuildAppData(), Error);
    });

    test("Rebuild (non-existent yaml)", function () {
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
        db.setYamlPath('/Users/cjs14/GitHub/vscode-moose/src/test/bad.yaml');
        // db.rebuildAppData();
        return expect(db.retrieveSyntaxNodes()).to.eventually.be.rejectedWith(Error);
    });

    test("Rebuild (success)", function () {
        db.setYamlPath('/Users/cjs14/GitHub/vscode-moose/src/test/syntax.yaml');
        // db.rebuildAppData();
        return expect(db.retrieveSyntaxNodes()
        ).to.eventually.be.instanceOf(Array).that.has.length(41);
    });

    test("Match Syntax Node (failure)", function () {
        db.setYamlPath('/Users/cjs14/GitHub/vscode-moose/src/test/syntax.yaml');
        // db.rebuildAppData();
        return expect(db.matchSyntaxNode(['wrong'])).to.eventually.be.eql(null);
    });

    test("Match Syntax Node (success)", function () {
        db.setYamlPath('/Users/cjs14/GitHub/vscode-moose/src/test/syntax.yaml');
        // db.rebuildAppData();
        // db.matchSyntaxNode(['Kernels','AllenCahn']).then(value => {
        //     console.log(value);
        // });
        return expect(db.matchSyntaxNode(['Kernels','AllenCahn'])
        ).to.eventually.have.property('node').which.has.keys(
            ['name', 'description', 'parameters', 'subblocks']);
    });

    test("fetch Parameter List (success)", function () {
        db.setYamlPath('/Users/cjs14/GitHub/vscode-moose/src/test/syntax.yaml');
        // db.rebuildAppData();
        // db.fetchParameterList(['Kernels','AllenCahn']).then(value => {
        //     console.log(value);
        // });     
        return expect(db.fetchParameterList(['Kernels','AllenCahn'])
        ).to.eventually.be.instanceof(Array).that.has.length(17);
    });

    test("fetch Parameter List (success for typed path)", function () {
        db.setYamlPath('/Users/cjs14/GitHub/vscode-moose/src/test/syntax.yaml');
        // db.rebuildAppData();
        // db.fetchParameterList(['Mesh'], 'AnnularMesh').then(value => {
        //     console.log(value);
        // });     
        return expect(db.fetchParameterList(['Mesh'], 'AnnularMesh')
        ).to.eventually.be.instanceof(Array).that.has.length(37);
    });

});

