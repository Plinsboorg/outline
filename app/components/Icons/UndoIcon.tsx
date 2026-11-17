import * as React from "react";

type Props = {
  /** Icon size in pixels. */
  size?: number;
  /** Icon color. */
  color?: string;
  className?: string;
};

/**
 * Undo icon, matching the outline-icons visual style.
 */
export function UndoIcon({
  size = 24,
  color = "currentColor",
  className,
}: Props) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <path d="M9 14 4 9l5-5" />
      <path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11" />
    </svg>
  );
}
