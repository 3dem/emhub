import { Box } from "@mui/material";
import JsonTree from "./JsonTree";

type ProtocolMetadataPanelProps = {
  metadataSnapshot: any;
};

export default function ProtocolMetadataPanel({
  metadataSnapshot,
}: ProtocolMetadataPanelProps) {
  return (
    <Box
      sx={(theme) => ({
        height: "100%",
        maxHeight: "100%",
        overflow: "auto",
        color: "text.primary",
        scrollbarColor:
          theme.palette.mode === "dark"
            ? "rgba(148, 163, 184, 0.45) rgba(15, 23, 42, 0.55)"
            : undefined,
      })}
    >
      <JsonTree data={metadataSnapshot} />
    </Box>
  );
}
