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
        db.setLogHandles([]);
        db.setErrorHandles([console.warn]);
        // TODO is the best way to set the path?
        let ypath = ppath.resolve(__dirname, '../../src/test/syntax.yaml');
        let jpath = ppath.resolve(__dirname, '../../src/test/syntax.json');
        db.setPaths(ypath, jpath);
    });

    setup(function () {
        // console.log("setup test")
        doc = new TestDoc();
        mdoc = new moosedoc.MooseDoc(db, doc);
    });

    test("findCurrentNode; block", function () {
        doc.text = "[Kernels]";
        let cursor = { row: 0, column: 3 };
        // mdoc.findCurrentNode(cursor).then(value => {
        //     if (value !== null) {
        //         console.log(value.name);
        //     }

        // });
        return expect(mdoc.findCurrentNode(cursor)
        ).to.eventually.be.an('object').with.property('path').eql(['Kernels']);
    });

    test("findCurrentNode; sub-block", function () {
        doc.text = "[BCs]\n[./Periodic]\n[./c_bcs]";
        let cursor = { row: 2, column: 5 };
        return expect(mdoc.findCurrentNode(cursor)
        ).to.eventually.be.an('object').with.property('path').eql(['BCs', 'Periodic', 'c_bcs']);
    });

    test("findCurrentNode; type", function () {
        doc.text = `
[Kernels]
    [./akernel]
        type = AllenCahn
        `;
        let cursor = { row: 3, column: 17 };
        // mdoc.findCurrentNode(cursor).then(value => {
        //     if (value !== null) {
        //         console.log(value.name);
        //     } else {
        //         console.log("node not found");
        //     }
        // });
        return expect(mdoc.findCurrentNode(cursor)
        ).to.eventually.be.an('object').with.property('path').eql(['Kernels', 'akernel', 'AllenCahn']);
    });

    test("findCurrentNode; parameter", function () {
        doc.text = `
[Kernels]
    [./akernel]
        type = AllenCahn
        f_name = a
        `;
        let cursor = { row: 4, column: 11 };
        // mdoc.findCurrentNode(cursor).then(value => {
        //     if (value !== null) {
        //         console.log(value.name);
        //     } else {
        //         console.log("node not found");
        //     }
        // });
        return expect(mdoc.findCurrentNode(cursor)
        ).to.eventually.be.an('object').with.property('path').eql(
            ['Kernels', 'akernel', 'AllenCahn', 'f_name']);
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
            insertText: {
                type: "text",
                value: "ADKernels"
             },
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
            insertText: {
                type: "text",
                value: "ACBarrierFunction"
             },
            displayText: "ACBarrierFunction",
            description: "Allen Cahn kernel used when 'mu' is a function of variables",
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
            insertText: {
                type: "snippet",
                value: "variable = ${1:}"
             },
            displayText: "variable",
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
                displayText: "true",
                insertText: {
                    type: "text",
                    value: "true"
                },
                replacementPrefix: ""
            },
            {
                kind: "value",
                displayText: "false",
                insertText: {
                    type: "text",
                    value: "false"
                 },
                replacementPrefix: ""
            }
        ]);
    });

    test("Outline (with errors)", function () {
        doc.text = `
[]
 [Kernels]  # a comment
    [./v1] # a comment
    [../]

[Kernels]
    [./akernel]
 type = ACBarrierFunction # a comment
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
                start: [2, 1], end: [5, 9],
                children: [{
                    name: "v1",
                    description: "",
                    kind: "block",
                    level: 2,
                    start: [3, 4], end: [4, 9],
                    children: []
                }]
            },
            {
                name: "Kernels",
                kind: "block",
                description: "",
                level: 1,
                start: [6, 0], end: [14, 0],
                children: [{
                    name: "akernel",
                    description: "",
                    kind: "block",
                    level: 2,
                    start: [7, 4], end: [10, 9],
                    children: []
                }]
            }],
            errors: [{
                row: 1,
                columns: [0, 2],
                msg: "closed block before opening new one",
                insertionBefore: "[${1:name}]\n"
            },
            {
                row: 6,
                columns: [0, 9],
                msg: "block opened before previous one closed",
                insertionBefore: "[]\n"
            },
            {
                row: 6,
                columns: [0, 9],
                msg: "duplicate block name"
            },
            {
                row: 14,
                columns: [0, 8],
                msg: "final block(s) unclosed",
                insertionAfter: "[]\n"
            }],
            edits: [
                {msg: "wrong indentation",
                start: [2, 0], end: [2, 1],
                text: ""},
                {msg: "wrong indentation",
                start: [8, 0], end: [8, 1],
                text: "        "},
                {msg: "multiple blank lines",
                start: [11, 0], end: [13, 0],
                text: ""}
            ]
        });
    });

});