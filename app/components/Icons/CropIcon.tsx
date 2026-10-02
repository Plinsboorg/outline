import * as React from "react";

type Props = {
  /** Icon size in pixels. */
  size?: number;
  /** Icon color. */
  color?: string;
  className?: string;
};

/**
 * Crop icon, matching the outline-icons visual style.
 */
export function CropIcon({
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
      <path d="M6 2v14a2 2 0 0 0 2 2h14" />
      <path d="M18 22V8a2 2 0 0 0-2-2H2" />
    </svg>
  );
}
