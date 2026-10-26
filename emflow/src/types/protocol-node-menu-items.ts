// NodeMenuItemIds.ts (or inside ProtocolNodeCard.tsx)
// Keep ids stable to avoid breaking callers.
export type NodeMenuItemId =
  | "open"
  | "browse"
  | "rename"
  | "duplicate"
  | "copyWorkflow"
  | "pasteWorkflow"
  | "delete"
  | "restart"
  | "continue"
  | "reset"
  | "stop"
  | "selectFrom"
  | "selectTo"
  | "manageTags"
  | "export"
  | "upload"
  | "nextSteps";

export type NodeMenuVisibility = Partial<Record<NodeMenuItemId, boolean>>;