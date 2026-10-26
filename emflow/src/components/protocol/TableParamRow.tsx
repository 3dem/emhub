import { useMemo } from "react";
import {
  Box,
  IconButton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Tooltip,
} from "@mui/material";
import { PlusIcon, TrashBinIcon } from "../../icons";
import {
  buildEmptyTableRow,
  getTableColumns,
  type TableColumnDef,
  validateTableCellValue,
} from "@/utils/protocolform.utils";

type TableParamRowProps = {
  def: any;
  rows: Record<string, any>[];
  cellErrors?: Record<string, string>;
  onCellChange: (rowIndex: number, colName: string, value: string) => void;
  onAddRow: () => void;
  onRemoveRow: (rowIndex: number) => void;
};

function cellInputType(paramClass: string): "text" | "number" {
  const cls = String(paramClass ?? "");
  if (cls === "IntParam" || cls === "FloatParam") return "number";
  return "text";
}

function cellInputStep(paramClass: string): string | undefined {
  const cls = String(paramClass ?? "");
  if (cls === "IntParam") return "1";
  if (cls === "FloatParam") return "any";
  return undefined;
}

export default function TableParamRow({
  def,
  rows,
  cellErrors = {},
  onCellChange,
  onAddRow,
  onRemoveRow,
}: TableParamRowProps) {
  const columns = useMemo(() => getTableColumns(def), [def]);

  const displayRows = useMemo(() => {
    const list = Array.isArray(rows) ? [...rows] : [];
    if (list.length === 0) {
      list.push(buildEmptyTableRow(columns));
    }
    return list;
  }, [rows, columns]);

  if (columns.length === 0) {
    return (
      <Box sx={{ fontSize: 12, opacity: 0.7, py: 1 }}>
        Table parameter has no column definitions.
      </Box>
    );
  }

  const cellTextFieldSx = {
    "& .MuiInputBase-root": {
      fontSize: 12,
      height: 30,
      backgroundColor: "transparent",
    },
    "& .MuiInputBase-input": {
      fontSize: 12,
      py: 0,
      px: 0.5,
      lineHeight: 1.2,
      color: "text.primary",
    },
  } as const;

  const renderCell = (row: Record<string, any>, rowIndex: number, col: TableColumnDef) => {
    const errorKey = `${rowIndex}.${col.name}`;
    const error = cellErrors[errorKey] ?? validateTableCellValue(row?.[col.name], col) ?? undefined;

    return (
      <TextField
        variant="standard"
        type={cellInputType(col.paramClass)}
        inputProps={{ step: cellInputStep(col.paramClass) }}
        value={String(row?.[col.name] ?? "")}
        onChange={(e) => onCellChange(rowIndex, col.name, e.target.value)}
        error={Boolean(error)}
        helperText={error ?? " "}
        FormHelperTextProps={{ sx: { fontSize: 10, m: 0, minHeight: 14 } }}
        InputProps={{ disableUnderline: false }}
        sx={cellTextFieldSx}
        fullWidth
      />
    );
  };

  return (
    <Box sx={{ mb: 2, ml: -2, width: "100%" }}>
      <Box
        sx={(theme) => ({
          maxHeight: 360,
          width: "100%",
          maxWidth: 1040,
          overflow: "auto",
          borderRadius: 1,
          border: "1px dashed",
          borderColor: theme.palette.mode === "dark" ? "rgba(148, 163, 184, 0.34)" : "#bbb",
          backgroundColor: theme.palette.mode === "dark" ? "rgba(15, 23, 42, 0.42)" : "white",
          mt: 2,
        })}
      >
        <Table
          size="small"
          stickyHeader
          sx={(theme) => ({
            tableLayout: "auto",
            width: "100%",
            borderCollapse: "collapse",
            fontSize: 12,
            "& .MuiTableCell-root": {
              borderBottom: "1px dashed",
              borderColor: theme.palette.mode === "dark" ? "rgba(148, 163, 184, 0.24)" : "#ccc",
              padding: "6px 10px",
              fontSize: 12,
              color: "text.primary",
              verticalAlign: "top",
            },
            "& .MuiTableHead-root .MuiTableCell-root": {
              backgroundColor: theme.palette.mode === "dark" ? "rgba(30, 41, 59, 0.98)" : "#e0e0e0",
              color: theme.palette.mode === "dark" ? "#e5e7eb" : "#111827",
            },
          })}
        >
          <TableHead>
            <TableRow>
              {columns.map((col) => (
                <TableCell key={col.name} sx={{ fontWeight: "bold", whiteSpace: "nowrap" }}>
                  {col.label}
                </TableCell>
              ))}
              <TableCell sx={{ width: 72, fontWeight: "bold", textAlign: "center" }}>
                Actions
              </TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {displayRows.map((row, rowIndex) => (
              <TableRow key={rowIndex}>
                {columns.map((col) => (
                  <TableCell key={`${rowIndex}-${col.name}`}>{renderCell(row, rowIndex, col)}</TableCell>
                ))}
                <TableCell sx={{ textAlign: "center", verticalAlign: "middle" }}>
                  <Tooltip title="Remove row">
                    <IconButton
                      size="small"
                      onClick={() => onRemoveRow(rowIndex)}
                      sx={{ color: "text.secondary", "&:hover": { color: "text.primary" } }}
                    >
                      <TrashBinIcon fontSize="1.1rem" />
                    </IconButton>
                  </Tooltip>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Box>

      <Box sx={{ mt: 1 }}>
        <Tooltip title="Add row">
          <IconButton size="small" onClick={onAddRow} sx={{ color: "text.secondary" }}>
            <PlusIcon fontSize="1.1rem" />
          </IconButton>
        </Tooltip>
      </Box>
    </Box>
  );
}
