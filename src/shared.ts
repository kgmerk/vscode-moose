/**
 * position within a document
 */
export interface Position {
    row: number;
    column: number;
}

/** an interface to describe what an object references */
export interface Definition {
    key: string; // key of the reference e.g. <mainBlock>/<name>
    position: Position; // position in the document
    description: string;
    type?: string; // type of the variable (used for materials)
    file?: string; // file path (if undefined then in same document as value)
}
