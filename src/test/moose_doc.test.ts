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
import { Position } from '../shared';

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
    getTextInRange(start: Position, end: Position) {
        let i: number;
        let out: string[] = [];
        let lines = this.text.split('\n');

        if (start.row > end.row) {
            throw Error('the start is before the end');
        }

        if (start.row === end.row) {
            if (start.column > end.column) {
                throw Error('the start is before the end');
            }
            out.push(lines[start.row].slice(start.column, end.column));
        } else {
            out.push(lines[start.row].slice(start.column));
            for (i = start.row + 1; i < end.row - 1; i++) {
                out.push(lines[i]);
            }
            out.push(lines[end.row].slice(end.column));
        }

        return out.join("\n");
    }
    getTextForRow(row: number) {
        return this.text.split('\n')[row];
    }
    *iterLines(initRow: number = 0) {
        let row = 0;
        for (let line of this.text.split('\n')) {
            if (row >= initRow) {
                yield { row: row, line: line };
            }
            row++;
        }
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
        doc.text = "[BCs]\n[./Periodic]\n[./c_b-cs]";
        let cursor = { row: 2, column: 5 };
        return expect(mdoc.findCurrentNode(cursor)
        ).to.eventually.be.an('object').with.property('path').eql(['BCs', 'Periodic', 'c_b-cs']);
    });

    test("findCurrentNode; sub-block defining variable", function () {
        doc.text = "[Variables]\n[./abc]\n[../]\n[]";
        let cursor = { row: 1, column: 5 };
        return expect(mdoc.findCurrentNode(cursor)
        ).to.eventually.be.an('object').with.property('defines').eql(['Variables/abc']);
    });

    test("findCurrentNode; sub-block defining DerivativeParsedMaterial", function () {
        doc.text = "[Materials]\n[./abc]\ntype=DerivativeParsedMaterial\nf_name=x\n[../]\n[]";
        let cursor = { row: 1, column: 5 };
        return expect(mdoc.findCurrentNode(cursor)
        ).to.eventually.be.an('object').with.property('defines').eql(['Materials/x']);
    });

    test("findCurrentNode; sub-block defining GenericConstantMaterial", function () {
        doc.text = "[Materials]\n[./abc]\ntype=GenericConstantMaterial\nprop_names='x y'\n[../]\n[]";
        let cursor = { row: 1, column: 5 };
        return expect(mdoc.findCurrentNode(cursor)
        ).to.eventually.be.an('object').with.property('defines').eql(['Materials/x', 'Materials/y']);
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

    test("findCurrentNode; type, where sub-block shares name of a type", function () {
        doc.text = `
[Kernels]
    [./AllenCahn]
        type = AllenCahn
        `;
        let cursor = { row: 3, column: 17 };
        return expect(mdoc.findCurrentNode(cursor)
        ).to.eventually.be.an('object').with.property('path').eql(['Kernels', 'AllenCahn', 'AllenCahn']);
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

    test("findCurrentNode; value which is reference to variable", function () {
        doc.text = `
[Variables]
    [./xy_z] # a variable
    [../]
[]
[Kernels]
    [./akernel]
        type = AllenCahn
        variable = xy_z
    [../]
[]
        `;
        let cursor = { row: 8, column: 22 };
        return expect(mdoc.findCurrentNode(cursor)
        ).to.eventually.be.an('object').eql(
            {
                path: ['Kernels', 'akernel', 'variable', 'xy_z'],
                range: [19, 23],
                defines: null,
                node: {
                    name: "xy_z",
                    description: "Referenced Variable",
                    definition: {
                        key: 'Variables/xy_z',
                        description: 'a variable',
                        position: { row: 2, column: 6 }
                    }
                }
            });
    });

    test("findCurrentNode; value which is reference to FunctionMaterialBase type material", function () {
        doc.text = `
[Materials]
    [./mat2]
        type = DerivativeParsedMaterial
        f_name = fmat
    [../]
[]
[Kernels]
    [./akernel]
        type = AllenCahn
        f_name = fmat
    [../]
[]
        `;
        let cursor = { row: 10, column: 21 };
        return expect(mdoc.findCurrentNode(cursor)
        ).to.eventually.be.an('object').which.eql(
            {
                node: {
                    name: "fmat",
                    description: "Referenced Material",
                    definition: {
                        description: "",
                        position: { "row": 4, "column": 17 },
                        key: 'Materials/fmat',
                        type: "DerivativeParsedMaterial"
                    }
                },
                path: ['Kernels', 'akernel', 'f_name', 'fmat'],
                range: [17, 21], defines: null
            });
    });

    test("findCurrentNode; value which is reference to GenericConstantMaterial type material", function () {
        doc.text = `
[Materials]
    [./mat2]
        type = GenericConstantMaterial
        prop_names = 'amat bmat'
    [../]
[]
[Kernels]
    [./akernel]
        type = AllenCahn
        f_name = bmat
    [../]
[]
        `;
        let cursor = { row: 10, column: 21 };
        return expect(mdoc.findCurrentNode(cursor)
        ).to.eventually.be.an('object').which.eql(
            {
                node: {
                    name: "bmat",
                    description: "Referenced Material",
                    definition: {
                        description: "",
                        position: { "row": 4, "column": 27 },
                        key: 'Materials/bmat',
                        type: "GenericConstantMaterial"
                    }
                },
                path: ['Kernels', 'akernel', 'f_name', 'bmat'],
                range: [17, 21], defines: null
            });
    });

    test("findCurrentNode; value which is reference to material with default name", function () {
        doc.text = `
[Materials]
    [./mat2]
        type = DerivativeParsedMaterial
    [../]
[]
[Kernels]
    [./akernel]
        type = AllenCahn
        f_name = F
    [../]
[]
        `;
        let cursor = { row: 9, column: 18 };
        return expect(mdoc.findCurrentNode(cursor)
        ).to.eventually.be.an('object').which.eql(
            {
                node: {
                    name: "F",
                    description: "Referenced Material",
                    definition: {
                        description: "",
                        position: { "row": 2, "column": 6 },
                        key: 'Materials/F',
                        type: "DerivativeParsedMaterial"
                    }
                },
                path: ['Kernels', 'akernel', 'f_name', 'F'],
                range: [17, 18], defines: null
            });
    });

    test("Completion; block", function () {
        doc.text = "[]";
        let cursor = { row: 0, column: 1 };
        // mdoc.findCompletions(cursor).then(value => {
        //     console.log(value);
        // });
        return expect(mdoc.findCompletions(cursor)
        ).to.eventually.be.an('array').that.has.length(38).and.deep.include({
            kind: "block",
            insertText: {
                type: "text",
                value: "ADKernels"
            },
            displayText: "ADKernels",
            replacementPrefix: "["
        });
    });

    test("Completion; type value, where sub-block shares a name with a type", function () {
        doc.text = `
[Kernels]
    [./TimeDerivative]
        type = 
    [../]
[]
        `;
        let cursor = { row: 3, column: 16 };
        // mdoc.findCompletions(cursor).then(value => {
        //     console.log(value);
        // });
        return expect(mdoc.findCompletions(cursor)
        ).to.eventually.be.an('array').that.has.length(116);
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
        ).to.eventually.be.an('array').that.has.length(19).and.deep.include({
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

    test("Completion; parameter value with fixed options", function () {
        doc.text = `
[Kernels]
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

    test("Completion; parameter value that references a Variable", function () {
        doc.text = `
[Variables]
    [./abc]
    [../]
[]
[Materials]
    [./h_eta]
        type = SwitchingFunctionMaterial
        eta = 
    [../]
[]
        `;
        let cursor = { row: 8, column: 15 };
        // mdoc.findCompletions(cursor).then(value => {
        //     console.log(value);
        // });
        return expect(mdoc.findCompletions(cursor)
        ).to.eventually.eql([
            {
                kind: "block",
                displayText: "abc",
                insertText: {
                    type: "text",
                    value: "abc"
                },
                replacementPrefix: "",
                description: ""
            }
        ]);
    });

    test("Completion; parameter value that references a Material", function () {
        doc.text = `
[Materials]
    [./mat1] # a material with a defined name
        type = DerivativeParsedMaterial
        f_name = dpm
    [../]
    [./g_eta] # a material with a default name
        type = BarrierFunctionMaterial
    [../]
    [./constants] # constant properties
      type = GenericConstantMaterial
      prop_names  = 'M   L'
      prop_values = '0.7 0.7'
    [../]
[]
[Kernels]
    [./ckernel]
        type = SplitCHWRes
        mob_name = 
    [../]
[]
        `;
        let cursor = { row: 18, column: 20 };
        // mdoc.findCompletions(cursor).then(value => {
        //     console.log(value);
        // });
        return expect(mdoc.findCompletions(cursor)
        ).to.eventually.eql([
            {
                "description": "Materials/mat1/dpm (DerivativeParsedMaterial)",
                "displayText": "dpm",
                "insertText": {
                    "type": "text",
                    "value": "dpm"
                },
                "kind": "value",
                "replacementPrefix": ""
            },
            {
                "description": "Materials/g_eta/g (BarrierFunctionMaterial)",
                "displayText": "g",
                "insertText": {
                    "type": "text",
                    "value": "g"
                },
                "kind": "value",
                "replacementPrefix": ""
            },
            {
                "description": "Materials/constants/M (GenericConstantMaterial)",
                "displayText": "M",
                "insertText": {
                    "type": "text",
                    "value": "M"
                },
                "kind": "value",
                "replacementPrefix": ""
            },
            {
                "description": "Materials/constants/L (GenericConstantMaterial)",
                "displayText": "L",
                "insertText": {
                    "type": "text",
                    "value": "L"
                },
                "kind": "value",
                "replacementPrefix": ""
            }
        ]);
    });

    test("Completion; material_property_names parameter", function () {
        doc.text = `
[Materials]
    [./d]
        type = DerivativeParsedMaterial
        f_name = a_b
        material_property_names = 'd3a_b:=D[a_b(x,y),x,x,y]  '
    [../]
[]`;
        let cursor = { row: 5, column: 61 };
        return expect(mdoc.findCompletions(cursor)
        ).to.eventually.eql([
            {
                "description": "Materials/d/a_b (DerivativeParsedMaterial)",
                "displayText": "a_b",
                "insertText": {
                    "type": "text",
                    "value": "a_b"
                },
                "kind": "value",
                "replacementPrefix": ""
            },
            {
                "description": "Materials/d/a_b (DerivativeParsedMaterial)",
                "displayText": "a_b with declared dependences",
                "insertText": {
                    "type": "snippet",
                    "value": "a_b(${2:variable})"
                },
                "kind": "value_snippet",
                "replacementPrefix": ""
            },
            {
                "description": "Materials/d/a_b (DerivativeParsedMaterial)",
                "displayText": "a_b derivative",
                "insertText": {
                    "type": "snippet",
                    "value": "da_b:=D[a_b,${1:variable}]"
                },
                "kind": "value_snippet",
                "replacementPrefix": ""
            }
        ]);
    });

    test("Outline (with closure/duplication errors, missing required parameter, bad indentation)", function () {
        doc.text = `
[]
 [Kernels]  # a comment
    [./v1] # a comment
    [../]

[Kernels]
    [./akernel]
 type = ACBarrierFunction # a comment
        use_displaced_mesh = # another comment
    [../]


        `;
        // mdoc.assessOutline().then(value => {
        //     console.log(value);
        // });
        return expect(mdoc.assessDocument()).to.eventually.eql({
            outline: [{
                name: "Kernels",
                description: "",
                level: 1,
                start: { row: 2, column: 1 }, end: { row: 5, column: 9 },
                children: [{
                    name: "v1",
                    description: "",
                    level: 2,
                    start: { row: 3, column: 4 }, end: { row: 4, column: 9 },
                    children: [],
                    inactive: [],
                    parameters: []
                }],
                inactive: [],
                parameters: []
            },
            {
                name: "Kernels",
                description: "",
                level: 1,
                start: { row: 6, column: 0 }, end: { row: 13, column: 0 },
                children: [{
                    name: "akernel",
                    description: "Allen Cahn kernel used when 'mu' is a function of variables",
                    level: 2,
                    start: { row: 7, column: 4 }, end: { row: 10, column: 9 },
                    children: [],
                    inactive: [],
                    parameters: [
                        {
                            "description": "A string representing the Moose Object that will be built by this Action\n",
                            "name": "type", "value": "ACBarrierFunction",
                            "start": { row: 8, column: 1 }, "end": { row: 8, column: 37 }
                        },
                        {
                            "description": "Whether or not this object should use the displaced mesh for computation. Note that in the case this is true but no displacements are provided in the Mesh block the undisplaced mesh will still be used.\n",
                            "start": { row: 9, column: 8 }, "end": { row: 9, column: 46 },
                            "name": "use_displaced_mesh", "value": null,
                        }
                    ]
                }],
                inactive: [],
                parameters: []
            }],
            errors: [{
                type: "closure",
                start: { row: 1, column: 0 }, end: { row: 1, column: 2 },
                msg: "closed block before opening new one",
                correction: {}
            },
            {
                type: "format",
                msg: "wrong indentation",
                start: { row: 2, column: 0 }, end: { row: 2, column: 1 },
                correction: { replace: "" }
            },
            {
                type: "dbcheck",
                start: { row: 3, column: 4 }, end: { row: 3, column: 10 },
                msg: "required parameter(s) \"type\" not present in block: Kernels/v1",
                correction: { insertionAfter: "\n        type = " }
            },
            {
                type: "closure",
                start: { row: 6, column: 0 }, end: { row: 6, column: 9 },
                msg: "block opened before previous one closed",
                correction: { insertionBefore: "[]\n" }
            },
            {
                type: "duplication",
                start: { row: 6, column: 0 }, end: { row: 6, column: 9 },
                msg: "duplicate block name"
            },
            {
                type: "format",
                msg: "wrong indentation",
                start: { row: 8, column: 0 }, end: { row: 8, column: 1 },
                correction: { replace: "        " }
            },
            {
                type: "dbcheck",
                start: { row: 7, column: 4 }, end: { row: 7, column: 15 },
                msg: "required parameter(s) \"gamma, v, variable\" not present in block: Kernels/akernel/ACBarrierFunction",
                correction: { insertionAfter: "\n        gamma = \n        v = \n        variable = " }
            },
            {
                type: "format",
                msg: "multiple blank lines",
                start: { row: 11, column: 0 }, end: { row: 12, column: 0 },
                correction: { replace: "" }
            },
            {
                type: "closure",
                start: { row: 13, column: 0 }, end: { row: 13, column: 8 },
                msg: "final block(s) unclosed",
                correction: { insertionAfter: "[]\n" }
            }
            ],
            "refs": null
        });
    });

    test("Outline (duplicate blocks and parameters)", function () {
        doc.text = `
[Kernels]
    [./a]
        type = b
        type = c
    [../]
    [./a]
        type = a
    [../]
[]
[Kernels]
[]        `;
        // mdoc.assessOutline().then(value => {
        //     console.log(value);
        // });
        return expect(mdoc.assessDocument()).to.eventually.eql({
            "outline": [
                {
                    "name": "Kernels", "level": 1,
                    "description": "",
                    "start": { row: 1, column: 0 }, "end": { row: 9, column: 2 },
                    "inactive": [],
                    "parameters": [],
                    "children": [
                        {
                            "children": [],
                            "description": "",
                            "start": { row: 2, column: 4 }, "end": { row: 5, column: 9 },
                            "inactive": [],
                            "level": 2,
                            "name": "a",
                            "parameters": [
                                {
                                    "description": "A string representing the Moose Object that will be built by this Action\n",
                                    "start": { row: 3, column: 8 }, "end": { row: 3, column: 16 },
                                    "name": "type",
                                    "value": "b"
                                },
                                {
                                    "description": "A string representing the Moose Object that will be built by this Action\n",
                                    "start": { row: 4, column: 8 }, "end": { row: 4, column: 16 },
                                    "name": "type",
                                    "value": "c"
                                }
                            ],
                        },
                        {
                            "children": [],
                            "description": "",
                            "start": { row: 6, column: 4 }, "end": { row: 8, column: 9 },
                            "inactive": [],
                            "level": 2,
                            "name": "a",
                            "parameters": [{
                                "description": "A string representing the Moose Object that will be built by this Action\n",
                                "start": { row: 7, column: 8 }, "end": { row: 7, column: 16 },
                                "name": "type",
                                "value": "a"
                            }],
                        }
                    ],

                },
                {
                    "name": "Kernels", "level": 1,
                    "description": "",
                    "start": { row: 10, column: 0 }, "end": { row: 11, column: 2 },
                    "inactive": [],
                    "parameters": [],
                    "children": [],
                }
            ],
            "errors": [
                {
                    "type": "duplication",
                    "start": { row: 4, column: 8 }, "end": { row: 4, column: 16 },
                    "msg": "duplicate parameter name",
                },
                {
                    "type": "duplication",
                    "start": { row: 6, column: 4 }, "end": { row: 6, column: 9 },
                    "msg": "duplicate block name",
                },
                {
                    "type": "duplication",
                    "start": { row: 10, column: 0 }, "end": { row: 10, column: 9 },
                    "msg": "duplicate block name",
                }
            ],
            "refs": null
        });
    });

    test("Outline (with unknown parameter)", function () {
        doc.text = `
[Kernels]
    a = 1
[]        `;
        // mdoc.assessOutline().then(value => {
        //     console.log(value);
        // });
        return expect(mdoc.assessDocument()).to.eventually.eql({
            outline: [{
                name: "Kernels",
                description: "",
                level: 1,
                start: { row: 1, column: 0 }, end: { row: 3, column: 2 },
                children: [],
                inactive: [],
                parameters: [{
                    "name": "a",
                    "description": "",
                    "start": { row: 2, column: 4 }, "end": { row: 2, column: 9 },
                    "value": "1"
                }],
            }],
            errors: [{
                "type": "dbcheck",
                "msg": "parameter name \"a\" was not found for this block in database: Kernels",
                "start": { row: 2, column: 4 }, "end": { row: 2, column: 9 },
            }],
            "refs": null
        });
    });

    test("Outline (with commented out block)", function () {
        doc.text = `
#[Kernels]
#[]
[Kernels]
[]        `;
        // mdoc.assessOutline().then(value => {
        //     console.log(value);
        // });
        return expect(mdoc.assessDocument()).to.eventually.eql({
            outline: [{
                name: "Kernels",
                description: "",
                level: 1,
                start: { row: 3, column: 0 }, end: { row: 4, column: 2 },
                children: [],
                inactive: [],
                parameters: [],
            }],
            errors: [],
            "refs": null
        });
    });

    test("Outline (with inactive blocks)", function () {
        doc.text = `
[Kernels]
    active = 'a c'
    [./a]
        type = x
    [../]
    [./b]
        type = y
    [../]
[]        `;
        // mdoc.assessOutline().then(value => {
        //     console.log(value);
        // });
        return expect(mdoc.assessDocument()).to.eventually.eql({
            outline: [{
                "name": "Kernels",
                "description": "",
                "level": 1,
                "start": { row: 1, column: 0 }, "end": { row: 9, column: 2 },
                "children": [{
                    "description": "",
                    "start": { row: 3, column: 4 }, "end": { row: 5, column: 9 },
                    "inactive": [],
                    "level": 2,
                    "name": "a",
                    "parameters": [{
                        "description": "A string representing the Moose Object that will be built by this Action\n",
                        "start": { row: 4, column: 8 }, "end": { row: 4, column: 16 },
                        "name": "type",
                        "value": "x"
                    }],
                    "children": []
                },
                {
                    "description": "",
                    "start": { row: 6, column: 4 }, "end": { row: 8, column: 9 },
                    "inactive": [],
                    "level": 2,
                    "name": "b",
                    "parameters": [{
                        "description": "A string representing the Moose Object that will be built by this Action\n",
                        "start": { row: 7, column: 8 }, "end": { row: 7, column: 16 },
                        "name": "type",
                        "value": "y"
                    }],
                    "children": []
                }],
                inactive: ["b"],
                parameters: [{
                    "description": "If specified only the blocks named will be visited and made active",
                    "start": { row: 2, column: 4 }, "end": { row: 2, column: 18 },
                    "name": "active", "value": "a c"
                }],
            }],
            errors: [{
                "type": "refcheck",
                "start": { row: 2, column: 4 }, "end": { row: 2, column: 18 },
                "msg": "subblock specified in active parameter value not found: c"
            }],
            refs: null
        });
    });

    test("References (Variables)", function () {
        doc.text = `
[Variables]
    [./a]
    [../]
[]
[ICs]
    [./a]
        value = 1
        variable = a
        type = ConstantIC
    [../]
[]`;
        // mdoc.assessOutline().then(value => {
        //     console.log(value);
        // });
        return expect(mdoc.assessDocument(true)).to.eventually.eql({
            outline: [{
                name: "Variables", description: "",
                level: 1,
                start: { row: 1, column: 0 }, end: { row: 4, column: 2 },
                children: [{
                    name: "a", description: "",
                    level: 2,
                    start: { row: 2, column: 4 }, end: { row: 3, column: 9 },
                    children: [], inactive: [], parameters: [],
                }],
                inactive: [], parameters: [],
            },
            {
                name: "ICs", description: "",
                level: 1,
                start: { row: 5, column: 0 }, end: { row: 11, column: 2 },
                children: [{
                    name: "a", description: "Sets a constant field value.",
                    level: 2,
                    start: { row: 6, column: 4 }, end: { row: 10, column: 9 },
                    children: [], inactive: [],
                    parameters: [
                        {
                            name: "value",
                            description: "The value to be set in IC\n",
                            value: "1",
                            start: { row: 7, column: 8 }, end: { row: 7, column: 17 }
                        }, {
                            name: "variable",
                            description: "The variable this initial condition is supposed to provide values for.\n",
                            value: "a",
                            start: { row: 8, column: 8 }, end: { row: 8, column: 20 }
                        }, {
                            name: "type",
                            description: "A string representing the Moose Object that will be built by this Action\n",
                            value: "ConstantIC",
                            start: { row: 9, column: 8 }, end: { row: 9, column: 25 }
                        }],
                }], inactive: [],
                parameters: [],
            }],
            errors: [],
            refs: {
                "Variables/a": {
                    "definition": {
                        "description": "",
                        "key": "Variables/a",
                        "position": { row: 2, column: 6 }
                    },
                    "refs": [{ row: 8, column: 8 }]
                }
            }
        });
    });

    test("References (Materials)", function () {
        doc.text = `
[Materials]
    [./a]
        type = DerivativeParsedMaterial
        f_name = b
        function = 1
    [../]
[]
`;
        // mdoc.assessOutline().then(value => {
        //     console.log(value);
        // });
        return expect(mdoc.assessDocument(true)).to.eventually.eql({
            outline: [{
                name: "Materials", description: "",
                level: 1,
                start: { row: 1, column: 0 }, end: { row: 7, column: 2 },
                children: [{
                    name: "a", description: "Parsed Function Material with automatic derivatives.",
                    level: 2,
                    start: { row: 2, column: 4 }, end: { row: 6, column: 9 },
                    children: [], inactive: [],
                    parameters: [{
                        name: "type",
                        description: "A string representing the Moose Object that will be built by this Action\n",
                        value: "DerivativeParsedMaterial",
                        start: { row: 3, column: 8 }, end: { row: 3, column: 39 }
                    }, {
                        name: "f_name",
                        description: "Base name of the free energy function (used to name the material properties)\n",
                        value: "b",
                        start: { row: 4, column: 8 }, end: { row: 4, column: 18 }
                    }, {
                        name: "function",
                        description: "FParser function expression for the phase free energy\n",
                        value: "1",
                        start: { row: 5, column: 8 }, end: { row: 5, column: 20 }
                    }],
                }],
                inactive: [], parameters: [],
            }],
            errors: [],
            refs: {
                "Materials/b": {
                    "definition": {
                        "description": "",
                        "key": "Materials/b",
                        "position": { row: 4, column: 17 }
                    },
                    "refs": []
                }
            }
        });
    });

    test("References (Variables and Materials)", function () {
        doc.text = `
[Variables]
    [./a]
    [../]
[]
[AuxVariables]
    [./g]
    [../]
[]
[Functions]
    [./f]
    [../]
[]
[Materials]
    [./c]
        type = DerivativeParsedMaterial
        f_name = b
        function = 1
    [../]
    [./d]
       type = DerivativeParsedMaterial
       function = 1
    [../]
    [./e]
       type = GenericConstantMaterial
       prop_names  = 'x y'
       prop_values = '0.7 0.5'
    [../]
[]
[Kernels]
    [./ACInterface]
        type = ACInterface
        variable = a
        kappa_name = b
    [../]
[]`;
        // mdoc.assessDocument(true).then(value => {
        //     console.log(value);
        // }).catch(reason => console.log(reason));
        return expect(mdoc.assessDocument(true)).to.eventually.be.an('object').with.property('refs').eql({
            "Variables/a": {
                "definition": {
                    "description": "",
                    "key": "Variables/a",
                    "position": { row: 2, column: 6 }
                },
                "refs": [{ row: 32, column: 8 }]
            },
            "AuxVariables/g": {
                "definition": {
                    "description": "",
                    "key": "AuxVariables/g",
                    "position": { row: 6, column: 6 }
                },
                "refs": []
            },
            "Functions/f": {
                "definition": {
                    "description": "",
                    "key": "Functions/f",
                    "position": { row: 10, column: 6 }
                },
                "refs": []
            },
            "Materials/b": {
                "definition": {
                    "description": "",
                    "key": "Materials/b",
                    "position": { row: 16, column: 17 }
                },
                "refs": [{ row: 33, column: 8 }]
            },
            "Materials/F": {
                "definition": {
                    "description": "",
                    "key": "Materials/F",
                    "position": { row: 19, column: 6 }
                },
                "refs": []
            },
            "Materials/x": {
                "definition": {
                    "description": "",
                    "key": "Materials/x",
                    "position": { row: 25, column: 22 }
                },
                "refs": []
            },
            "Materials/y": {
                "definition": {
                    "description": "",
                    "key": "Materials/y",
                    "position": { row: 25, column: 24 }
                },
                "refs": []
            }
        });
    });

    test("References (Materials with overriden declared properties )", function () {
        doc.text = `
[Materials]
    [./c]  # <defines: e>
        type = DerivativeParsedMaterial
        function = 1
    [../]
    [./d] # <defines: f g>
    [../]
[]
[Kernels]
    [./ACInterface]
        type = ACInterface
        kappa_name = f
    [../]
[]`;
        // mdoc.assessDocument(true).then(value => {
        //     console.log(value);
        // }).catch(reason => console.log(reason));
        return expect(mdoc.assessDocument(true)).to.eventually.be.an('object').with.property('refs').eql({
            "Materials/e": {
                "definition": {
                    "description": "",
                    "key": "Materials/e",
                    "position": { row: 2, column: 6 }
                },
                "refs": []
            },
            "Materials/f": {
                "definition": {
                    "description": "",
                    "key": "Materials/f",
                    "position": { row: 6, column: 6 }
                },
                "refs": [{ row: 12, column: 8 }]
            },
            "Materials/g": {
                "definition": {
                    "description": "",
                    "key": "Materials/g",
                    "position": { row: 6, column: 6 }
                },
                "refs": []
            }
        });
    });

    test("References (Materials sub-blocks containing material_property_names )", function () {
        doc.text = `
[Materials]
    [./c]
        type = DerivativeParsedMaterial
        f_name = a_b
        function = 1
    [../]
    [./d]
        type = DerivativeParsedMaterial
        f_name = b
        material_property_names = 'a_b a_b(x,y) da_b:=D[a_b,c] d3a_b:=D[a_b(x,y),x,x,y]'
    [../]
[]`;
        // mdoc.assessDocument(true).then(value => {
        //     console.log(value);
        // }).catch(reason => console.log(reason));
        return expect(mdoc.assessDocument(true)).to.eventually.be.an('object').with.property('refs').eql({
            "Materials/a_b": {
                "definition": {
                    "description": "",
                    "key": "Materials/a_b",
                    "position": { row: 4, column: 17 }
                },
                "refs": [
                    { "row": 10, "column": 8 },
                    { "row": 10, "column": 8 },
                    { "row": 10, "column": 8 },
                    { "row": 10, "column": 8 }
                ]
            },
            "Materials/b": {
                "definition": {
                    "description": "",
                    "key": "Materials/b",
                    "position": { row: 9, column: 17 }
                },
                "refs": []
            }
        });
    });
});