// src/types/metadata.ts
// Metadata table shapes exchanged with the host ProjectService
// (originally declared next to the ScipionAPI HTTP client in ScipionWeb).

// Metadata tables list
export interface MetadataTableInfo {
  name: string;
  alias: string;
  rowCount: number;
  hasColumnId: boolean;
}

// Columns schema
export type MetadataRendererType =
  | "int"
  | "float"
  | "bool"
  | "matrix"
  | "image"
  | "str";

export interface MetadataColumn {
  name: string;
  alias: string;
  index: number;
  sortable: boolean;
  visible: boolean;
  rendererType: MetadataRendererType;
  decimals: number | null;
  hasTransformation: boolean;
}

export interface MetadataTableSchema {
  name: string;
  alias: string;
  hasColumnId: boolean;
  columns: MetadataColumn[];

  /** Optional actions advertised by the backend for this table. */
  actions?: string[];

  /** Optional column names advertised by the backend as gallery metadata. */
  additionalInfoColumns?: string[];
}

// Cells and rows
export type MetadataCell =
  | number
  | string
  | boolean
  | {
    kind: "image";
    path: string;
  }
  | {
    kind: "matrix";
    value: any;
  };

export interface MetadataRow {
  id: number;
  values: MetadataCell[];
}
