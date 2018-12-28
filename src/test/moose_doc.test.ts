'use strict';

//
// Note: These tests are leveraging the Mocha test framework.
// Please refer to their documentation on https://mochajs.org/ for help.
//

import * as ppath from 'path';
// import * as assert from 'assert';
import * as chai from 'chai';
// import * as chaiThings from 'chai-things';
import * as chaiAsPromised from 'chai-as-promised';
chai.use(chaiAsPromised);
// chai.use(chaiThings).use(chaiAsPromised);
// var assert = chai.assert;
var expect = chai.expect;

import * as moosedoc from '../moose_doc';
import * as moosedb from '../moose_syntax';

/**
 * a class with the simplest implementation of a Document interface
 */
class TestDoc implements moosedoc.Document {

    text = "";
    getPath() {
        return "test";
    }
    getText() {
        return this.text;
    }
    getLineCount() {
        return this.text.split('\n').length;
    }
    getTextInRange(start: [number, number], end: [number, number]) {
        let i: number;
        let out: string[] = [];
        let lines = this.text.split('\n');

        if (start[0] > end[0]) {
            throw Error('the start is before the end');
        }

        if (start[0] === end[0]) {
            if (start[1] > end[1]) {
                throw Error('the start is before the end');
            }
            out.push(lines[start[0]].slice(start[1], end[1]));
        } else {
            out.push(lines[start[0]].slice(start[1]));
            for (i = start[0] + 1; i < end[0] - 1; i++) {
                out.push(lines[i]);
            }
            out.push(lines[end[0]].slice(end[1]));
        }

        return out.join("\n");
    }
    getTextForRow(row: number) {
        return this.text.split('\n')[row];
    }

}

suite("MooseDoc Tests", function () {

    var mdoc: moosedoc.MooseDoc;
    var doc: TestDoc;
    var db: moosedb.MooseSyntaxDB;

    suiteSetup(function () {
        db = new moosedb.MooseSyntaxDB();
        // TODO is the best way to set the path?
        let ypath = ppath.resolve(__dirname, '../../src/test/syntax.yaml');
        db.setPaths(ypath);
    });

    setup(function () {
        // console.log("setup test")
        doc = new TestDoc();
        mdoc = new moosedoc.MooseDoc(doc, db);
    });

    test("Completion; block", function () {
        doc.text = "[]";
        let cursor = { row: 0, column: 1 };
        // mdoc.findCompletions(cursor).then(value => {
        //     console.log(value);
        // });
        return expect(mdoc.findCompletions(cursor)
        ).to.eventually.be.an('array').that.has.length(37).and.deep.include({
            kind: "block",
            text: "[ADKernels",
            displayText: "ADKernels",
            replacementPrefix: "["
        });
    });

    test("Completion; type value", function () {
        doc.text = `
[Kernels]
    [./akernel]
        type = 
    [../]
[]
        `;
        let cursor = { row: 3, column: 16 };
        // mdoc.findCompletions(cursor).then(value => {
        //     console.log(value);
        // });
        return expect(mdoc.findCompletions(cursor)
        ).to.eventually.be.an('array').that.has.length(116).and.deep.include({
            kind: "type",
            text: "ACBarrierFunction",
            description: "",
            replacementPrefix: ""
        });
    });

    test("Completion; parameter name", function () {
        doc.text = `
[Kernels]
    [./akernel]
        type = ACBarrierFunction

    [../]
[]
        `;
        let cursor = { row: 4, column: 9 };
        // mdoc.findCompletions(cursor).then(value => {
        //     console.log(value);
        // });
        return expect(mdoc.findCompletions(cursor)
        ).to.eventually.be.an('array').that.has.length(20).and.deep.include({
            kind: "parameter",
            required: true,
            displayText: "variable",
            snippet: "variable = ${1:}",
            description: "The name of the variable that this Kernel operates on\n",
            replacementPrefix: "",
        });
    });

    test("Completion; parameter value", function () {
        doc.text = `
[BCs]
    [./akernel]
        type = ACBarrierFunction
        use_displaced_mesh = 
    [../]
[]
        `;
        let cursor = { row: 4, column: 30 };
        // mdoc.findCompletions(cursor).then(value => {
        //     console.log(value);
        // });
        return expect(mdoc.findCompletions(cursor)
        ).to.eventually.eql([
            {
                kind: "value",
                text: "true",
                replacementPrefix: ""
            },
            {
                kind: "value",
                text: "false",
                replacementPrefix: ""
            }
        ]);
    });

    test("Outline (with errors)", function () {
        doc.text = `
[]
[Kernels]
    [./v1]
    [../]

[Kernels]
    [./akernel]
        type = ACBarrierFunction
        use_displaced_mesh = 1
    [../]

        `;
        // mdoc.assessOutline().then(value => {
        //     console.log(value);
        // });
        return expect(mdoc.assessOutline()).to.eventually.eql({
            outline: [{
                name: "Kernels",
                kind: "block",
                description: "",
                level: 1,
                start: 2, end: 5,
                children: [{
                    name: "v1",
                    description: "",
                    kind: "block",
                    level: 2,
                    start: 3, end: 4,
                    children: []
                }]
            },
            {
                name: "Kernels",
                kind: "block",
                description: "",
                level: 1,
                start: 6, end: 13,
                children: [{
                    name: "akernel",
                    description: "",
                    kind: "block",
                    level: 2,
                    start: 7, end: 10,
                    children: []
                }]
            }],
            errors: [{
                row: 1,
                msg: "closed block before opening one",
                insertionBefore: "[${1:name}]\n"
            },
            {
                row: 6,
                msg: "block opened before previous closed",
                insertionBefore: "[]\n"
            },
            {
                row: 6,
                msg: "duplicate block name"
            },
            {
                row: 13,
                msg: "block(s) unclosed",
                insertionAfter: "[]\n"
            }]
        });
    });

});