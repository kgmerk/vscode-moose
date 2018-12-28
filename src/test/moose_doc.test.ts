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

import * as moosedoc from '../moose_doc';

suite("MooseDoc Tests", function () {

    var doc: moosedoc.MooseDoc;

    setup(function() {
        // console.log("setup test")
        // doc = new moosedoc.MooseDoc();
    });

    test("", function () {
        
    });    

});