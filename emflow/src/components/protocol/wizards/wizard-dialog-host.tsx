import {
    WizardInputDialog,
    WizardOptionsDialog,
} from "../WizardDialogs";
import CtfPreviewDialog from "./CtfPreviewDialog";
import FilterPreviewDialog from "./FilterPreviewDialog";
import MaskRadiusDialog from "./MaskRadiusDialog";
import MaskRadiiDialog from "./MaskRadiiDialog";
import DownsamplePreviewDialog from "./DownsamplePreviewDialog";
import type { ActiveWizardState } from "./protocol_wizard_types";
import PointInVolumeWizardDialog from "./PointInVolumeWizardDialog";

type WizardDialogHostProps = {
    wizardState: ActiveWizardState;
    previewLoading: boolean;
    onClose: () => void;
    onConfirm: () => void;
    onOptionsSelectedValueChange: (value: string) => void;
    onInputValueChange: (fieldName: string, value: string) => void;
    onMaskRadiusChange: (value: number) => void;
    onMaskRadiusCommit: (value: number) => void;
    onMaskRadiusSelectedIndexChange: (value: number) => void;
    onMaskRadiiInnerChange: (value: number) => void;
    onMaskRadiiInnerCommit: (value: number) => void;
    onMaskRadiiOuterChange: (value: number) => void;
    onMaskRadiiOuterCommit: (value: number) => void;
    onMaskRadiiSelectedIndexChange: (value: number) => void;
    onCtfDownsampleChange: (value: number) => void;
    onCtfDownsampleCommit: (value: number) => void;
    onCtfLowFreqChange: (value: number) => void;
    onCtfLowFreqCommit: (value: number) => void;
    onCtfHighFreqChange: (value: number) => void;
    onCtfHighFreqCommit: (value: number) => void;
    onCtfSelectedIndexChange: (value: number) => void;
    onFilterLowFreqChange: (value: number) => void;
    onFilterLowFreqCommit: (value: number) => void;
    onFilterHighFreqChange: (value: number) => void;
    onFilterHighFreqCommit: (value: number) => void;
    onFilterDecayChange: (value: number) => void;
    onFilterDecayCommit: (value: number) => void;
    onFilterSelectedIndexChange: (value: number) => void;
    onDownsamplePreviewChange: (value: number) => void;
    onDownsamplePreviewCommit: (value: number) => void;
    onDownsamplePreviewSelectedIndexChange: (value: number) => void;
    onPointInVolumeChange: (point: { x: number; y: number; z: number }) => void;
    onPointInVolumeVoxelChange: (pointVoxel: { x: number; y: number; z: number }) => void;
};

export default function WizardDialogHost({
    wizardState,
    previewLoading,
    onClose,
    onConfirm,
    onOptionsSelectedValueChange,
    onInputValueChange,
    onMaskRadiusChange,
    onMaskRadiusCommit,
    onMaskRadiusSelectedIndexChange,
    onMaskRadiiInnerChange,
    onMaskRadiiInnerCommit,
    onMaskRadiiOuterChange,
    onMaskRadiiOuterCommit,
    onMaskRadiiSelectedIndexChange,
    onCtfDownsampleChange,
    onCtfDownsampleCommit,
    onCtfLowFreqChange,
    onCtfLowFreqCommit,
    onCtfHighFreqChange,
    onCtfHighFreqCommit,
    onCtfSelectedIndexChange,
    onFilterLowFreqChange,
    onFilterLowFreqCommit,
    onFilterHighFreqChange,
    onFilterHighFreqCommit,
    onFilterDecayChange,
    onFilterDecayCommit,
    onFilterSelectedIndexChange,
    onDownsamplePreviewSelectedIndexChange,
    onDownsamplePreviewChange,
    onDownsamplePreviewCommit,
    onPointInVolumeChange,
    onPointInVolumeVoxelChange,

}: WizardDialogHostProps) {
    if (!wizardState.open) return null;

    if (wizardState.kind === "options") {
        return (
            <WizardOptionsDialog
                open={wizardState.open}
                title={wizardState.title}
                paramName={wizardState.paramName}
                options={wizardState.options}
                selectedValue={wizardState.selectedValue}
                message={wizardState.message}
                onClose={onClose}
                onConfirm={onConfirm}
                onSelectedValueChange={onOptionsSelectedValueChange}
            />
        );
    }

    if (wizardState.kind === "input") {
        return (
            <WizardInputDialog
                open={wizardState.open}
                title={wizardState.title}
                fields={wizardState.fields}
                values={wizardState.values}
                message={wizardState.message}
                previewImageUrl={wizardState.previewImageUrl}
                onClose={onClose}
                onConfirm={onConfirm}
                onValueChange={onInputValueChange}
            />
        );
    }

    if (wizardState.kind === "mask_radius") {
        return (
            <MaskRadiusDialog
                open={wizardState.open}
                title={wizardState.title}
                radius={wizardState.radius}
                min={wizardState.min}
                max={wizardState.max}
                step={wizardState.step}
                radiusAngstrom={wizardState.radiusAngstrom}
                samplingRate={wizardState.samplingRate}
                selectedIndex={wizardState.selectedIndex}
                items={wizardState.items}
                message={wizardState.message}
                previewUrl={wizardState.previewUrl}
                previewCaption={wizardState.previewCaption}
                previewSourceWidth={wizardState.previewSourceWidth}
                previewSourceHeight={wizardState.previewSourceHeight}
                onClose={onClose}
                onConfirm={onConfirm}
                onRadiusChange={onMaskRadiusChange}
                onRadiusCommit={onMaskRadiusCommit}
                onSelectedIndexChange={onMaskRadiusSelectedIndexChange}
            />
        );
    }

    if (wizardState.kind === "mask_radii") {
        return (
            <MaskRadiiDialog
                open={wizardState.open}
                title={wizardState.title}
                innerRadius={wizardState.innerRadius}
                outerRadius={wizardState.outerRadius}
                innerMin={wizardState.innerMin}
                outerMin={wizardState.outerMin}
                max={wizardState.max}
                step={wizardState.step}
                innerRadiusAngstrom={wizardState.innerRadiusAngstrom}
                outerRadiusAngstrom={wizardState.outerRadiusAngstrom}
                samplingRate={wizardState.samplingRate}
                selectedIndex={wizardState.selectedIndex}
                items={wizardState.items}
                message={wizardState.message}
                previewUrl={wizardState.previewUrl}
                previewCaption={wizardState.previewCaption}
                previewSourceWidth={wizardState.previewSourceWidth}
                previewSourceHeight={wizardState.previewSourceHeight}
                primaryParamName={wizardState.paramName}
                secondaryParamName={wizardState.secondaryParamName}
                onClose={onClose}
                onConfirm={onConfirm}
                onInnerRadiusChange={onMaskRadiiInnerChange}
                onInnerRadiusCommit={onMaskRadiiInnerCommit}
                onOuterRadiusChange={onMaskRadiiOuterChange}
                onOuterRadiusCommit={onMaskRadiiOuterCommit}
                onSelectedIndexChange={onMaskRadiiSelectedIndexChange}
            />
        );
    }

    if (wizardState.kind === "ctf_preview") {
        return (
            <CtfPreviewDialog
                open={wizardState.open}
                title={wizardState.title}
                message={wizardState.message}
                items={wizardState.items}
                selectedIndex={wizardState.selectedIndex}
                onSelectedIndexChange={onCtfSelectedIndexChange}
                micrographPreviewUrl={wizardState.micrographPreviewUrl}
                psdPreviewUrl={wizardState.psdPreviewUrl}
                previewLoading={previewLoading}
                downsample={wizardState.downsample}
                downsampleMin={wizardState.downsampleMin}
                downsampleMax={wizardState.downsampleMax}
                downsampleStep={wizardState.downsampleStep}
                autoDownsampling={wizardState.autoDownsampling}
                autoDownsampleValue={wizardState.autoDownsampleValue}
                lowFreq={wizardState.lowFreq}
                lowFreqMin={wizardState.lowFreqMin}
                lowFreqMax={wizardState.lowFreqMax}
                highFreq={wizardState.highFreq}
                highFreqMin={wizardState.highFreqMin}
                highFreqMax={wizardState.highFreqMax}
                freqStep={wizardState.freqStep}
                samplingRate={wizardState.samplingRate}
                showInAngstroms={wizardState.showInAngstroms}
                downsampleParamName={wizardState.downsampleParamName}
                lowFreqParamName={wizardState.lowFreqParamName}
                highFreqParamName={wizardState.highFreqParamName}
                onClose={onClose}
                onConfirm={onConfirm}
                onDownsampleChange={onCtfDownsampleChange}
                onDownsampleCommit={onCtfDownsampleCommit}
                onLowFreqChange={onCtfLowFreqChange}
                onLowFreqCommit={onCtfLowFreqCommit}
                onHighFreqChange={onCtfHighFreqChange}
                onHighFreqCommit={onCtfHighFreqCommit}
            />
        );
    }

    if (wizardState.kind === "filter_preview") {
        return (
            <FilterPreviewDialog
                open={wizardState.open}
                title={wizardState.title}
                message={wizardState.message}
                items={wizardState.items}
                selectedIndex={wizardState.selectedIndex}
                onSelectedIndexChange={onFilterSelectedIndexChange}
                originalPreviewUrl={wizardState.originalPreviewUrl}
                filteredPreviewUrl={wizardState.filteredPreviewUrl}
                previewLoading={previewLoading}
                lowFreq={wizardState.lowFreq}
                lowFreqMin={wizardState.lowFreqMin}
                lowFreqMax={wizardState.lowFreqMax}
                highFreq={wizardState.highFreq}
                highFreqMin={wizardState.highFreqMin}
                highFreqMax={wizardState.highFreqMax}
                decay={wizardState.decay}
                decayMin={wizardState.decayMin}
                decayMax={wizardState.decayMax}
                freqStep={wizardState.freqStep}
                unitLabel={wizardState.unitLabel}
                filterMode={wizardState.filterMode}
                lowFreqParamName={wizardState.lowFreqParamName}
                highFreqParamName={wizardState.highFreqParamName}
                decayParamName={wizardState.decayParamName}
                onClose={onClose}
                onConfirm={onConfirm}
                onLowFreqChange={onFilterLowFreqChange}
                onLowFreqCommit={onFilterLowFreqCommit}
                onHighFreqChange={onFilterHighFreqChange}
                onHighFreqCommit={onFilterHighFreqCommit}
                onDecayChange={onFilterDecayChange}
                onDecayCommit={onFilterDecayCommit}
            />
        );
    }

    if (wizardState.kind === "downsample_preview") {
        return (
            <DownsamplePreviewDialog
                open={wizardState.open}
                title={wizardState.title}
                message={wizardState.message}
                items={wizardState.items}
                selectedIndex={wizardState.selectedIndex}
                onSelectedIndexChange={onDownsamplePreviewSelectedIndexChange}
                micrographPreviewUrl={wizardState.micrographPreviewUrl}
                psdPreviewUrl={wizardState.psdPreviewUrl}
                previewLoading={previewLoading}
                downsample={wizardState.downsample}
                downsampleMin={wizardState.downsampleMin}
                downsampleMax={wizardState.downsampleMax}
                downsampleStep={wizardState.downsampleStep}
                downsampleParamName={wizardState.downsampleParamName}
                onClose={onClose}
                onConfirm={onConfirm}
                onDownsampleChange={onDownsamplePreviewChange}
                onDownsampleCommit={onDownsamplePreviewCommit}
            />
        );
    }

    if (wizardState.kind === "point_in_volume") {
        return (
            <PointInVolumeWizardDialog
                open={wizardState.open}
                title={wizardState.title}
                message={wizardState.message}
                dims={wizardState.dims}
                previewDims={wizardState.previewDims}
                previewValues={wizardState.previewValues}
                point={wizardState.point}
                pointVoxel={wizardState.pointVoxel}
                onClose={onClose}
                onConfirm={onConfirm}
                onPointChange={onPointInVolumeChange}
                onPointVoxelChange={onPointInVolumeVoxelChange}
            />
        );
    }

    return null;
}