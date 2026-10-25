import type { ExecuteProtocolWizardViewerState } from "@/services/ProjectService";

export type WizardDialogOption = {
    value: string;
    label: string;
};

export type WizardInputDialogField = {
    name: string;
    label?: string;
    kind: "number" | "text" | "select";
    value?: string | number | null;
    min?: number;
    max?: number;
    step?: number;
    options?: Array<{ value: string; label: string }>;
};

export type WizardOptionsDialogState = {
    kind: "options";
    open: true;
    stateKey: string;
    paramName: string;
    title: string;
    options: WizardDialogOption[];
    selectedValue: string;
    message: string;
};

export type WizardInputDialogState = {
    kind: "input";
    open: true;
    stateKey: string;
    paramName: string;
    wizardId: string;
    title: string;
    fields: WizardInputDialogField[];
    values: Record<string, string>;
    message: string;
    previewImageUrl: string;
};

export type MaskRadiusDialogItem = {
    id: string;
    label: string;
    index: number;
};

export type MaskRadiusDialogState = {
    kind: "mask_radius";
    open: true;
    stateKey: string;
    paramName: string;
    wizardId: string;
    title: string;
    radius: number;
    min: number;
    max: number;
    step: number;
    radiusAngstrom: number | null;
    samplingRate: number | null;
    selectedIndex: number;
    items: MaskRadiusDialogItem[];
    message: string;
    previewUrl: string | null;
    previewWidth: number | null;
    previewHeight: number | null;
    previewSourceWidth: number | null;
    previewSourceHeight: number | null;
    previewCaption: string;
};

export type MaskRadiiDialogState = {
    kind: "mask_radii";
    open: true;
    stateKey: string;
    paramName: string;
    secondaryParamName: string;
    wizardId: string;
    title: string;
    innerRadius: number;
    outerRadius: number;
    innerMin: number;
    outerMin: number;
    max: number;
    step: number;
    innerRadiusAngstrom: number | null;
    outerRadiusAngstrom: number | null;
    samplingRate: number | null;
    selectedIndex: number;
    items: MaskRadiusDialogItem[];
    message: string;
    previewUrl: string | null;
    previewWidth: number | null;
    previewHeight: number | null;
    previewSourceWidth: number | null;
    previewSourceHeight: number | null;
    previewCaption: string;
};

export type CtfPreviewDialogState = {
    kind: "ctf_preview";
    open: true;
    stateKey: string;
    paramName: string;
    wizardId: string;
    title: string;
    message: string;

    items: MaskRadiusDialogItem[];
    selectedIndex: number;

    micrographPreviewUrl: string | null;
    psdPreviewUrl: string | null;

    downsample: number;
    downsampleMin: number;
    downsampleMax: number;
    downsampleStep: number;

    lowFreq: number;
    lowFreqMin: number;
    lowFreqMax: number;

    highFreq: number;
    highFreqMin: number;
    highFreqMax: number;

    freqStep: number;
    samplingRate: number | null;
    showInAngstroms: boolean;

    downsampleParamName: string;
    lowFreqParamName: string;
    highFreqParamName: string;

    autoDownsampling: boolean;
    autoDownsampleValue: number | null;
};

export type DownsamplePreviewDialogState = {
    kind: "downsample_preview";
    open: true;
    stateKey: string;
    paramName: string;
    wizardId: string;
    title: string;
    message: string;

    items: MaskRadiusDialogItem[];
    selectedIndex: number;

    micrographPreviewUrl: string | null;
    psdPreviewUrl: string | null;

    downsample: number;
    downsampleMin: number;
    downsampleMax: number;
    downsampleStep: number;

    downsampleParamName: string;
};

export type FilterPreviewDialogState = {
    kind: "filter_preview";
    open: true;
    stateKey: string;
    paramName: string;
    wizardId: string;
    title: string;
    message: string;

    items: MaskRadiusDialogItem[];
    selectedIndex: number;

    originalPreviewUrl: string | null;
    filteredPreviewUrl: string | null;

    lowFreq: number;
    lowFreqMin: number;
    lowFreqMax: number;

    highFreq: number;
    highFreqMin: number;
    highFreqMax: number;

    decay: number;
    decayMin: number;
    decayMax: number;

    freqStep: number;
    unitLabel: string;
    filterMode: string;

    lowFreqParamName: string;
    highFreqParamName: string;
    decayParamName: string;
};

export type ClosedWizardState = {
    kind: "closed";
    open: false;
};

export type ActiveWizardState =
    | ClosedWizardState
    | WizardOptionsDialogState
    | WizardInputDialogState
    | MaskRadiusDialogState
    | MaskRadiiDialogState
    | CtfPreviewDialogState
    | DownsamplePreviewDialogState
    | FilterPreviewDialogState
    | PointInVolumeDialogState;

export const closedWizardState: ClosedWizardState = {
    kind: "closed",
    open: false,
};

export type PointInVolumeDialogState = {
    kind: "point_in_volume";
    open: true;
    stateKey: string;
    paramName: string;
    wizardId: string;
    title: string;
    message: string;

    dims: [number, number, number];
    previewDims: [number, number, number];
    previewValues: number[];

    point: {
        x: number;
        y: number;
        z: number;
    };

    pointVoxel: {
        x: number;
        y: number;
        z: number;
    };

    bounds: {
        xMin: number;
        xMax: number;
        yMin: number;
        yMax: number;
        zMin: number;
        zMax: number;
    };
};


export function viewerStateToPointInVolumeDialogState(args: {
    stateKey: string;
    paramName: string;
    wizardId: string;
    title: string;
    message: string;
    viewerState: ExecuteProtocolWizardViewerState | null;
}): PointInVolumeDialogState {
    const {
        stateKey,
        paramName,
        wizardId,
        title,
        message,
        viewerState,
    } = args;

    const dimsRaw = Array.isArray(viewerState?.dims) ? viewerState.dims : [1, 1, 1];
    const previewDimsRaw = Array.isArray(viewerState?.previewDims)
        ? viewerState.previewDims
        : dimsRaw;

    const dims: [number, number, number] = [
        Number(dimsRaw[0] ?? 1) || 1,
        Number(dimsRaw[1] ?? 1) || 1,
        Number(dimsRaw[2] ?? 1) || 1,
    ];

    const previewDims: [number, number, number] = [
        Number(previewDimsRaw[0] ?? 1) || 1,
        Number(previewDimsRaw[1] ?? 1) || 1,
        Number(previewDimsRaw[2] ?? 1) || 1,
    ];

    const point = {
        x: Number(viewerState?.point?.x ?? 0) || 0,
        y: Number(viewerState?.point?.y ?? 0) || 0,
        z: Number(viewerState?.point?.z ?? 0) || 0,
    };

    const pointVoxel = {
        x: Number(viewerState?.pointVoxel?.x ?? 0) || 0,
        y: Number(viewerState?.pointVoxel?.y ?? 0) || 0,
        z: Number(viewerState?.pointVoxel?.z ?? 0) || 0,
    };

    return {
        kind: "point_in_volume",
        open: true,
        stateKey,
        paramName,
        wizardId,
        title,
        message,
        dims,
        previewDims,
        previewValues: Array.isArray(viewerState?.previewValues)
            ? viewerState.previewValues.map((v) => Number(v) || 0)
            : [],
        point,
        pointVoxel,
        bounds: {
            xMin: Number(viewerState?.bounds?.xMin ?? -(dims[2] / 2)) || -(dims[2] / 2),
            xMax: Number(viewerState?.bounds?.xMax ?? dims[2] / 2) || dims[2] / 2,
            yMin: Number(viewerState?.bounds?.yMin ?? -(dims[1] / 2)) || -(dims[1] / 2),
            yMax: Number(viewerState?.bounds?.yMax ?? dims[1] / 2) || dims[1] / 2,
            zMin: Number(viewerState?.bounds?.zMin ?? -(dims[0] / 2)) || -(dims[0] / 2),
            zMax: Number(viewerState?.bounds?.zMax ?? dims[0] / 2) || dims[0] / 2,
        },
    };
}

export function viewerStateToFilterPreviewDialogState(args: {
    stateKey: string;
    paramName: string;
    wizardId: string;
    title: string;
    message: string;
    viewerState: ExecuteProtocolWizardViewerState | null;
    previewUrl: string | null;
}): FilterPreviewDialogState {
    const {
        stateKey,
        paramName,
        wizardId,
        title,
        message,
        viewerState,
        previewUrl,
    } = args;

    const items = normalizeWizardViewerItems(viewerState?.items);
    const normalizedSelectedIndex = Math.max(
        1,
        Number(viewerState?.selectedIndex ?? items[0]?.index ?? 1) || items[0]?.index || 1,
    );

    return {
        kind: "filter_preview",
        open: true,
        stateKey,
        paramName,
        wizardId,
        title,
        message,
        items,
        selectedIndex: normalizedSelectedIndex,
        originalPreviewUrl:
            String(viewerState?.originalPreview?.imageUrl ?? "").trim() || previewUrl,
        filteredPreviewUrl:
            String(viewerState?.filteredPreview?.imageUrl ?? "").trim() || previewUrl,
        lowFreq: Number(viewerState?.lowFreq ?? 0) || 0,
        lowFreqMin: Number(viewerState?.lowFreqMin ?? 0) || 0,
        lowFreqMax: Number(viewerState?.lowFreqMax ?? 1) || 1,
        highFreq: Number(viewerState?.highFreq ?? 0) || 0,
        highFreqMin: Number(viewerState?.highFreqMin ?? 0) || 0,
        highFreqMax: Number(viewerState?.highFreqMax ?? 1) || 1,
        decay: Number(viewerState?.decay ?? 0) || 0,
        decayMin: Number(viewerState?.decayMin ?? 0) || 0,
        decayMax: Number(viewerState?.decayMax ?? 1) || 1,
        freqStep: Number(viewerState?.freqStep ?? 0.01) || 0.01,
        unitLabel: String(viewerState?.unitLabel ?? "").trim(),
        filterMode: String(viewerState?.filterMode ?? "").trim(),
        lowFreqParamName: String(viewerState?.lowFreqParam ?? "lowFreq").trim() || "lowFreq",
        highFreqParamName: String(viewerState?.highFreqParam ?? "highFreq").trim() || "highFreq",
        decayParamName: String(viewerState?.decayParam ?? "decay").trim() || "decay",
    };
}

export function normalizeWizardViewerItems(
    raw: unknown,
): MaskRadiusDialogItem[] {
    if (!Array.isArray(raw)) return [];

    const seen = new Map<string, number>();

    return raw
        .map((item: any, idx: number) => {
            const baseId = String(item?.id ?? "").trim() || `wizard-item-${idx + 1}`;
            const count = seen.get(baseId) ?? 0;
            seen.set(baseId, count + 1);

            return {
                id: count === 0 ? baseId : `${baseId}:${count + 1}`,
                label: String(item?.label ?? "").trim(),
                index: Number(item?.index ?? idx + 1) || idx + 1,
            };
        })
        .filter((item) => item.id && item.label && item.index > 0);
}

export function viewerStateToMaskRadiusDialogState(args: {
    stateKey: string;
    paramName: string;
    wizardId: string;
    title: string;
    message: string;
    fallbackRadius?: number;
    viewerState: ExecuteProtocolWizardViewerState | null;
    previewUrl: string | null;
}): MaskRadiusDialogState {
    const {
        stateKey,
        paramName,
        wizardId,
        title,
        message,
        fallbackRadius = 1,
        viewerState,
        previewUrl,
    } = args;

    return {
        kind: "mask_radius",
        open: true,
        stateKey,
        paramName,
        wizardId,
        title,
        radius: Number(viewerState?.radius ?? fallbackRadius) || fallbackRadius,
        min: Number(viewerState?.radiusMin ?? 1) || 1,
        max: Number(viewerState?.radiusMax ?? 256) || 256,
        step: Number(viewerState?.radiusStep ?? 1) || 1,
        radiusAngstrom:
            typeof viewerState?.radiusAngstrom === "number"
                ? viewerState.radiusAngstrom
                : null,
        samplingRate:
            typeof viewerState?.samplingRate === "number"
                ? viewerState.samplingRate
                : null,
        selectedIndex: Math.max(1, Number(viewerState?.selectedIndex ?? 1) || 1),
        items: normalizeWizardViewerItems(viewerState?.items),
        message,
        previewUrl,
        previewWidth:
            typeof viewerState?.preview?.width === "number"
                ? viewerState.preview.width
                : null,
        previewHeight:
            typeof viewerState?.preview?.height === "number"
                ? viewerState.preview.height
                : null,
        previewSourceWidth:
            typeof viewerState?.preview?.sourceWidth === "number"
                ? viewerState.preview.sourceWidth
                : null,
        previewSourceHeight:
            typeof viewerState?.preview?.sourceHeight === "number"
                ? viewerState.preview.sourceHeight
                : null,
        previewCaption: String(viewerState?.preview?.caption ?? "").trim(),
    };
}

export function viewerStateToMaskRadiiDialogState(args: {
    stateKey: string;
    paramName: string;
    wizardId: string;
    title: string;
    message: string;
    fallbackInnerRadius?: number;
    fallbackOuterRadius?: number;
    viewerState: ExecuteProtocolWizardViewerState | null;
    previewUrl: string | null;
}): MaskRadiiDialogState {
    const {
        stateKey,
        paramName,
        wizardId,
        title,
        message,
        fallbackInnerRadius = 1,
        fallbackOuterRadius = Math.max(2, fallbackInnerRadius),
        viewerState,
        previewUrl,
    } = args;

    const innerRadius =
        Number(viewerState?.innerRadius ?? fallbackInnerRadius) || fallbackInnerRadius;
    const outerRadiusRaw =
        Number(viewerState?.outerRadius ?? fallbackOuterRadius) || fallbackOuterRadius;
    const outerRadius = Math.max(innerRadius, outerRadiusRaw);

    return {
        kind: "mask_radii",
        open: true,
        stateKey,
        paramName,
        secondaryParamName: String(
            viewerState?.secondaryParam ?? "outerRadius",
        ).trim() || "outerRadius",
        wizardId,
        title,
        innerRadius,
        outerRadius,
        innerMin: Number(viewerState?.innerRadiusMin ?? 1) || 1,
        outerMin: Number(viewerState?.outerRadiusMin ?? 1) || 1,
        max: Number(viewerState?.radiusMax ?? 256) || 256,
        step: Number(viewerState?.radiusStep ?? 1) || 1,
        innerRadiusAngstrom:
            typeof viewerState?.innerRadiusAngstrom === "number"
                ? viewerState.innerRadiusAngstrom
                : null,
        outerRadiusAngstrom:
            typeof viewerState?.outerRadiusAngstrom === "number"
                ? viewerState.outerRadiusAngstrom
                : null,
        samplingRate:
            typeof viewerState?.samplingRate === "number"
                ? viewerState.samplingRate
                : null,
        selectedIndex: Math.max(1, Number(viewerState?.selectedIndex ?? 1) || 1),
        items: normalizeWizardViewerItems(viewerState?.items),
        message,
        previewUrl,
        previewWidth:
            typeof viewerState?.preview?.width === "number"
                ? viewerState.preview.width
                : null,
        previewHeight:
            typeof viewerState?.preview?.height === "number"
                ? viewerState.preview.height
                : null,
        previewSourceWidth:
            typeof viewerState?.preview?.sourceWidth === "number"
                ? viewerState.preview.sourceWidth
                : null,
        previewSourceHeight:
            typeof viewerState?.preview?.sourceHeight === "number"
                ? viewerState.preview.sourceHeight
                : null,
        previewCaption: String(viewerState?.preview?.caption ?? "").trim(),
    };
}

export function viewerStateToCtfPreviewDialogState(args: {
    stateKey: string;
    paramName: string;
    wizardId: string;
    title: string;
    message: string;
    viewerState: ExecuteProtocolWizardViewerState | null;
    previewUrl: string | null;
}): CtfPreviewDialogState {
    const {
        stateKey,
        paramName,
        wizardId,
        title,
        message,
        viewerState,
        previewUrl,
    } = args;

    const items = normalizeWizardViewerItems(viewerState?.items);
    const normalizedSelectedIndex = Math.max(
        1,
        Number(viewerState?.selectedIndex ?? items[0]?.index ?? 1) || items[0]?.index || 1,
    );

    return {
        kind: "ctf_preview",
        open: true,
        stateKey,
        paramName,
        wizardId,
        title,
        message,
        items,
        selectedIndex: normalizedSelectedIndex,
        micrographPreviewUrl:
            String(viewerState?.micrographPreview?.imageUrl ?? "").trim() || previewUrl,
        psdPreviewUrl:
            String(viewerState?.psdPreview?.imageUrl ?? "").trim() || previewUrl,
        downsample: Number(viewerState?.downsample ?? 1) || 1,
        downsampleMin: Number(viewerState?.downsampleMin ?? 1) || 1,
        downsampleMax: Number(viewerState?.downsampleMax ?? 8) || 8,
        downsampleStep: Number(viewerState?.downsampleStep ?? 0.1) || 0.1,
        lowFreq: Number(viewerState?.lowFreq ?? 0.1) || 0.1,
        lowFreqMin: Number(viewerState?.lowFreqMin ?? 0.1) || 0.1,
        lowFreqMax: Number(viewerState?.lowFreqMax ?? 50) || 50,
        highFreq: Number(viewerState?.highFreq ?? 0.35) || 0.35,
        highFreqMin: Number(viewerState?.highFreqMin ?? 0.1) || 0.1,
        highFreqMax: Number(viewerState?.highFreqMax ?? 50) || 50,
        freqStep: Number(viewerState?.freqStep ?? 0.1) || 0.1,
        samplingRate:
            typeof viewerState?.samplingRate === "number"
                ? viewerState.samplingRate
                : null,
        showInAngstroms: Boolean(viewerState?.showInAngstroms),
        downsampleParamName: String(viewerState?.downsampleParam ?? paramName).trim() || paramName,
        lowFreqParamName: String(viewerState?.lowFreqParam ?? "lowRes").trim() || "lowRes",
        highFreqParamName: String(viewerState?.highFreqParam ?? "highRes").trim() || "highRes",
        autoDownsampling: Boolean(viewerState?.autoDownsampling),
        autoDownsampleValue:
            typeof viewerState?.autoDownsampleValue === "number"
                ? viewerState.autoDownsampleValue
                : null,
    };
}

export function viewerStateToDownsamplePreviewDialogState(args: {
    stateKey: string;
    paramName: string;
    wizardId: string;
    title: string;
    message: string;
    viewerState: ExecuteProtocolWizardViewerState | null;
    previewUrl: string | null;
}): DownsamplePreviewDialogState {
    const {
        stateKey,
        paramName,
        wizardId,
        title,
        message,
        viewerState,
        previewUrl,
    } = args;

    const items = normalizeWizardViewerItems(viewerState?.items);
    const normalizedSelectedIndex = Math.max(
        1,
        Number(viewerState?.selectedIndex ?? items[0]?.index ?? 1) || items[0]?.index || 1,
    );

    return {
        kind: "downsample_preview",
        open: true,
        stateKey,
        paramName,
        wizardId,
        title,
        message,
        items,
        selectedIndex: normalizedSelectedIndex,
        micrographPreviewUrl:
            String(viewerState?.micrographPreview?.imageUrl ?? "").trim() || previewUrl,
        psdPreviewUrl:
            String(viewerState?.psdPreview?.imageUrl ?? "").trim() || previewUrl,
        downsample: Number(viewerState?.downsample ?? 1) || 1,
        downsampleMin: Number(viewerState?.downsampleMin ?? 1) || 1,
        downsampleMax: Number(viewerState?.downsampleMax ?? 8) || 8,
        downsampleStep: Number(viewerState?.downsampleStep ?? 0.01) || 0.01,
        downsampleParamName:
            String(viewerState?.downsampleParam ?? paramName).trim() || paramName,
    };
}