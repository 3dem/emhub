import { Divider, Menu, MenuItem } from "@mui/material";

/** "to"/"from" ranges include the clicked row; rows are taken in the order
 * shown (after search and sort). */
export type TableViewerSelectionCommand =
    | "select-all"
    | "select-to"
    | "select-from"
    | "deselect-all"
    | "deselect-to"
    | "deselect-from"
    | "invert";

const SELECTION_MENU_GROUPS: {
    command: TableViewerSelectionCommand;
    label: string;
}[][] = [
    [
        { command: "select-all", label: "Select All" },
        { command: "select-to", label: "Select to Here" },
        { command: "select-from", label: "Select from Here" },
    ],
    [
        { command: "deselect-all", label: "Deselect All" },
        { command: "deselect-to", label: "Deselect to Here" },
        { command: "deselect-from", label: "Deselect from Here" },
    ],
    [{ command: "invert", label: "Invert Selection" }],
];

type TableViewerSelectionMenuProps = {
    /** Mouse position of the right-click, null when closed. */
    anchorPosition: { top: number; left: number } | null;
    onClose: () => void;
    onCommand: (command: TableViewerSelectionCommand) => void;
};

/** Context menu of a row (right-click) to change the selection column. */
export function TableViewerSelectionMenu({
    anchorPosition,
    onClose,
    onCommand,
}: TableViewerSelectionMenuProps) {
    return (
        <Menu
            open={anchorPosition !== null}
            onClose={onClose}
            anchorReference="anchorPosition"
            anchorPosition={anchorPosition ?? undefined}
            onContextMenu={(event) => {
                // A right-click outside closes the menu, not the browser one
                event.preventDefault();
                onClose();
            }}
            PaperProps={{
                sx: {
                    minWidth: 180,
                    border: "1px solid #e2e8f0",
                    boxShadow: "0 10px 25px rgba(15,23,42,0.12)",
                },
            }}
        >
            {/* Menu takes no Fragments, so the items and dividers go flat */}
            {SELECTION_MENU_GROUPS.flatMap((group, index) => [
                ...(index > 0
                    ? [<Divider key={`divider-${index}`} sx={{ my: 0.5 }} />]
                    : []),
                ...group.map(({ command, label }) => (
                    <MenuItem
                        key={command}
                        onClick={() => {
                            onCommand(command);
                            onClose();
                        }}
                        sx={{ fontSize: "0.76rem", minHeight: 30 }}
                    >
                        {label}
                    </MenuItem>
                )),
            ])}
        </Menu>
    );
}
