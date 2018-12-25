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

// Defines a Mocha test suite to group tests of similar kind together
suite("MooseObjectsDB Tests", function () {

    test("Initialise", function () {
        let db = new moosedb.MooseObjectsDB();
    });

    test("Rebuild (no yaml set)", function () {
        let db = new moosedb.MooseObjectsDB();
        return assert.throws(() => db.rebuildDB(), Error);
    });

    test("Rebuild (non-existent yaml)", function () {
        let db = new moosedb.MooseObjectsDB();
        db.setYamlPath('non-existent');
        return db.rebuildDB()
            .then(
                () => Promise.reject(new Error('Expected method to reject.')),
                err => assert.instanceOf(err, Error)
            );
    });
    
    test("Rebuild", function () {
        let db = new moosedb.MooseObjectsDB();
        db.setYamlPath('/Users/cjs14/GitHub/vscode-moose/src/test/syntax.yaml');
        return expect(db.rebuildDB()).to.eventually.be.instanceOf(Object);
    });

});