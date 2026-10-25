import { useEffect, useMemo, useRef, useState } from "react";
import {
  Box,
  Button,
  ButtonGroup,
  Menu,
  MenuItem,
  Tooltip,
  CircularProgress,
  Typography,
  ListItemIcon,
} from "@mui/material";
import ArrowDropDownIcon from "@mui/icons-material/ArrowDropDown";
import SettingsIcon from "@mui/icons-material/Settings";
import RocketLaunchIcon from "@mui/icons-material/RocketLaunch";
import RestartAltIcon from "@mui/icons-material/RestartAlt";
import HelpOutlineIcon from "@mui/icons-material/HelpOutline";
import { ScheduleRounded, StopOutlined } from "@mui/icons-material";

export type ExecuteModeInfo = {
  label?: string;
  help?: string;
};

export type ExecuteModeMap = Record<string, ExecuteModeInfo>;

type ExecuteModeButtonProps = {
  executeModeMap: ExecuteModeMap | null | undefined;
  selectedMode: string | null | undefined;
  onSelectedModeChange: (modeKey: string) => void;
  onExecute: (modeKey: string) => void;
  disabled?: boolean;
  loading?: boolean;
  tooltipFontSize?: string | number;
};

function getExecuteModeIcon(modeKey: string) {
  const key = (modeKey || "").toLowerCase();
  if (key === "launch") return <RocketLaunchIcon fontSize="small" />;
  if (key === "restart") return <RestartAltIcon fontSize="small" />;
  if (key === "schedule") return <ScheduleRounded fontSize="small" />;
  if (key === "stop") return <StopOutlined fontSize="small" />;
  return <SettingsIcon fontSize="small" />;
}

export default function ExecuteModeButton(props: ExecuteModeButtonProps) {
  const {
    executeModeMap,
    selectedMode,
    onSelectedModeChange,
    onExecute,
    disabled,
    loading,
    tooltipFontSize,
  } = props;

  const [anchorEl, setAnchorEl] = useState<null | HTMLElement>(null);
  const menuOpen = Boolean(anchorEl);

  // preventInstantTooltipOnMenuOpen
  const [tooltipsEnabled, setTooltipsEnabled] = useState(true);
  const tooltipTimerRef = useRef<number | null>(null);

  useEffect(() => {
    // cleanupTooltipTimer
    return () => {
      if (tooltipTimerRef.current != null) {
        window.clearTimeout(tooltipTimerRef.current);
        tooltipTimerRef.current = null;
      }
    };
  }, []);

  const entries = useMemo(() => {
    const raw = executeModeMap ?? {};
    return Object.entries(raw);
  }, [executeModeMap]);

  const resolvedSelectedMode = useMemo(() => {
    if (selectedMode && executeModeMap && executeModeMap[selectedMode]) return selectedMode;
    if (entries.length > 0) return entries[0][0];
    return "launch";
  }, [selectedMode, executeModeMap, entries]);

  const selectedInfo = executeModeMap?.[resolvedSelectedMode] ?? {};
  const selectedLabel = selectedInfo.label || resolvedSelectedMode;

  const hasModes = entries.length > 0;
  const isDisabled = Boolean(disabled) || Boolean(loading) || !hasModes;

  const tooltipSx = useMemo(() => {
    return {
      fontSize: tooltipFontSize ?? "0.95rem",
      lineHeight: 1.35,
      maxWidth: 420,
      whiteSpace: "pre-wrap",
    };
  }, [tooltipFontSize]);

  const handleExecuteClick = () => {
    // executeSelectedMode
    if (isDisabled) return;
    onExecute(resolvedSelectedMode);
  };

  const handleOpenMenu = (evt: React.MouseEvent<HTMLElement>) => {
    // openModesMenuOnly
    if (isDisabled) return;

    // disableTooltipsBrieflySoTheyDontAutoPop
    setTooltipsEnabled(false);
    if (tooltipTimerRef.current != null) {
      window.clearTimeout(tooltipTimerRef.current);
      tooltipTimerRef.current = null;
    }
    tooltipTimerRef.current = window.setTimeout(() => {
      setTooltipsEnabled(true);
      tooltipTimerRef.current = null;
    }, 180);

    setAnchorEl(evt.currentTarget);
  };

  const handleCloseMenu = () => {
    // closeModesMenu
    setAnchorEl(null);
  };

  const handlePickModeAndExecute = (modeKey: string) => {
    // pickModeAndExecuteImmediately
    if (isDisabled) return;
    onSelectedModeChange(modeKey);
    handleCloseMenu();
    onExecute(modeKey);
  };

  return (
    <Box sx={{ display: "inline-flex", alignItems: "center" }}>
      <ButtonGroup
        variant="contained"
        color="success"
        disableElevation
        aria-label="execute split button"
        sx={{
          "& .MuiButtonGroup-grouped": { textTransform: "none" },
        }}
      >
        {/* actionButton */}
        <Button
          disabled={isDisabled}
          onClick={handleExecuteClick}
          startIcon={
            loading ? (
              <CircularProgress size={16} color="inherit" />
            ) : (
              getExecuteModeIcon(resolvedSelectedMode)
            )
          }
          sx={{
            borderTopRightRadius: 0,
            borderBottomRightRadius: 0,
            pr: 1.25,
          }}
        >
          {selectedLabel}
        </Button>

        {/* toggleButton */}
        <Button
          disabled={isDisabled}
          onClick={handleOpenMenu}
          aria-haspopup="menu"
          aria-expanded={menuOpen ? "true" : undefined}
          sx={{
            borderTopLeftRadius: 0,
            borderBottomLeftRadius: 0,
            minWidth: 42,
            px: 0.5,
            borderLeft: "1px solid rgba(255,255,255,0.25)",
          }}
        >
          <ArrowDropDownIcon fontSize="small" />
        </Button>
      </ButtonGroup>

      <Menu
        anchorEl={anchorEl}
        open={menuOpen}
        onClose={handleCloseMenu}
        anchorOrigin={{ vertical: "top", horizontal: "right" }}
        transformOrigin={{ vertical: "bottom", horizontal: "right" }}
        marginThreshold={8}
        slotProps={{
          paper: {
            sx: {
              maxHeight: "min(360px, calc(100vh - 96px))",
              overflowY: "auto",
              mb: 0.75,
            },
          },
        }}
        MenuListProps={{
          sx: { py: 0.5 },
        }}
      >
        {entries.map(([modeKey, modeInfo]) => {
          const label = modeInfo?.label || modeKey;
          const help = modeInfo?.help || "No help available for this mode.";

          return (
            <MenuItem
              key={modeKey}
              selected={modeKey === resolvedSelectedMode}
              onClick={() => handlePickModeAndExecute(modeKey)}
              sx={{
                minWidth: 340,
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 2,
              }}
            >
              <Box sx={{ display: "flex", alignItems: "center", gap: 1.25, minWidth: 0 }}>
                <ListItemIcon sx={{ minWidth: 34 }}>
                  {getExecuteModeIcon(modeKey)}
                </ListItemIcon>

                <Typography
                  variant="body2"
                  sx={{
                    fontSize: "0.95rem",
                    fontWeight: 500,
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                  }}
                >
                  {label}
                </Typography>
              </Box>

              <Tooltip
                title={help}
                placement="right"
                arrow
                enterDelay={350}
                disableHoverListener={!tooltipsEnabled}
                disableFocusListener
                disableTouchListener
                slotProps={{ tooltip: { sx: tooltipSx } }}
              >
                <Box
                  component="span"
                  role="button"
                  tabIndex={0}
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                  }}
                  onKeyDown={(e) => {
                    e.stopPropagation();
                  }}
                  sx={{
                    display: "inline-flex",
                    alignItems: "center",
                    cursor: "default",
                    opacity: 0.9,
                  }}
                >
                  <HelpOutlineIcon fontSize="small" />
                </Box>
              </Tooltip>
            </MenuItem>
          );
        })}
      </Menu>
    </Box>
  );
}
