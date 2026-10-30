import {
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
  type ElementType,
  type ReactNode,
  type Ref,
} from "react";
import { Tooltip, type TooltipProps } from "@mui/material";

const TOOLTIP_SX = {
  maxWidth: 560,
  whiteSpace: "pre-wrap" as const,
  wordBreak: "break-word" as const,
  fontSize: "0.95rem",
  lineHeight: 1.35,
};

type OverflowTooltipTextProps = {
  text: string;
  className?: string;
  as?: ElementType;
  placement?: TooltipProps["placement"];
  /** Show tooltip even when the rendered text is not clipped. */
  alwaysTooltip?: boolean;
  /** Also show tooltip when text length reaches this threshold. */
  minLengthForTooltip?: number;
  children?: ReactNode;
};

export default function OverflowTooltipText({
  text,
  className,
  as: Tag = "span",
  placement = "top",
  alwaysTooltip = false,
  minLengthForTooltip = 0,
  children,
}: OverflowTooltipTextProps) {
  const ref = useRef<HTMLElement | null>(null);
  const [overflowing, setOverflowing] = useState(false);

  const checkOverflow = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    setOverflowing(
      el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 1,
    );
  }, []);

  useLayoutEffect(() => {
    checkOverflow();
  }, [text, className, checkOverflow]);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === "undefined") return;

    const observer = new ResizeObserver(() => checkOverflow());
    observer.observe(el);
    return () => observer.disconnect();
  }, [checkOverflow]);

  const showTooltip =
    Boolean(text) &&
    (alwaysTooltip ||
      overflowing ||
      text.length >= minLengthForTooltip ||
      text.includes("\n"));

  const node = (
    <Tag ref={ref as Ref<HTMLElement>} className={className}>
      {children ?? text}
    </Tag>
  );

  if (!showTooltip) return node;

  return (
    <Tooltip
      title={text}
      placement={placement}
      arrow
      enterDelay={300}
      slotProps={{
        popper: { sx: { zIndex: 26000 } },
        tooltip: { sx: TOOLTIP_SX },
      }}
    >
      {node}
    </Tooltip>
  );
}
