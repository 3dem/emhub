import { Fragment, useMemo, useState, type MouseEvent } from "react";
import {
    Box,
    Button,
    Checkbox,
    CircularProgress,
    IconButton,
    InputAdornment,
    Menu,
    MenuItem,
    Table,
    TableBody,
    TableCell,
    TableContainer,
    TableHead,
    TableRow,
    TextField,
    Typography,
} from "@mui/material";
import { ChevronDown, ChevronRight, MoreHorizontal, Search } from "lucide-react";

import type {
    TableViewerAction,
    TableViewerCell,
    TableViewerCellContext,
    TableViewerContext,
    TableViewerData,
    TableViewerRow,
    TableViewerPaneContent,
    TableViewerChildrenData,
    TableViewerRowChildren,
    TableViewerEdit,
    TableViewerEditAction,
} from "@/services/ProjectService";
import { MetadataViewer } from "./metadata-viewer";
import Coords3dViewer from "./coords3d-viewer";
import TiltSeriesViewer from "./tiltseries-viewer";
import CTFTomoViewer from "./ctftomo-viewer";
import VolumeViewer from "./volume-viewer";
import TableViewerGenericContentView, {
    isGenericTableViewerContent,
} from "./table-viewer-generic-content";
import { useProjectService } from "@/ProjectServiceContext";
import toast from "react-hot-toast";

type TableViewerPaneProps = {
    context: TableViewerContext;
    table: TableViewerData;
};

type ActivePane =
    | {
        kind: "metadata";
    }
    | {
        kind: "action";
        action: TableViewerAction;
        row?: TableViewerRow;
        columnId?: string;
        content: TableViewerPaneContent;
    }
    | null;

type TableViewerChildrenScope = {
    key: string;
    children: TableViewerRowChildren;
    columnId?: string;
    cellContext?: TableViewerCellContext;
};

function formatCellValue(value: TableViewerCell): string {
    if (value === null || value === undefined) return "";

    if (typeof value === "boolean") {
        return value ? "Yes" : "No";
    }

    if (typeof value === "number") {
        return Number.isInteger(value)
            ? String(value)
            : value.toLocaleString(undefined, {
                maximumFractionDigits: 4,
            });
    }

    return value;
}

export default function TableViewerPane({
    context,
    table,
}: TableViewerPaneProps) {
    const svc = useProjectService();
    const [searchValue, setSearchValue] = useState("");
    const [selectedRowId, setSelectedRowId] = useState<string | number | null>(
        null,
    );
    const [activePane, setActivePane] = useState<ActivePane>(null);

    const [draftEdits, setDraftEdits] = useState<
        Record<string, TableViewerEdit>
    >({});

    const [
        editActionBusyId,
        setEditActionBusyId,
    ] = useState<string | null>(
        null,
    );

    const draftEditList =
        useMemo(
            () =>
                Object.values(
                    draftEdits,
                ),
            [draftEdits],
        );

    const [
        expandedChildrenKeys,
        setExpandedChildrenKeys,
    ] = useState<Set<string>>(
        () => new Set(),
    );

    const [
        childrenByScopeKey,
        setChildrenByScopeKey,
    ] = useState<
        Record<string, TableViewerChildrenData>
    >({});

    const [
        childrenLoading,
        setChildrenLoading,
    ] = useState<Set<string>>(
        () => new Set(),
    );

    const [rowMenuAnchor, setRowMenuAnchor] =
        useState<HTMLElement | null>(null);
    const [rowMenuRow, setRowMenuRow] =
        useState<TableViewerRow | null>(null);

    const filteredRows = useMemo(() => {
        const query = searchValue.trim().toLowerCase();

        if (!query) {
            return table.rows;
        }

        return table.rows.filter((row) =>
            table.columns.some((column) => {
                const value = row.cells[column.id];
                return formatCellValue(value)
                    .toLowerCase()
                    .includes(query);
            }),
        );
    }, [searchValue, table.columns, table.rows]);

    const hasRowActions = useMemo(
        () =>
            table.rows.some(
                (row) =>
                    Array.isArray(row.actions) &&
                    row.actions.length > 0,
            ),
        [table.rows],
    );

    const totalRows =
        table.page?.total ??
        table.rows.length;

    const loadedStart =
        table.rows.length > 0
            ? (table.page?.offset ?? 0) + 1
            : 0;

    const loadedEnd =
        (table.page?.offset ?? 0) +
        table.rows.length;

    const buildChildrenScopeKey = (
        row: TableViewerRow,
        childrenId: string,
        columnId?: string,
    ): string => {
        return [
            String(row.id),
            columnId ?? "row",
            childrenId,
        ].join("|");
    };

    const getRowChildrenScopes = (
        row: TableViewerRow,
    ): TableViewerChildrenScope[] => {
        const scopes:
            TableViewerChildrenScope[] = [];

        if (row.children) {
            scopes.push({
                key:
                    buildChildrenScopeKey(
                        row,
                        row.children.id,
                    ),
                children:
                    row.children,
            });
        }

        for (const column of table.columns) {
            const cellContext =
                row.cellContexts?.[
                column.id
                ];

            const children =
                cellContext?.children;

            if (!children) {
                continue;
            }

            scopes.push({
                key:
                    buildChildrenScopeKey(
                        row,
                        children.id,
                        column.id,
                    ),
                children,
                columnId:
                    column.id,
                cellContext,
            });
        }

        return scopes;
    };

    const handleAction = async (
        action: TableViewerAction,
        row?: TableViewerRow,
        columnId?: string,
        cellContext?: TableViewerCellContext,
    ) => {
        if (action.disabled) return;

        if (action.id === "metadata") {
            setActivePane({
                kind: "metadata",
            });
            return;
        }

        try {
            const content =
                await svc.resolveTableViewerAction(
                    context,
                    {
                        actionId: action.id,
                        rowId: row?.id,
                        columnId,
                        rowData: row?.data,
                        cellContext: cellContext
                            ? {
                                target:
                                    cellContext.target,
                                data:
                                    cellContext.data,
                            }
                            : undefined,
                    },
                );

            setActivePane({
                kind: "action",
                action,
                row,
                columnId,
                content,
            });
        } catch (error) {
            setActivePane({
                kind: "action",
                action,
                row,
                columnId,
                content: {
                    kind: "empty",
                    message:
                        error instanceof Error
                            ? error.message
                            : "Failed to load viewer.",
                },
            });
        }
    };

    const handleEditAction = async (
        action: TableViewerEditAction,
    ) => {
        if (
            action.disabled ||
            editActionBusyId !== null
        ) {
            return;
        }

        if (
            action.requiresChanges &&
            draftEditList.length === 0
        ) {
            return;
        }

        setEditActionBusyId(
            action.id,
        );

        try {
            const result =
                await svc
                    .executeTableViewerEditAction(
                        context,
                        {
                            actionId:
                                action.id,

                            edits:
                                draftEditList,
                        },
                    );

            if (!result.success) {
                throw new Error(
                    result.message ||
                    "The action could not be completed.",
                );
            }

            if (
                result.clearEdits
            ) {
                setDraftEdits({});
            }

            toast.success(
                result.message ||
                `${action.label} completed.`,
            );
        } catch (error) {
            toast.error(
                error instanceof Error
                    ? error.message
                    : "The action failed.",
            );
        } finally {
            setEditActionBusyId(
                null,
            );
        }
    };

    const handleToggleChildren = async (
        event: MouseEvent<HTMLButtonElement>,
        row: TableViewerRow,
        children: TableViewerRowChildren,
        columnId?: string,
        cellContext?: TableViewerCellContext,
    ) => {
        event.preventDefault();
        event.stopPropagation();

        const scopeKey =
            buildChildrenScopeKey(
                row,
                children.id,
                columnId,
            );

        if (
            expandedChildrenKeys.has(
                scopeKey,
            )
        ) {
            setExpandedChildrenKeys(
                (prev) => {
                    const next =
                        new Set(prev);

                    next.delete(
                        scopeKey,
                    );

                    return next;
                },
            );

            return;
        }

        if (
            childrenByScopeKey[
            scopeKey
            ]
        ) {
            setExpandedChildrenKeys(
                (prev) => {
                    const next =
                        new Set(prev);

                    next.add(
                        scopeKey,
                    );

                    return next;
                },
            );

            return;
        }

        setChildrenLoading(
            (prev) => {
                const next =
                    new Set(prev);

                next.add(
                    scopeKey,
                );

                return next;
            },
        );

        try {
            const result =
                await svc
                    .resolveTableViewerChildren(
                        context,
                        {
                            rowId:
                                row.id,
                            childrenId:
                                children.id,
                            rowData:
                                row.data,
                            cellContext:
                                cellContext
                                    ? {
                                        target:
                                            cellContext.target,
                                        data:
                                            cellContext.data,
                                    }
                                    : undefined,
                        },
                    );

            setChildrenByScopeKey(
                (prev) => ({
                    ...prev,
                    [scopeKey]:
                        result,
                }),
            );

            setExpandedChildrenKeys(
                (prev) => {
                    const next =
                        new Set(prev);

                    next.add(
                        scopeKey,
                    );

                    return next;
                },
            );

        } catch (error) {
            toast.error(
                error instanceof Error
                    ? error.message
                    : "Failed to load table children.",
            );

        } finally {
            setChildrenLoading(
                (prev) => {
                    const next =
                        new Set(prev);

                    next.delete(
                        scopeKey,
                    );

                    return next;
                },
            );
        }
    };

    const handleRowMenuOpen = (
        event: MouseEvent<HTMLButtonElement>,
        row: TableViewerRow,
    ) => {
        event.preventDefault();
        event.stopPropagation();

        setSelectedRowId(row.id);
        setRowMenuRow(row);
        setRowMenuAnchor(event.currentTarget);
    };

    const handleRowMenuClose = () => {
        setRowMenuAnchor(null);
        setRowMenuRow(null);
    };

    const buildEditKey = (
        row: TableViewerRow,
        columnId: string,
        parentRow?: TableViewerRow,
        childrenId?: string,
    ): string => {
        return [
            parentRow
                ? String(parentRow.id)
                : "root",
            childrenId ?? "root",
            String(row.id),
            columnId,
        ].join("|");
    };

    const getOriginalBooleanValue = (
        row: TableViewerRow,
        columnId: string,
    ): boolean => {
        return Boolean(
            row.cells[columnId],
        );
    };

    const getActiveParentCascadeValue = (
        parentRow: TableViewerRow | undefined,
        childColumnId: string,
        childrenId: string | undefined,
    ): boolean | undefined => {
        if (
            !parentRow ||
            !childrenId
        ) {
            return undefined;
        }

        const cellContexts =
            parentRow.cellContexts ?? {};

        for (
            const [
                parentColumnId,
                cellContext,
            ] of Object.entries(
                cellContexts,
            )
        ) {
            const edit =
                cellContext.edit;

            if (
                edit?.type !== "boolean" ||
                !edit.cascadeToChildren
            ) {
                continue;
            }

            const cascade =
                edit.cascadeToChildren;

            if (
                cascade.childrenId !==
                childrenId
            ) {
                continue;
            }

            const targetColumnId =
                cascade.columnId ??
                parentColumnId;

            if (
                targetColumnId !==
                childColumnId
            ) {
                continue;
            }

            const parentEditKey =
                buildEditKey(
                    parentRow,
                    parentColumnId,
                );

            const parentDraftEdit =
                draftEdits[
                parentEditKey
                ];

            if (
                parentDraftEdit !==
                undefined
            ) {
                return Boolean(
                    parentDraftEdit.value,
                );
            }
        }

        return undefined;
    };

    const getEditableBooleanValue = (
        row: TableViewerRow,
        columnId: string,
        parentRow?: TableViewerRow,
        childrenId?: string,
    ): boolean => {
        const cascadeValue =
            getActiveParentCascadeValue(
                parentRow,
                columnId,
                childrenId,
            );

        if (
            cascadeValue !== undefined
        ) {
            return cascadeValue;
        }

        const editKey = buildEditKey(
            row,
            columnId,
            parentRow,
            childrenId,
        );

        const draftEdit =
            draftEdits[editKey];

        if (draftEdit) {
            return Boolean(
                draftEdit.value,
            );
        }

        return getOriginalBooleanValue(
            row,
            columnId,
        );
    };

    const isBooleanEditDisabled = (
        row: TableViewerRow,
        columnId: string,
        parentRow?: TableViewerRow,
        childrenId?: string,
    ): boolean => {
        const cellEdit =
            row.cellContexts?.[
                columnId
            ]?.edit;

        if (
            cellEdit?.disabled
        ) {
            return true;
        }

        return (
            getActiveParentCascadeValue(
                parentRow,
                columnId,
                childrenId,
            ) !== undefined
        );
    };

    const handleBooleanEdit = (
        event: MouseEvent<HTMLButtonElement>,
        row: TableViewerRow,
        columnId: string,
        parentRow?: TableViewerRow,
        childrenId?: string,
    ) => {
        event.preventDefault();
        event.stopPropagation();

        const cellEdit =
            row.cellContexts?.[
                columnId
            ]?.edit;

        if (
            cellEdit?.type !== "boolean" ||
            cellEdit.disabled
        ) {
            return;
        }

        if (
            getActiveParentCascadeValue(
                parentRow,
                columnId,
                childrenId,
            ) !== undefined
        ) {
            return;
        }

        const editKey = buildEditKey(
            row,
            columnId,
            parentRow,
            childrenId,
        );

        const originalValue =
            getOriginalBooleanValue(
                row,
                columnId,
            );

        const currentValue =
            getEditableBooleanValue(
                row,
                columnId,
                parentRow,
                childrenId,
            );

        const nextValue =
            !currentValue;

        setDraftEdits((prev) => {
            const next = {
                ...prev,
            };

            if (
                nextValue ===
                originalValue
            ) {
                delete next[
                    editKey
                ];

                return next;
            }

            next[editKey] = {
                rowId: row.id,
                columnId,
                field:
                    cellEdit.field,
                value:
                    nextValue,
                parentRowId:
                    parentRow?.id,
                childrenId,
                rowData:
                    row.data,
            };

            return next;
        });
    };

    const renderCell = (
        row: TableViewerRow,
        columnId: string,
        columnActions?: TableViewerAction[],
        parentRow?: TableViewerRow,
        childrenId?: string,
        forceEditDisabled = false,
    ) => {
        const text = formatCellValue(
            row.cells[columnId],
        );

        const cellContext =
            row.cellContexts?.[columnId];

        const cellEdit =
            cellContext?.edit;

        const cellChildren =
            cellContext?.children;

        const cellChildrenKey =
            cellChildren
                ? buildChildrenScopeKey(
                    row,
                    cellChildren.id,
                    columnId,
                )
                : null;

        const childrenToggle =
            cellChildren &&
                cellChildrenKey ? (
                <IconButton
                    size="small"
                    onClick={(event) =>
                        void handleToggleChildren(
                            event,
                            row,
                            cellChildren,
                            columnId,
                            cellContext,
                        )
                    }
                    sx={{
                        width: 20,
                        height: 20,
                        p: 0,
                        flexShrink: 0,
                        color: "#64748b",
                    }}
                >
                    {childrenLoading.has(
                        cellChildrenKey,
                    ) ? (
                        <CircularProgress
                            size={11}
                        />
                    ) : expandedChildrenKeys.has(
                        cellChildrenKey,
                    ) ? (
                        <ChevronDown
                            size={13}
                            strokeWidth={1.8}
                        />
                    ) : (
                        <ChevronRight
                            size={13}
                            strokeWidth={1.8}
                        />
                    )}
                </IconButton>
            ) : null;

        if (
            cellEdit?.type === "boolean"
        ) {
            const checked =
                getEditableBooleanValue(
                    row,
                    columnId,
                    parentRow,
                    childrenId,
                );

            return (
                <Checkbox
                    size="small"
                    checked={checked}
                    disabled={
                        forceEditDisabled ||
                        isBooleanEditDisabled(
                            row,
                            columnId,
                            parentRow,
                            childrenId,
                        )
                    }
                    onClick={(event) =>
                        handleBooleanEdit(
                            event,
                            row,
                            columnId,
                            parentRow,
                            childrenId,
                        )
                    }
                    sx={{
                        p: 0.25,
                        color: "#94a3b8",

                        "&.Mui-checked": {
                            color: "#3f7f8a",
                        },

                        "&.Mui-disabled": {
                            color: "#cbd5e1",
                        },

                        "&.Mui-disabled.Mui-checked": {
                            color: "#7aa4ab",
                        },
                    }}
                />
            );
        }

        const enabledActions = (
            cellContext?.actions ??
            columnActions ??
            []
        ).filter(
            (action) => !action.disabled,
        );

        const explicitDefaultAction =
            cellContext?.defaultAction;

        const defaultAction =
            explicitDefaultAction &&
                !explicitDefaultAction.disabled
                ? explicitDefaultAction
                : enabledActions.length === 1
                    ? enabledActions[0]
                    : undefined;

        const secondaryActions =
            defaultAction
                ? enabledActions.filter(
                    (action) =>
                        action.id !==
                        defaultAction.id,
                )
                : enabledActions;

        if (
            defaultAction &&
            text
        ) {
            return (
                <Box
                    sx={{
                        display: "flex",
                        alignItems: "center",
                        gap: 0.5,
                        minWidth: 0,
                    }}
                >
                    {childrenToggle}

                    <Button
                        variant="text"
                        size="small"
                        onClick={(event) => {
                            event.stopPropagation();

                            void handleAction(
                                defaultAction,
                                row,
                                columnId,
                                cellContext,
                            );
                        }}
                        sx={{
                            minWidth: 0,
                            p: 0,
                            justifyContent:
                                "flex-start",
                            textTransform: "none",
                            fontSize: "0.76rem",
                            fontWeight: 500,
                            color: "#334155",
                            overflow: "hidden",
                            textOverflow:
                                "ellipsis",
                            whiteSpace: "nowrap",

                            "&:hover": {
                                backgroundColor:
                                    "transparent",
                                color: "#2563eb",
                                textDecoration:
                                    "underline",
                            },
                        }}
                    >
                        {text}
                    </Button>

                    {secondaryActions.map(
                        (action) => (
                            <Button
                                key={action.id}
                                size="small"
                                variant="text"
                                onClick={(
                                    event,
                                ) => {
                                    event.stopPropagation();

                                    void handleAction(
                                        action,
                                        row,
                                        columnId,
                                        cellContext,
                                    );
                                }}
                                sx={{
                                    minWidth: 0,
                                    px: 0.5,
                                    py: 0,
                                    textTransform:
                                        "none",
                                    fontSize:
                                        "0.68rem",
                                }}
                            >
                                {action.label}
                            </Button>
                        ),
                    )}
                </Box>
            );
        }

        if (
            enabledActions.length > 0
        ) {
            return (
                <Box
                    sx={{
                        display: "flex",
                        alignItems: "center",
                        gap: 0.75,
                        minWidth: 0,
                    }}
                >
                    {childrenToggle}
                    <Typography
                        component="span"
                        sx={{
                            fontSize:
                                "0.76rem",
                            overflow:
                                "hidden",
                            textOverflow:
                                "ellipsis",
                            whiteSpace:
                                "nowrap",
                        }}
                    >
                        {text}
                    </Typography>

                    {enabledActions.map(
                        (action) => (
                            <Button
                                key={action.id}
                                size="small"
                                variant="text"
                                onClick={(
                                    event,
                                ) => {
                                    event.stopPropagation();

                                    void handleAction(
                                        action,
                                        row,
                                        columnId,
                                        cellContext,
                                    );
                                }}
                                sx={{
                                    minWidth: 0,
                                    px: 0.5,
                                    py: 0,
                                    textTransform:
                                        "none",
                                    fontSize:
                                        "0.68rem",
                                }}
                            >
                                {action.label}
                            </Button>
                        ),
                    )}
                </Box>
            );
        }

        return (
            <Box
                sx={{
                    display: "flex",
                    alignItems: "center",
                    gap: 0.5,
                    minWidth: 0,
                }}
            >
                {childrenToggle}

                <Typography
                    component="span"
                    sx={{
                        fontSize:
                            "0.76rem",
                        color:
                            "#334155",
                        overflow:
                            "hidden",
                        textOverflow:
                            "ellipsis",
                        whiteSpace:
                            "nowrap",
                    }}
                >
                    {text}
                </Typography>
            </Box>
        );
    };

    return (
        <Box
            sx={{
                display: "grid",
                gridTemplateColumns:
                    "minmax(520px, 44%) minmax(0, 1fr)",
                flex: 1,
                height: "100%",
                minHeight: 0,
                minWidth: 0,
                backgroundColor: "#f6f7fb",
            }}
        >
            {/* LEFT PANEL */}
            <Box
                sx={{
                    minWidth: 0,
                    minHeight: 0,
                    display: "flex",
                    flexDirection: "column",
                    backgroundColor: "#ffffff",
                    borderRight:
                        "1px solid #e5e7eb",
                }}
            >
                {/* Toolbar */}
                <Box
                    sx={{
                        px: 2,
                        py: 1.25,
                        minHeight: 58,
                        display: "flex",
                        alignItems: "center",
                        gap: 1.25,
                        borderBottom:
                            "1px solid #e5e7eb",
                        background:
                            "linear-gradient(180deg, #ffffff 0%, #f8faff 100%)",
                    }}
                >
                    <TextField
                        size="small"
                        value={searchValue}
                        onChange={(event) =>
                            setSearchValue(
                                event.target.value,
                            )
                        }
                        placeholder="Search..."
                        sx={{
                            width: 240,
                            "& .MuiOutlinedInput-root": {
                                height: 34,
                                borderRadius: 2,
                                backgroundColor: "#ffffff",
                                fontSize: "0.76rem",

                                "& fieldset": {
                                    borderColor: "#dbe2ea",
                                },

                                "&:hover fieldset": {
                                    borderColor: "#9fc5cc",
                                },

                                "&.Mui-focused fieldset": {
                                    borderColor: "#3f7f8a",
                                    borderWidth: 1,
                                },
                            },
                        }}
                        InputProps={{
                            startAdornment: (
                                <InputAdornment position="start">
                                    <Search
                                        size={15}
                                        strokeWidth={1.8}
                                        color="#3f7f8a"
                                    />
                                </InputAdornment>
                            ),
                        }}
                    />

                    <Typography
                        variant="caption"
                        sx={{
                            color: "#64748b",
                            fontSize: "0.7rem",
                            whiteSpace: "nowrap",
                        }}
                    >
                        {totalRows ===
                            table.rows.length
                            ? `${totalRows} items`
                            : `${table.rows.length} / ${totalRows} loaded`}
                    </Typography>

                    {draftEditList.length > 0 && (
                        <Typography
                            variant="caption"
                            sx={{
                                color: "#285e68",
                                fontSize: "0.7rem",
                                fontWeight: 700,
                                whiteSpace:
                                    "nowrap",
                            }}
                        >
                            {draftEditList.length === 1
                                ? "1 change"
                                : `${draftEditList.length} changes`}
                        </Typography>
                    )}

                    <Box
                        sx={{
                            flex: 1,
                        }}
                    />

                    {(table.actions ?? []).map(
                        (action) => (
                            <Button
                                key={action.id}
                                size="small"
                                variant="outlined"
                                disabled={action.disabled}
                                onClick={() =>
                                    handleAction(action)
                                }
                                sx={{
                                    height: 32,
                                    px: 1.25,
                                    borderRadius: 1.5,
                                    textTransform: "none",
                                    fontSize: "0.72rem",
                                    fontWeight: 600,
                                    color: "#285e68",
                                    borderColor: "#c6dde2",
                                    backgroundColor: "#edf6f7",

                                    "&:hover": {
                                        color: "#1f4f58",
                                        borderColor: "#9fc5cc",
                                        backgroundColor: "#e3f1f3",
                                    },
                                }}
                            >
                                {action.label}
                            </Button>
                        ),
                    )}

                    {draftEditList.length >
                        0 && (
                            <Button
                                size="small"
                                variant="text"
                                disabled={
                                    editActionBusyId !==
                                    null
                                }
                                onClick={() =>
                                    setDraftEdits({})
                                }
                                sx={{
                                    height: 32,
                                    px: 1,
                                    textTransform:
                                        "none",
                                    fontSize:
                                        "0.72rem",
                                    color:
                                        "#64748b",

                                    "&:hover": {
                                        backgroundColor:
                                            "#f1f5f9",
                                        color:
                                            "#334155",
                                    },
                                }}
                            >
                                Reset
                            </Button>
                        )}

                    {(
                        table.editActions ??
                        []
                    ).map(
                        (action) => {
                            const busy =
                                editActionBusyId ===
                                action.id;

                            const disabled =
                                Boolean(
                                    action.disabled,
                                ) ||
                                editActionBusyId !==
                                null ||
                                (
                                    Boolean(
                                        action.requiresChanges,
                                    ) &&
                                    draftEditList.length ===
                                    0
                                );

                            return (
                                <Button
                                    key={
                                        action.id
                                    }
                                    size="small"
                                    variant="outlined"
                                    disabled={
                                        disabled
                                    }
                                    onClick={() =>
                                        void handleEditAction(
                                            action,
                                        )
                                    }
                                    sx={{
                                        height: 32,
                                        minWidth: 72,
                                        px: 1.25,
                                        borderRadius:
                                            1.5,
                                        textTransform:
                                            "none",
                                        fontSize:
                                            "0.72rem",
                                        fontWeight:
                                            700,
                                        color:
                                            "#285e68",
                                        borderColor:
                                            "#9fc5cc",
                                        backgroundColor:
                                            "#f4fafa",

                                        "&:hover": {
                                            color:
                                                "#1f4f58",
                                            borderColor:
                                                "#6fa1aa",
                                            backgroundColor:
                                                "#e3f1f3",
                                        },
                                    }}
                                >
                                    {busy ? (
                                        <CircularProgress
                                            size={14}
                                        />
                                    ) : (
                                        action.label
                                    )}
                                </Button>
                            );
                        },
                    )}

                </Box>

                {/* Table */}
                <TableContainer
                    sx={{
                        flex: 1,
                        minHeight: 0,
                        overflow: "auto",
                    }}
                >
                    <Table
                        stickyHeader
                        size="small"
                        sx={{
                            minWidth: 620,
                            tableLayout: "fixed",
                        }}
                    >
                        <TableHead>
                            <TableRow>
                                <TableCell
                                    sx={{
                                        width: 34,
                                        px: 1,
                                        py: 1,
                                        backgroundColor: "#e8f3f5",
                                        borderBottom:
                                            "1px solid #c6dde2",
                                    }}
                                />

                                {table.columns.map(
                                    (column) => (
                                        <TableCell
                                            key={column.id}
                                            align={
                                                column.align ??
                                                "left"
                                            }
                                            sx={{
                                                width:
                                                    column.width,
                                                px: 1.25,
                                                py: 1,
                                                backgroundColor: "#e8f3f5",
                                                borderBottom: "1px solid #c6dde2",
                                                color: "#285e68",
                                                fontSize: "0.7rem",
                                                fontWeight: 700,
                                                letterSpacing: "0.01em",
                                                whiteSpace: "nowrap",
                                            }}
                                        >
                                            {column.label}
                                        </TableCell>
                                    ),
                                )}

                                {hasRowActions && (
                                    <TableCell
                                        sx={{
                                            width: 48,
                                            p: 0,
                                            backgroundColor: "#e8f3f5",
                                            borderBottom: "1px solid #c6dde2",
                                        }}
                                    />
                                )}
                            </TableRow>
                        </TableHead>

                        <TableBody>
                            {filteredRows.map(
                                (row) => {
                                    const selected =
                                        selectedRowId ===
                                        row.id;

                                    const rowChildrenKey =
                                        row.children
                                            ? buildChildrenScopeKey(
                                                row,
                                                row.children.id,
                                            )
                                            : null;

                                    const expandedScopes =
                                        getRowChildrenScopes(
                                            row,
                                        ).filter(
                                            (scope) =>
                                                expandedChildrenKeys.has(
                                                    scope.key,
                                                ) &&
                                                Boolean(
                                                    childrenByScopeKey[
                                                    scope.key
                                                    ],
                                                ),
                                        );

                                    return (
                                        <Fragment key={String(row.id)}>
                                            <TableRow
                                                hover
                                                selected={
                                                    selected
                                                }
                                                onClick={() => {
                                                    setSelectedRowId(
                                                        row.id,
                                                    );

                                                    if (row.defaultAction) {
                                                        void handleAction(
                                                            row.defaultAction,
                                                            row,
                                                        );
                                                    }
                                                }}
                                                sx={{
                                                    cursor:
                                                        "pointer",
                                                    height: 42,

                                                    "& td": {
                                                        backgroundColor:
                                                            selected
                                                                ? "#eef7f8"
                                                                : "#ffffff",
                                                        borderBottom:
                                                            "1px solid #f1f5f9",
                                                    },

                                                    "&:hover td": {
                                                        backgroundColor:
                                                            selected
                                                                ? "#e3f1f3"
                                                                : "#f8fafc",
                                                    },

                                                    ...(selected
                                                        ? {
                                                            "& td:first-of-type":
                                                            {
                                                                boxShadow:
                                                                    "inset 3px 0 0 #3f7f8a",
                                                            },
                                                        }
                                                        : {}),
                                                }}
                                            >
                                                <TableCell
                                                    sx={{
                                                        px: 1,
                                                        py: 0.75,
                                                        textAlign:
                                                            "center",
                                                    }}
                                                >
                                                    {row.children &&
                                                        rowChildrenKey ? (
                                                        <IconButton
                                                            size="small"
                                                            onClick={(event) =>
                                                                void handleToggleChildren(
                                                                    event,
                                                                    row,
                                                                    row.children!,
                                                                )
                                                            }
                                                            sx={{
                                                                width: 24,
                                                                height: 24,
                                                                p: 0,
                                                            }}
                                                        >
                                                            {childrenLoading.has(
                                                                rowChildrenKey,
                                                            ) ? (
                                                                <CircularProgress
                                                                    size={12}
                                                                />
                                                            ) : expandedChildrenKeys.has(
                                                                rowChildrenKey,
                                                            ) ? (
                                                                <ChevronDown
                                                                    size={14}
                                                                    strokeWidth={1.8}
                                                                />
                                                            ) : (
                                                                <ChevronRight
                                                                    size={14}
                                                                    strokeWidth={1.8}
                                                                />
                                                            )}
                                                        </IconButton>
                                                    ) : (
                                                        <Box sx={{ width: 14, height: 14 }} />
                                                    )}
                                                </TableCell>

                                                {table.columns.map(
                                                    (column) => (
                                                        <TableCell
                                                            key={
                                                                column.id
                                                            }
                                                            align={
                                                                column.align ??
                                                                "left"
                                                            }
                                                            sx={{
                                                                px: 1.25,
                                                                py: 0.75,
                                                                minWidth: 0,
                                                                overflow:
                                                                    "hidden",
                                                            }}
                                                        >
                                                            {renderCell(
                                                                row,
                                                                column.id,
                                                                column.actions,
                                                            )}
                                                        </TableCell>
                                                    ),
                                                )}

                                                {hasRowActions && (
                                                    <TableCell
                                                        align="center"
                                                        sx={{
                                                            p: 0.5,
                                                        }}
                                                    >
                                                        {row.actions
                                                            ?.length ? (
                                                            <IconButton
                                                                size="small"
                                                                onClick={(
                                                                    event,
                                                                ) =>
                                                                    handleRowMenuOpen(
                                                                        event,
                                                                        row,
                                                                    )
                                                                }
                                                                sx={{
                                                                    color:
                                                                        "#64748b",
                                                                    "&:hover":
                                                                    {
                                                                        backgroundColor:
                                                                            "#eef2f7",
                                                                        color:
                                                                            "#0f172a",
                                                                    },
                                                                }}
                                                            >
                                                                <MoreHorizontal
                                                                    size={
                                                                        16
                                                                    }
                                                                />
                                                            </IconButton>
                                                        ) : null}
                                                    </TableCell>
                                                )}
                                            </TableRow>
                                            {
                                                expandedScopes.map(
                                                    (scope) => {
                                                        const childrenData =
                                                            childrenByScopeKey[
                                                            scope.key
                                                            ];

                                                        return (
                                                            <TableRow
                                                                key={
                                                                    `children-${scope.key}`
                                                                }
                                                            >
                                                                <TableCell
                                                                    colSpan={
                                                                        table.columns.length +
                                                                        1 +
                                                                        (hasRowActions
                                                                            ? 1
                                                                            : 0)
                                                                    }
                                                                    sx={{
                                                                        p: 0,
                                                                        backgroundColor:
                                                                            "#f8fafc",
                                                                        borderBottom:
                                                                            "1px solid #e2e8f0",
                                                                    }}
                                                                >
                                                                    <Box
                                                                        sx={{
                                                                            ml: 4,
                                                                            mr: 1,
                                                                            my: 1,
                                                                            border:
                                                                                "1px solid #e2e8f0",
                                                                            borderRadius:
                                                                                1.5,
                                                                            overflow:
                                                                                "hidden",
                                                                            backgroundColor:
                                                                                "#ffffff",
                                                                        }}
                                                                    >
                                                                        {childrenData.title && (
                                                                            <Box
                                                                                sx={{
                                                                                    px: 1.5,
                                                                                    py: 0.75,
                                                                                    borderBottom:
                                                                                        "1px solid #d4e5e8",
                                                                                    background:
                                                                                        "linear-gradient(90deg, #f1f7f8 0%, #eaf4f5 100%)",
                                                                                }}
                                                                            >
                                                                                <Typography
                                                                                    sx={{
                                                                                        fontSize:
                                                                                            "0.72rem",
                                                                                        fontWeight:
                                                                                            700,
                                                                                        color:
                                                                                            "#285e68",
                                                                                    }}
                                                                                >
                                                                                    {
                                                                                        childrenData.title
                                                                                    }
                                                                                </Typography>
                                                                            </Box>
                                                                        )}

                                                                        <Table
                                                                            size="small"
                                                                            sx={{
                                                                                tableLayout:
                                                                                    "fixed",
                                                                                width:
                                                                                    "100%",
                                                                            }}
                                                                        >
                                                                            <TableHead>
                                                                                <TableRow>
                                                                                    {childrenData.columns.map(
                                                                                        (
                                                                                            column,
                                                                                        ) => (
                                                                                            <TableCell
                                                                                                key={
                                                                                                    column.id
                                                                                                }
                                                                                                align={
                                                                                                    column.align ??
                                                                                                    "left"
                                                                                                }
                                                                                                sx={{
                                                                                                    width:
                                                                                                        column.width,
                                                                                                    px: 1,
                                                                                                    py: 0.65,
                                                                                                    backgroundColor:
                                                                                                        "#f1f7f8",
                                                                                                    color:
                                                                                                        "#356b75",
                                                                                                    borderBottom:
                                                                                                        "1px solid #d4e5e8",
                                                                                                    fontSize:
                                                                                                        "0.67rem",
                                                                                                    fontWeight:
                                                                                                        700,
                                                                                                    letterSpacing:
                                                                                                        "0.01em",
                                                                                                    whiteSpace:
                                                                                                        "nowrap",
                                                                                                }}
                                                                                            >
                                                                                                {
                                                                                                    column.label
                                                                                                }
                                                                                            </TableCell>
                                                                                        ),
                                                                                    )}
                                                                                </TableRow>
                                                                            </TableHead>

                                                                            <TableBody>
                                                                                {childrenData.rows.map(
                                                                                    (
                                                                                        childRow,
                                                                                    ) => {
                                                                                        const childSelected =
                                                                                            selectedRowId ===
                                                                                            childRow.id;

                                                                                        return (
                                                                                            <TableRow
                                                                                                key={String(
                                                                                                    childRow.id,
                                                                                                )}
                                                                                                hover
                                                                                                selected={
                                                                                                    childSelected
                                                                                                }
                                                                                                onClick={() => {
                                                                                                    setSelectedRowId(
                                                                                                        childRow.id,
                                                                                                    );

                                                                                                    if (
                                                                                                        childRow.defaultAction
                                                                                                    ) {
                                                                                                        void handleAction(
                                                                                                            childRow.defaultAction,
                                                                                                            childRow,
                                                                                                            scope.columnId,
                                                                                                            scope.cellContext,
                                                                                                        );
                                                                                                    }
                                                                                                }}
                                                                                                sx={{
                                                                                                    cursor:
                                                                                                        "pointer",
                                                                                                    height: 34,

                                                                                                    "& td":
                                                                                                    {
                                                                                                        borderBottom:
                                                                                                            "1px solid #f1f5f9",
                                                                                                    },
                                                                                                }}
                                                                                            >
                                                                                                {childrenData.columns.map(
                                                                                                    (
                                                                                                        column,
                                                                                                    ) => (
                                                                                                        <TableCell
                                                                                                            key={
                                                                                                                column.id
                                                                                                            }
                                                                                                            align={
                                                                                                                column.align ??
                                                                                                                "left"
                                                                                                            }
                                                                                                            sx={{
                                                                                                                px: 1,
                                                                                                                py: 0.5,
                                                                                                                minWidth: 0,
                                                                                                                overflow:
                                                                                                                    "hidden",
                                                                                                            }}
                                                                                                        >
                                                                                                            {renderCell(
                                                                                                                childRow,
                                                                                                                column.id,
                                                                                                                column.actions,
                                                                                                                row,
                                                                                                                scope.children.id,
                                                                                                                scope.children.readOnly ===
                                                                                                                true,
                                                                                                            )}
                                                                                                        </TableCell>
                                                                                                    ),
                                                                                                )}
                                                                                            </TableRow>
                                                                                        );
                                                                                    },
                                                                                )}
                                                                            </TableBody>
                                                                        </Table>
                                                                    </Box>
                                                                </TableCell>
                                                            </TableRow>
                                                        );
                                                    },
                                                )
                                            }

                                        </Fragment>
                                    );
                                },
                            )}

                            {filteredRows.length ===
                                0 && (
                                    <TableRow>
                                        <TableCell
                                            colSpan={
                                                table.columns
                                                    .length +
                                                1 +
                                                (hasRowActions
                                                    ? 1
                                                    : 0)
                                            }
                                            sx={{
                                                py: 6,
                                                textAlign:
                                                    "center",
                                                borderBottom:
                                                    "none",
                                            }}
                                        >
                                            <Typography
                                                variant="body2"
                                                sx={{
                                                    color:
                                                        "#94a3b8",
                                                    fontSize:
                                                        "0.78rem",
                                                }}
                                            >
                                                No rows match
                                                the current
                                                search.
                                            </Typography>
                                        </TableCell>
                                    </TableRow>
                                )}
                        </TableBody>
                    </Table>
                </TableContainer>

                {/* Footer */}
                <Box
                    sx={{
                        minHeight: 42,
                        px: 2,
                        display: "flex",
                        alignItems: "center",
                        justifyContent:
                            "space-between",
                        gap: 2,
                        borderTop:
                            "1px solid #e5e7eb",
                        backgroundColor:
                            "#ffffff",
                    }}
                >
                    <Typography
                        variant="caption"
                        sx={{
                            color: "#64748b",
                            fontSize: "0.68rem",
                        }}
                    >
                        {searchValue.trim()
                            ? `${filteredRows.length} matches in loaded rows`
                            : `${loadedStart}–${loadedEnd} of ${totalRows}`}
                    </Typography>

                    {selectedRowId !==
                        null && (
                            <Typography
                                variant="caption"
                                sx={{
                                    color: "#64748b",
                                    fontSize:
                                        "0.68rem",
                                }}
                            >
                                Selected:{" "}
                                <strong>
                                    {String(
                                        selectedRowId,
                                    )}
                                </strong>
                            </Typography>
                        )}
                </Box>
            </Box>

            {/* RIGHT PANEL */}
            <Box
                sx={{
                    minWidth: 0,
                    minHeight: 0,
                    display: "flex",
                    flexDirection: "column",
                    backgroundColor: "#f8fafc",
                }}
            >
                <Box
                    sx={{
                        minHeight: 58,
                        px: 2,
                        display: "flex",
                        alignItems: "center",
                        gap: 1,
                        borderBottom:
                            "1px solid #dbe2ea",
                        background:
                            "linear-gradient(90deg, #f8fafc 0%, #ffffff 100%)",
                        boxShadow:
                            "inset 3px 0 0 #3f7f8a",
                    }}
                >
                    <Typography
                        sx={{
                            fontSize: "0.78rem",
                            fontWeight: 700,
                            color: "#334155",
                        }}
                    >
                        {activePane?.kind === "metadata"
                            ? "Metadata"
                            : activePane?.kind === "action"
                                ? activePane.content.title ?? activePane.action.label
                                : "Viewer"}
                    </Typography>

                </Box>

                <Box
                    sx={{
                        flex: 1,
                        minHeight: 0,
                        minWidth: 0,
                        overflow: "hidden",
                        p:
                            activePane?.kind === "metadata"
                                ? 1
                                : activePane?.kind === "action"
                                    ? 0
                                    : 2,
                    }}
                >
                    {activePane?.kind ===
                        "metadata" ? (
                        <MetadataViewer
                            projectId={Number(
                                context.projectId,
                            )}
                            protocolId={Number(
                                context.protocolId,
                            )}
                            outputName={
                                context.outputName
                            }
                            embedded
                        />
                    ) : activePane?.kind === "action" ? (
                        activePane.content.kind === "coords3d" ? (
                            <Coords3dViewer
                                projectId={
                                    activePane.content.projectId
                                }
                                protocolId={
                                    activePane.content.protocolId
                                }
                                outputName={
                                    activePane.content.outputName
                                }
                                selectedTomogramId={
                                    activePane.content.tomogramId
                                }
                                hideMetadataAction
                                hideTomogramList
                            />
                        ) : activePane.content.kind === "tiltSeries" ? (
                            <TiltSeriesViewer
                                projectId={
                                    activePane.content.projectId
                                }
                                protocolId={
                                    activePane.content.protocolId
                                }
                                outputName={
                                    activePane.content.outputName
                                }
                                selectedTiltSeriesId={
                                    activePane.content.tiltSeriesId
                                }
                                selectedTiltImageIndex={
                                    activePane.content.frameIndex
                                }
                                hideSeriesTable
                                hideMetadataAction
                            />
                        ) : activePane.content.kind === "ctfTomo" ? (
                            <CTFTomoViewer
                                projectId={
                                    activePane.content.projectId
                                }
                                protocolId={
                                    activePane.content.protocolId
                                }
                                outputName={
                                    activePane.content.outputName
                                }
                                selectedCtfSeriesId={
                                    activePane.content.ctfSeriesId
                                }
                                selectedViewId={
                                    activePane.content.viewId
                                }
                                hideSeriesTable
                                hideMetadataAction
                                readOnly
                            />
                        ) : activePane.content.kind === "volume" ? (
                            <VolumeViewer
                                projectId={
                                    activePane.content.projectId
                                }
                                protocolId={
                                    activePane.content.protocolId
                                }
                                outputName={
                                    activePane.content.outputName
                                }
                                selectedVolumeId={
                                    activePane.content.volumeId
                                }
                                hideVolumeList
                                hideMetadataAction
                            />
                        ) : isGenericTableViewerContent(activePane.content) ? (
                            <TableViewerGenericContentView
                                content={activePane.content}
                            />
                        ) : (
                            <Box
                                sx={{
                                    height: "100%",
                                    display: "flex",
                                    alignItems: "center",
                                    justifyContent: "center",
                                    px: 3,
                                }}
                            >
                                <Typography
                                    variant="body2"
                                    sx={{
                                        color: "#94a3b8",
                                        textAlign: "center",
                                    }}
                                >
                                    {activePane.content.message ??
                                        "No viewer content available."}
                                </Typography>
                            </Box>
                        )
                    ) : (
                        <Box
                            sx={{
                                height: "100%",
                                display: "flex",
                                alignItems:
                                    "center",
                                justifyContent:
                                    "center",
                            }}
                        >
                            <Box
                                sx={{
                                    maxWidth: 360,
                                    textAlign:
                                        "center",
                                }}
                            >
                                <Typography
                                    sx={{
                                        fontSize:
                                            "0.85rem",
                                        fontWeight:
                                            600,
                                        color:
                                            "#475569",
                                        mb: 0.5,
                                    }}
                                >
                                    Select an item or
                                    action
                                </Typography>

                                <Typography
                                    variant="caption"
                                    sx={{
                                        color:
                                            "#94a3b8",
                                        lineHeight:
                                            1.6,
                                    }}
                                >
                                    Row and column
                                    actions can open
                                    contextual viewers
                                    here without
                                    leaving the table.
                                </Typography>
                            </Box>
                        </Box>
                    )}
                </Box>
            </Box>

            <Menu
                anchorEl={rowMenuAnchor}
                open={Boolean(
                    rowMenuAnchor,
                )}
                onClose={
                    handleRowMenuClose
                }
                PaperProps={{
                    sx: {
                        minWidth: 170,
                        border:
                            "1px solid #e2e8f0",
                        boxShadow:
                            "0 10px 25px rgba(15,23,42,0.12)",
                    },
                }}
            >
                {(rowMenuRow?.actions ??
                    []).map((action) => (
                        <MenuItem
                            key={action.id}
                            disabled={
                                action.disabled
                            }
                            onClick={() => {
                                if (rowMenuRow) {
                                    handleAction(
                                        action,
                                        rowMenuRow,
                                    );
                                }

                                handleRowMenuClose();
                            }}
                            sx={{
                                fontSize: "0.76rem",
                                minHeight: 34,
                            }}
                        >
                            {action.label}
                        </MenuItem>
                    ))}
            </Menu>
        </Box >
    );
}