# VSCode for MOOSE

This extension provides language support for input files of MOOSE (Multiphysics Object Oriented Simulation Environment) applications.

![Example Workspace](images/example_workspace.png)

Github Repo: https://github.com/chrisjsewell/vscode-moose

## Features

- Syntax Highlighting
- Input Block Folding
- Input Blocks Outline View
- Find/Peek All References to Variables
- Hover/Peek/GoTo Definitions of MOOSE Objects
- Autocomplete block names and MOOSE Objects
- Main/Sub-Block snippets

### Find/Peek All References

Looks for all references on the right side of `=` assignments,
and initialisations (as sub-blocks) in Variables/AuxVariables.

![Find/Peek All References](images/find_all_references.gif)

### Hover/Peek/GoTo Definitions

Attempts to find a file in the current workspace, matching the regex: `**/src/**/{ObjectName}.C`,
and ignoring specified folders.

![GoTo/Peek Definitions](images/peek_definitions.gif)

Note that multiple folders can be added to a workspace by: `File -> Add Folder To Workspace...`.
In this manner, you can find definitions from both your working/app folder and the main MOOSE library.

Hovering over MOOSE objects attempts to retrieve the text residing in `addClassDescription`.

Ignored folder regexes can be configured : `moose.definitions.ignore` (See Settings).

The C/C++ extension is used for syntax highlighting of the C file.

### Autocomplete

Autocompletion triggers:

- for Blocks is triggered after typing `[`,
- for Moose Objects is triggered after typing `type =`,

![Autocomplete](images/autocomplete.gif)

See Settings for controlling where MOOSE Objects are searched for.

## Settings

Settings are configured in `Preferences -> Settings`:

| Name                         | Description                                                                                                          |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `moose.definitions.ignore`   | Specifies the folder regexes to ignore when searching for MOOSE object                                               |
| `moose.autocomplete.modules` | Specifies the moose module folders to search in for autocomplete MOOSE Objects (`**/modules/<MODULE>/src/<TYPE>/*.C`)|
| `moose.autocomplete.types`   | Specifies the src subfolders to search in for autocomplete MOOSE Objects (`**/framework/src/<TYPE>/*.C`)             |
| `moose.autocomplete.other`   | Specifies other regexes to search in for autocomplete MOOSE Objects                                                  |

## How to install from Marketplace

This extension is hosted at Visual Studio Marketplace

1. Upgrade to Visual Studio Code 1.15.0 or above.
2. Switch to the Extensions view by clicking the fifth icon in the left most bar.
3. Type “moose” in the search box and hit the Enter key.
4. Click “Install” button to install “MOOSE for VSCode” extension.

## Release Notes

### 0.0.1

Initial release, including syntax colouring, code folding and outline view

### 0.0.2

Fixed bug for Sub-Block names containing _

### 0.1.0

Added Autocomplete block names, Find/Peek All References to Variables, and Main/Sub-Block snippets

### 0.2.0

Added syntax colouring of moose objects and 'Go To'/'Peek' Definitions

### 0.3.0

Added MOOSE object autocompletion

### 0.4.0

Added MOOSE object hovering

### 0.5.0

Added MOOSE descriptions in autocomplete and auto-update of MOOSE objects