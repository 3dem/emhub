import type { ComponentType, SVGProps } from "react";

import { BoxCubeIcon, TiltSeriesIcon } from "@/icons";

/**
 * Icons that the host can name in TableViewerAction.icon.  An action with a
 * known icon is drawn as an icon button (its label as tooltip); an unknown
 * name falls back to the text label.
 */
const TABLE_VIEWER_ACTION_ICONS: Record<
    string,
    ComponentType<SVGProps<SVGSVGElement>>
> = {
    "tilt-series": TiltSeriesIcon,
    tomogram: BoxCubeIcon,
};

export function getTableViewerActionIcon(name?: string) {
    return name ? TABLE_VIEWER_ACTION_ICONS[name] : undefined;
}
