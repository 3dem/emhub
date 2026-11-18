// src/components/viewers/TableValuesContext.ts
//
// Values chosen in a pane of the table viewer that the table depends on
// (e.g. the distances of the Coordinates Distances tomogram viewer): the
// pane sets them, and TableViewerPane loads the version of the table for
// them (TableViewerVariants.template), in place: the pane stays open.
import { createContext } from "react";

export type TableValuesSetter = (values: Record<string, number>) => void;

export const TableValuesContext = createContext<TableValuesSetter | null>(null);
