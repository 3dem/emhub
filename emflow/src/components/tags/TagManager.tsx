// src/components/tags/TagManager.tsx
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import toast from "react-hot-toast";
import {
    Box,
    Button,
    CircularProgress,
    Dialog,
    DialogActions,
    DialogContent,
    DialogTitle,
    IconButton,
    TextField,
    Tooltip,
    Typography,
} from "@mui/material";

import { TrashBinIcon, HelpIcon, CloseIcon } from "../../icons";
import type { ProtocolTag } from "./tagTypes";
import { useTagStore } from "@/stores/tag_store";
import { useProjectService } from "@/ProjectServiceContext";
import { useTheme as useAppTheme } from "@/context/ThemeContext";
import type { Id, ProtocolTag as ServiceProtocolTag } from "@/services/ProjectService";

type TagManagerProps = {
    title?: string;
    projectId?: Id;
    open?: boolean;
    tags?: ProtocolTag[];
    onTagsChange?: (next: ProtocolTag[]) => void;
    initialTags?: ProtocolTag[];
};

type TagDraft = {
    id?: string;
    title: string;
    description: string;
    color: string;
};

type TagEditorDialogProps = {
    open: boolean;
    mode: "create" | "edit";
    draft: TagDraft;
    onChange: (patch: Partial<TagDraft>) => void;
    onClose: () => void;
    onSave: () => void | Promise<void>;
    isSaving?: boolean;
    validationError?: string | null;
};

type TagThemeMode = "light" | "dark";

type TagPalette = {
    panel: string;
    panelSubtle: string;
    row: string;
    rowHover: string;
    header: string;
    border: string;
    borderSoft: string;
    text: string;
    textStrong: string;
    textMuted: string;
    inputBg: string;
    inputFocus: string;
    inputHoverBorder: string;
    blue: string;
    blueHover: string;
    green: string;
    greenHover: string;
    red: string;
    dangerHover: string;
    shadow: string;
    dialogShadow: string;
    backdrop: string;
};

const defaultTagColors = [
    "#ef4444",
    "#f97316",
    "#f59e0b",
    "#84cc16",
    "#22c55e",
    "#06b6d4",
    "#3b82f6",
    "#6366f1",
    "#a855f7",
    "#ec4899",
    "#64748b",
    "#111827",
] as const;

function getTagPalette(mode: TagThemeMode): TagPalette {
    if (mode === "dark") {
        return {
            panel: "#0f172a",
            panelSubtle: "rgba(15,23,42,0.98)",
            row: "rgba(15,23,42,0.88)",
            rowHover: "rgba(30,41,59,0.88)",
            header: "#333d49",
            border: "rgba(148,163,184,0.32)",
            borderSoft: "rgba(148,163,184,0.22)",
            text: "#e5e7eb",
            textStrong: "#f8fafc",
            textMuted: "#94a3b8",
            inputBg: "rgba(15,23,42,0.92)",
            inputFocus: "#38bdf8",
            inputHoverBorder: "rgba(125,211,252,0.48)",
            blue: "#2f61c7",
            blueHover: "#2554b6",
            green: "#16a34a",
            greenHover: "#15803d",
            red: "#fca5a5",
            dangerHover: "rgba(248,113,113,0.12)",
            shadow: "0 18px 46px rgba(0,0,0,0.34)",
            dialogShadow: "0 24px 70px rgba(0,0,0,0.62)",
            backdrop: "rgba(2,6,23,0.42)",
        };
    }

    return {
        panel: "#ffffff",
        panelSubtle: "#f8fafc",
        row: "#f8fafc",
        rowHover: "#f1f5f9",
        header: "#333d49",
        border: "rgba(203,213,225,0.95)",
        borderSoft: "rgba(226,232,240,0.95)",
        text: "#334155",
        textStrong: "#0f172a",
        textMuted: "#64748b",
        inputBg: "#ffffff",
        inputFocus: "#2563eb",
        inputHoverBorder: "rgba(37,99,235,0.42)",
        blue: "#2563eb",
        blueHover: "#1d4ed8",
        green: "#16a34a",
        greenHover: "#15803d",
        red: "#dc2626",
        dangerHover: "rgba(220,38,38,0.08)",
        shadow: "0 18px 46px rgba(15,23,42,0.12)",
        dialogShadow: "0 18px 50px rgba(15,23,42,0.18)",
        backdrop: "rgba(15,23,42,0.12)",
    };
}

function makeTextFieldSx(palette: TagPalette) {
    return {
        "& .MuiInputBase-root": {
            borderRadius: 2,
            backgroundColor: palette.inputBg,
            color: palette.text,
        },
        "& .MuiInputBase-input, & .MuiInputBase-inputMultiline": {
            color: palette.text,
        },
        "& .MuiInputBase-input::placeholder": {
            color: palette.textMuted,
            opacity: 0.8,
        },
        "& .MuiInputLabel-root": {
            color: palette.textMuted,
        },
        "& .MuiInputLabel-root.Mui-focused": {
            color: palette.inputFocus,
        },
        "& .MuiOutlinedInput-notchedOutline": {
            borderColor: palette.border,
        },
        "&:hover .MuiOutlinedInput-notchedOutline": {
            borderColor: palette.inputHoverBorder,
        },
        "& .Mui-focused .MuiOutlinedInput-notchedOutline": {
            borderColor: palette.inputFocus,
        },
    } as const;
}

function generateTagId(): string {
    return `tag_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

function isNonEmptyString(v: any): boolean {
    return typeof v === "string" && v.trim().length > 0;
}

function coerceErrorMessage(e: any, fallback: string): string {
    const msg =
        (typeof e?.data?.detail === "string" && e.data.detail) ||
        (typeof e?.response?.data?.detail === "string" && e.response.data.detail) ||
        (typeof e?.message === "string" && e.message) ||
        String(e ?? "");
    return msg.trim() ? msg : fallback;
}

function normalizeTag(raw: any): ProtocolTag {
    const description = typeof raw?.description === "string" && raw.description.trim() ? raw.description : undefined;
    return {
        id: String(raw?.id ?? ""),
        title: String(raw?.title ?? ""),
        description,
        color: typeof raw?.color === "string" && raw.color.trim() ? raw.color : "#3b82f6",
    };
}

function normalizeTagList(raw: unknown): ProtocolTag[] {
    if (!Array.isArray(raw)) return [];
    return raw.map((t) => normalizeTag(t)).filter((t) => typeof t.title === "string" && t.title.trim().length > 0);
}

function TagEditorDialog({ open, mode, draft, onChange, onClose, onSave, isSaving, validationError }: TagEditorDialogProps) {
    const { theme } = useAppTheme();
    const palette = useMemo(() => getTagPalette(theme), [theme]);
    const textFieldSx = useMemo(() => makeTextFieldSx(palette), [palette]);
    const dialogTitle = mode === "create" ? "Create tag" : "Edit tag";
    const [helpOpen, setHelpOpen] = useState(false);

    return (
        <>
            <Dialog
                open={open}
                onClose={isSaving ? undefined : onClose}
                maxWidth="sm"
                fullWidth
                slotProps={{ backdrop: { sx: { backgroundColor: palette.backdrop, backdropFilter: "blur(2px)" } } }}
                PaperProps={{
                    sx: {
                        borderRadius: 4,
                        overflow: "hidden",
                        border: `1px solid ${palette.border}`,
                        backgroundImage: "none",
                        backgroundColor: palette.panel,
                        color: palette.text,
                        boxShadow: palette.dialogShadow,
                    },
                }}
            >
                <DialogTitle
                    sx={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        backgroundColor: palette.header,
                        color: "white",
                        px: 2,
                        py: 1.5,
                    }}
                >
                    <Typography sx={{ fontWeight: 700, fontSize: 16, lineHeight: 1.2 }}>{dialogTitle}</Typography>
                    <IconButton
                        onClick={onClose}
                        aria-label="Close"
                        size="small"
                        disabled={!!isSaving}
                        sx={{ color: "white", backgroundColor: "rgba(255,255,255,0.12)", "&:hover": { backgroundColor: "rgba(255,255,255,0.20)" } }}
                    >
                        <CloseIcon fontSize="small" />
                    </IconButton>
                </DialogTitle>

                <DialogContent sx={{ px: 2, py: 1.75, overflow: "visible", backgroundColor: palette.panel, color: palette.text }}>
                    <Box sx={{ display: "flex", flexDirection: "column", gap: 2, pt: 0.5 }}>
                        <TextField
                            label="Title"
                            value={draft.title}
                            onChange={(e) => onChange({ title: e.target.value })}
                            fullWidth
                            size="small"
                            required
                            margin="dense"
                            disabled={!!isSaving}
                            sx={textFieldSx}
                        />
                        <TextField
                            label="Description (optional)"
                            value={draft.description}
                            onChange={(e) => onChange({ description: e.target.value })}
                            fullWidth
                            size="small"
                            multiline
                            minRows={3}
                            margin="dense"
                            disabled={!!isSaving}
                            sx={textFieldSx}
                        />

                        <Box>
                            <Typography sx={{ fontSize: 12, fontWeight: 700, mb: 0.75, color: palette.textStrong }}>Color</Typography>
                            <Box sx={{ display: "flex", alignItems: "center", gap: 1, flexWrap: "wrap" }}>
                                {defaultTagColors.map((c) => {
                                    const isSelected = c.toLowerCase() === String(draft.color).toLowerCase();
                                    return (
                                        <Box
                                            key={c}
                                            component="button"
                                            type="button"
                                            onClick={() => onChange({ color: c })}
                                            disabled={!!isSaving}
                                            sx={{
                                                width: 24,
                                                height: 24,
                                                borderRadius: "50%",
                                                border: "2px solid",
                                                borderColor: isSelected ? palette.textStrong : palette.border,
                                                backgroundColor: c,
                                                cursor: isSaving ? "default" : "pointer",
                                                opacity: isSaving ? 0.65 : 1,
                                                boxShadow: isSelected ? "0 0 0 3px rgba(59,130,246,0.26)" : "none",
                                            }}
                                            aria-label={`Pick color ${c}`}
                                        />
                                    );
                                })}
                                <TextField
                                    size="small"
                                    value={draft.color}
                                    onChange={(e) => onChange({ color: e.target.value })}
                                    sx={{ ...textFieldSx, width: 140 }}
                                    inputProps={{ "aria-label": "Custom color" }}
                                    margin="dense"
                                    disabled={!!isSaving}
                                />
                                <Box
                                    component="input"
                                    type="color"
                                    value={draft.color}
                                    onChange={(e: any) => onChange({ color: e.target.value })}
                                    disabled={!!isSaving}
                                    sx={{ width: 36, height: 36, border: `1px solid ${palette.border}`, borderRadius: 1.5, backgroundColor: "transparent", padding: 0.25 }}
                                    aria-label="Pick custom color"
                                />
                            </Box>
                        </Box>

                        {validationError ? (
                            <Typography sx={{ color: palette.red, fontSize: 12, fontWeight: 600, whiteSpace: "pre-wrap" }}>{validationError}</Typography>
                        ) : null}
                    </Box>
                </DialogContent>

                <DialogActions sx={{ justifyContent: "center", gap: 1, px: 2, py: 1.5, borderTop: `1px solid ${palette.borderSoft}`, backgroundColor: palette.panelSubtle }}>
                    <Button
                        variant="outlined"
                        onClick={onClose}
                        disabled={!!isSaving}
                        sx={{ textTransform: "none", minWidth: 112, borderRadius: 2, color: palette.text, borderColor: palette.border, backgroundColor: palette.inputBg, "&:hover": { backgroundColor: palette.rowHover, borderColor: palette.inputHoverBorder } }}
                    >
                        Cancel
                    </Button>
                    <Button variant="contained" onClick={() => void onSave()} disabled={!!isSaving} sx={{ textTransform: "none", minWidth: 112, borderRadius: 2, boxShadow: "none" }}>
                        {isSaving ? "Saving..." : "Save"}
                    </Button>
                    <Tooltip title="Help">
                        <IconButton size="small" onClick={() => setHelpOpen(true)} sx={{ color: palette.inputFocus }}>
                            <HelpIcon fontSize="1.1rem" />
                        </IconButton>
                    </Tooltip>
                </DialogActions>
            </Dialog>

            <Dialog
                open={helpOpen}
                onClose={() => setHelpOpen(false)}
                maxWidth="sm"
                fullWidth
                slotProps={{ backdrop: { sx: { backgroundColor: palette.backdrop, backdropFilter: "blur(2px)" } } }}
                PaperProps={{ sx: { borderRadius: 4, backgroundImage: "none", backgroundColor: palette.panel, color: palette.text, border: `1px solid ${palette.border}` } }}
            >
                <DialogTitle sx={{ backgroundColor: palette.header, color: "white", fontWeight: 700 }}>Help</DialogTitle>
                <DialogContent sx={{ backgroundColor: palette.panel, color: palette.text, pt: 2 }}>
                    <Typography sx={{ fontSize: 13, lineHeight: 1.6, color: palette.text }}>
                        Tag title identifies and filters protocols. The description is optional. Pick a color to recognize the tag quickly in chips and lists.
                    </Typography>
                </DialogContent>
                <DialogActions sx={{ backgroundColor: palette.panelSubtle, borderTop: `1px solid ${palette.borderSoft}` }}>
                    <Button onClick={() => setHelpOpen(false)} variant="outlined" sx={{ color: palette.text, borderColor: palette.border, backgroundColor: palette.inputBg, textTransform: "none", "&:hover": { backgroundColor: palette.rowHover, borderColor: palette.inputHoverBorder } }}>
                        Close
                    </Button>
                </DialogActions>
            </Dialog>
        </>
    );
}

const TagManager = memo(function TagManager({ title, projectId, open = true, tags, onTagsChange, initialTags }: TagManagerProps) {
    const { theme } = useAppTheme();
    const palette = useMemo(() => getTagPalette(theme), [theme]);
    const svc = useProjectService();
    const svcRef = useRef(svc);
    useEffect(() => {
        svcRef.current = svc;
    }, [svc]);

    const normalizedProjectId = useMemo(() => {
        const s = String(projectId ?? "").trim();
        if (!s || s === "null" || s === "undefined") return null;
        return projectId as Id;
    }, [projectId]);

    const backendEnabled = normalizedProjectId != null;
    const isControlled = !backendEnabled && Array.isArray(tags) && typeof onTagsChange === "function";
    const [backendTags, setBackendTags] = useState<ProtocolTag[]>([]);
    const { tags: storeTags, setTags: storeSetTags, deleteTag: storeDeleteTag } = useTagStore();

    const effectiveTags = useMemo(() => {
        if (backendEnabled) return Array.isArray(backendTags) ? backendTags : [];
        if (isControlled) return Array.isArray(tags) ? tags : [];
        return Array.isArray(storeTags) ? storeTags : [];
    }, [backendEnabled, backendTags, isControlled, tags, storeTags]);

    const persistTags = useCallback(
        (next: ProtocolTag[]) => {
            const list = Array.isArray(next) ? next : [];
            if (backendEnabled) setBackendTags(list);
            storeSetTags(list);
            onTagsChange?.(list);
        },
        [backendEnabled, onTagsChange, storeSetTags],
    );

    const [isLoading, setIsLoading] = useState(false);
    const [isSaving, setIsSaving] = useState(false);
    const [deletingIds, setDeletingIds] = useState<Record<string, boolean>>({});
    const [editorOpen, setEditorOpen] = useState(false);
    const [editorMode, setEditorMode] = useState<"create" | "edit">("create");
    const [draft, setDraft] = useState<TagDraft>({ title: "", description: "", color: "#3b82f6" });
    const [validationError, setValidationError] = useState<string | null>(null);

    useEffect(() => {
        if (backendEnabled) return;
        if (!Array.isArray(tags)) return;
        storeSetTags(tags);
    }, [backendEnabled, tags, storeSetTags]);

    useEffect(() => {
        if (backendEnabled) return;
        if (isControlled) return;
        if (!Array.isArray(initialTags) || initialTags.length === 0) return;
        if (Array.isArray(storeTags) && storeTags.length > 0) return;
        storeSetTags(initialTags);
    }, [backendEnabled, isControlled, initialTags, storeSetTags, storeTags]);

    useEffect(() => {
        if (!backendEnabled) return;
        if (!open) return;
        const pidKey = String(normalizedProjectId ?? "").trim();
        if (!pidKey) return;

        let cancelled = false;
        setIsLoading(true);
        void (async () => {
            try {
                const remote = await svcRef.current.listProjectTags(normalizedProjectId as Id);
                if (cancelled) return;
                persistTags(normalizeTagList(remote as ServiceProtocolTag[]));
            } catch (e: any) {
                if (!cancelled) toast.error(coerceErrorMessage(e, "Failed to load tags"));
            } finally {
                if (!cancelled) setIsLoading(false);
            }
        })();

        return () => {
            cancelled = true;
        };
    }, [backendEnabled, normalizedProjectId, open, persistTags]);

    const openCreate = () => {
        setValidationError(null);
        setEditorMode("create");
        setDraft({ title: "", description: "", color: "#3b82f6" });
        setEditorOpen(true);
    };

    const openEdit = (tag: ProtocolTag) => {
        setValidationError(null);
        setEditorMode("edit");
        setDraft({ id: tag.id, title: tag.title, description: tag.description ?? "", color: tag.color ?? "#3b82f6" });
        setEditorOpen(true);
    };

    const validateDraft = (): string | null => {
        if (!isNonEmptyString(draft.title)) return "Title is required.";
        const titleKey = draft.title.trim().toLowerCase();
        const conflict = effectiveTags.some((tag) => {
            if (editorMode === "edit" && draft.id && String(tag.id) === String(draft.id)) return false;
            return String(tag.title).trim().toLowerCase() === titleKey;
        });
        if (conflict) return "A tag with the same title already exists.";
        if (!isNonEmptyString(draft.color)) return "Color is required.";
        return null;
    };

    const saveDraft = async () => {
        const err = validateDraft();
        if (err) {
            setValidationError(err);
            return;
        }
        setIsSaving(true);
        setValidationError(null);
        try {
            if (editorMode === "create") {
                if (backendEnabled) {
                    const created = await svcRef.current.createProjectTag(normalizedProjectId as Id, {
                        title: draft.title.trim(),
                        description: draft.description.trim() ? draft.description.trim() : null,
                        color: draft.color,
                    } as any);
                    const createdTag = normalizeTag(created);
                    persistTags([createdTag, ...effectiveTags.filter((tag) => String(tag.id) !== String(createdTag.id))]);
                } else {
                    persistTags([
                        { id: generateTagId(), title: draft.title.trim(), description: draft.description.trim() || undefined, color: draft.color },
                        ...effectiveTags,
                    ]);
                }
                setEditorOpen(false);
                return;
            }

            if (!draft.id) {
                setValidationError("Missing tag id.");
                return;
            }

            if (backendEnabled) {
                const updated = await svcRef.current.updateProjectTag(normalizedProjectId as Id, String(draft.id), {
                    title: draft.title.trim(),
                    description: draft.description.trim() ? draft.description.trim() : null,
                    color: draft.color,
                } as any);
                const updatedTag = normalizeTag(updated);
                persistTags(effectiveTags.map((tag) => (String(tag.id) === String(draft.id) ? updatedTag : tag)));
            } else {
                persistTags(
                    effectiveTags.map((tag) =>
                        String(tag.id) === String(draft.id)
                            ? { ...tag, title: draft.title.trim(), description: draft.description.trim() || undefined, color: draft.color }
                            : tag,
                    ),
                );
            }
            setEditorOpen(false);
        } catch (e: any) {
            toast.error(coerceErrorMessage(e, "Failed to save tag"));
        } finally {
            setIsSaving(false);
        }
    };

    const deleteTag = async (tagId: string) => {
        const tid = String(tagId);
        if (!backendEnabled) {
            if (isControlled) persistTags(effectiveTags.filter((tag) => String(tag.id) !== tid));
            else storeDeleteTag(tid);
            return;
        }

        setDeletingIds((prev) => ({ ...prev, [tid]: true }));
        try {
            const res = await svcRef.current.deleteProjectTag(normalizedProjectId as Id, tid);
            if (res && (res as any).success === false) {
                toast.error("Delete failed");
                return;
            }
            persistTags(effectiveTags.filter((tag) => String(tag.id) !== tid));
        } catch (e: any) {
            toast.error(coerceErrorMessage(e, "Failed to delete tag"));
        } finally {
            setDeletingIds((prev) => {
                const next = { ...prev };
                delete next[tid];
                return next;
            });
        }
    };

    return (
        <Box sx={{ border: `1px solid ${palette.border}`, borderRadius: 3, backgroundColor: palette.panel, color: palette.text, overflow: "hidden", boxShadow: palette.shadow }}>
            <Box sx={{ px: 1.75, py: 1.35, backgroundColor: palette.header, color: "white", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 1 }}>
                <Box sx={{ display: "inline-flex", alignItems: "center", gap: 1, minWidth: 0 }}>
                    <Typography sx={{ fontWeight: 700, fontSize: 14, lineHeight: 1.25, color: "white" }}>{title ?? "Tags"}</Typography>
                    {isLoading ? <CircularProgress size={14} sx={{ color: "rgba(255,255,255,0.88)" }} /> : null}
                </Box>
                <Button variant="contained" onClick={openCreate} disabled={isLoading} sx={{ textTransform: "none", backgroundColor: palette.green, borderRadius: 2, boxShadow: "none", fontWeight: 700, "&:hover": { backgroundColor: palette.greenHover, boxShadow: "none" } }}>
                    New tag
                </Button>
            </Box>

            <Box sx={{ p: 1.5, backgroundColor: palette.panel }}>
                {effectiveTags.length === 0 ? (
                    <Box sx={{ border: `1px dashed ${palette.border}`, borderRadius: 2.5, px: 1.5, py: 1.25, backgroundColor: palette.row }}>
                        <Typography sx={{ fontSize: 12, color: palette.textMuted }}>No tags yet.</Typography>
                    </Box>
                ) : (
                    <Box sx={{ display: "flex", flexDirection: "column", gap: 1 }}>
                        {effectiveTags.map((tag) => {
                            const isDeleting = !!deletingIds[String(tag.id)];
                            return (
                                <Box key={tag.id} sx={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) auto", alignItems: "center", gap: 1, border: `1px solid ${palette.borderSoft}`, borderRadius: 2.5, px: 1.25, py: 1, opacity: isDeleting ? 0.65 : 1, backgroundColor: palette.row, "&:hover": { borderColor: palette.inputHoverBorder, backgroundColor: palette.rowHover } }}>
                                    <Box sx={{ minWidth: 0 }}>
                                        <Box sx={{ display: "flex", alignItems: "center", gap: 1, minWidth: 0 }}>
                                            <Box sx={{ width: 11, height: 11, borderRadius: "50%", backgroundColor: tag.color, border: `1px solid ${palette.border}`, boxShadow: "0 0 0 3px rgba(148,163,184,0.10)", flex: "0 0 auto" }} />
                                            <Typography sx={{ fontWeight: 700, fontSize: 13, color: palette.textStrong, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={tag.title}>
                                                {tag.title}
                                            </Typography>
                                        </Box>
                                        {tag.description ? <Typography sx={{ fontSize: 12, color: palette.textMuted, mt: 0.35, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{tag.description}</Typography> : null}
                                    </Box>
                                    <Box sx={{ display: "inline-flex", alignItems: "center", gap: 0.5 }}>
                                        <Button size="small" variant="contained" onClick={() => openEdit(tag)} disabled={isDeleting || isLoading} sx={{ textTransform: "none", borderRadius: 2, backgroundColor: palette.blue, color: "white", boxShadow: "none", "&:hover": { backgroundColor: palette.blueHover, boxShadow: "none" } }}>
                                            Edit
                                        </Button>
                                        <Tooltip title="Delete">
                                            <span>
                                                <IconButton size="small" onClick={() => void deleteTag(String(tag.id))} disabled={isDeleting || isLoading} sx={{ color: palette.red, borderRadius: 2, "&:hover": { backgroundColor: palette.dangerHover } }}>
                                                    <TrashBinIcon fontSize="1.2rem" />
                                                </IconButton>
                                            </span>
                                        </Tooltip>
                                    </Box>
                                </Box>
                            );
                        })}
                    </Box>
                )}
            </Box>

            <TagEditorDialog
                open={editorOpen}
                mode={editorMode}
                draft={draft}
                onChange={(patch) => setDraft((prev) => ({ ...prev, ...patch }))}
                onClose={() => {
                    if (!isSaving) setEditorOpen(false);
                }}
                onSave={saveDraft}
                isSaving={isSaving}
                validationError={validationError}
            />
        </Box>
    );
});

export default TagManager;
