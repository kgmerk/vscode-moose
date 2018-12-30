[![Build Status](https://dev.azure.com/chrisjsewell/vscode/_apis/build/status/chrisjsewell.vscode-moose?branchName=master)](https://dev.azure.com/chrisjsewell/vscode/_build/latest?definitionId=1?branchName=master)
[![VSCode](https://img.shields.io/vscode-marketplace/v/chrisjsewell.moose.svg)](https://marketplace.visualstudio.com/items?itemName=chrisjsewell.moose)

# VSCode for MOOSE

This extension provides language support and IntelliSense for input files of MOOSE (Multiphysics Object Oriented Simulation Environment) applications.

<aside class="notice">
Note: Major API change occurred in v0.7.0
</aside>

## Features

- Syntax Highlighting
- Autocompletion
- Code-Folding
- Outline Tree
- Hover Definitions
- Format Document
- Identify Syntax Errors
- Peek/GoTo Source Files

### Auto Completion

![Auto-completion](images/auto-complete.gif)

### Introspection

![Introspection](images/introspection.gif)

### IntelliSense

VSCode for MOOSE builds a mapping of MOOSE object names to their defining source file (<NAME>.C) within the workspace.

Note that multiple folders can be added to a workspace by: `File -> Add Folder To Workspace...`.
Therefore, in order to create mappings for core MOOSE objects, the main MOOSE library folder should be added to the workspace.

Rules for inclusion/exclusion of file and folder regexes are user controllable *via* [Settings](#settings).

### Hover/Peek/GoTo Definitions

![GoTo/Peek Definitions](images/peek_definitions.gif)

The C/C++ extension is required for syntax highlighting of the C file.

Hovering over MOOSE objects attempts to retrieve the text residing in `addClassDescription`.

### Autocomplete

Autocompletion triggers:

- for Blocks is triggered after typing `[`,
- for Moose Objects is triggered after typing `type =`,

![Autocomplete](images/autocomplete.gif)

### Find/Peek All References

Looks for all references on the right side of `=` assignments,
and initialisations (as sub-blocks) in Variables/AuxVariables.

![Find/Peek All References](images/find_all_references.gif)

## Settings

Settings are configured in `Preferences -> Settings`:

| Name                         | Description                                                                                               |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------|
| `moose.exclude.workspaces`   | Specifies the workspace regexes to ignore when searching for MOOSE objects                                |
| `moose.exclude.relpaths`     | Specifies the path regexes (relative to workspaces) to ignore when searching for MOOSE objects            |
| `moose.include.modules`      | Specifies the moose module folders to search in for MOOSE Objects (`**/modules/<MODULE>/src/<TYPE>/*.C`)  |
| `moose.include.types`        | Specifies the src subfolders to search in for MOOSE Objects (`**/framework/src/<TYPE>/*.C`)               |
| `moose.include.relpaths`     | Specifies additional path regexes (relative to workspaces) to search for MOOSE Objects                    |
| `moose.object.alias`         | Name aliases of objects, i.e. set by registerMooseObjectAliased                                           |

## Commands

Accessed with `Cmnd+Shift+P`:

- `MOOSE: Reset MOOSE Objects Database`

## How to install from Marketplace

This extension is hosted at Visual Studio Marketplace

1. Upgrade to Visual Studio Code 1.15.0 or above.
2. Switch to the Extensions view by clicking the fifth icon in the left most bar.
3. Type “moose” in the search box and hit the Enter key.
4. Click “Install” button to install “MOOSE for VSCode” extension.

## Release Notes

### 0.7.0

Major API change (using syntax.yaml)

## VS Code Extension Development

To create extension:

    >>> yo code

To open MOOSE for VSCode extension:

    >>> cd /path/to/extension
    >>> code .

Use F5 to open test environment.

To publish extension:

    >>> vsce publish