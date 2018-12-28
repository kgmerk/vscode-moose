'use strict';

//
// Note: These tests are leveraging the Mocha test framework.
// Please refer to their documentation on https://mochajs.org/ for help.
//

// import * as assert from 'assert';
import * as chai from 'chai';
import * as chaiAsPromised from 'chai-as-promised';
chai.use(chaiAsPromised);
var assert = chai.assert;
var expect = chai.expect;

// You can import and use all API from the 'vscode' module
// as well as import your extension to test it
// import * as vscode from 'vscode';
import * as moosedb from '../moose_syntax';
// import {appData, syntaxNode} from '../moose_objects';

// Defines a Mocha test suite to group tests of similar kind together
suite("MooseSyntaxDB Tests", function () {

    // TODO these tests don't rely on vscode, so can we simplify test config (to not launch vscode)
    // TODO how to specify relative data path for test?
    // TODO how to that an object (or all objects in an array) matches an interface?
    // possibly look at chai-like, chai-things, chai-interface
    // chai-interface doesn't have @types/chai-interface

    var db: moosedb.MooseSyntaxDB;

    // setup before each test (NB: use SuiteSetup for setup for whole suite)
    setup(function () {
        // console.log("setup test")
        db = new moosedb.MooseSyntaxDB();
    });
    teardown(function () {
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
        // TODO this logs a; rejected promise not handled within 1 second, is that ok?
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
        return expect(db.matchSyntaxNode(['Kernels', 'AllenCahn'])
        ).to.eventually.have.property('node').which.has.keys(
            ['name', 'description', 'parameters', 'subblocks']);
    });

    test("fetch Parameter List (failure)", function () {
        db.setYamlPath('/Users/cjs14/GitHub/vscode-moose/src/test/syntax.yaml');
        return expect(db.fetchParameterList(['non-existent'])
        ).to.eventually.be.instanceof(Array).that.has.length(0);
    });

    test("fetch Parameter List (success)", function () {
        db.setYamlPath('/Users/cjs14/GitHub/vscode-moose/src/test/syntax.yaml');
        // db.rebuildAppData();
        // db.fetchParameterList(['Kernels','AllenCahn']).then(value => {
        //     console.log(value);
        // });     
        return expect(db.fetchParameterList(['Kernels', 'AllenCahn'])
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

    test("get syntax blocks", function () {
        db.setYamlPath('/Users/cjs14/GitHub/vscode-moose/src/test/syntax.yaml');
        // db.getSyntaxBlocks(["Adaptivity"]).then(value => {
        //     console.log(value);
        // }); 
        return expect(db.getSubBlocks(["Adaptivity"])
        ).to.eventually.be.instanceof(Array).that.eqls(
            ["Adaptivity/Indicators", "Adaptivity/Indicators/*",
                "Adaptivity/Markers", "Adaptivity/Markers/*"]);
    });

    test("get syntax blocks (with path)", function () {
        db.setYamlPath('/Users/cjs14/GitHub/vscode-moose/src/test/syntax.yaml');
        // db.getSyntaxBlocks(["Modules", "PhaseField"]).then(value => {
        //     console.log(value);
        // }); 
        return expect(db.getSubBlocks(["Modules", "PhaseField"])
        ).to.eventually.be.instanceof(Array).that.eqls(
            [
                "Modules/PhaseField/Conserved",
                "Modules/PhaseField/Conserved/*",
                "Modules/PhaseField/MortarPeriodicity",
                "Modules/PhaseField/MortarPeriodicity/*",
                "Modules/PhaseField/Nonconserved",
                "Modules/PhaseField/Nonconserved/*"]);
    });

});

