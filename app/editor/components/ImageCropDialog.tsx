import * as React from "react";
import { useTranslation } from "react-i18next";
import styled from "styled-components";
import Button from "~/components/Button";
import Flex from "~/components/Flex";
import useStores from "~/hooks/useStores";

/** The cropped result, in the natural pixel size of the source image. */
export interface CropResult {
  /** The cropped image file. */
  file: File;
  /** Natural width of the original image. */
  naturalWidth: number;
  /** Natural height of the original image. */
  naturalHeight: number;
  /** Width of the cropped area in natural pixels. */
  width: number;
  /** Height of the cropped area in natural pixels. */
  height: number;
}

interface Props {
  /** URL of the image to crop. */
  src: string;
  /** Callback fired with the cropped file when the user applies the crop. */
  onSubmit: (result: CropResult) => void;
}

/** Crop rectangle as fractions (0–1) of the displayed image. */
interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

type Handle = "move" | "n" | "s" | "e" | "w" | "nw" | "ne" | "sw" | "se";

const MinSize = 0.05;
const HANDLES: Handle[] = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];

const clamp = (value: number, min: number, max: number) =>
  Math.min(Math.max(value, min), max);

/**
 * Applies a drag delta (in image fractions) to a rect for the given handle.
 *
 * @param start - the rect when the drag started.
 * @param handle - the handle being dragged.
 * @param dx - horizontal movement as a fraction of image width.
 * @param dy - vertical movement as a fraction of image height.
 * @returns the new rect, constrained to the image bounds.
 */
function applyDrag(start: Rect, handle: Handle, dx: number, dy: number): Rect {
  if (handle === "move") {
    return {
      ...start,
      x: clamp(start.x + dx, 0, 1 - start.w),
      y: clamp(start.y + dy, 0, 1 - start.h),
    };
  }

  let left = start.x;
  let top = start.y;
  let right = start.x + start.w;
  let bottom = start.y + start.h;

  if (handle.includes("w")) {
    left = clamp(left + dx, 0, right - MinSize);
  }
  if (handle.includes("e")) {
    right = clamp(right + dx, left + MinSize, 1);
  }
  if (handle.includes("n")) {
    top = clamp(top + dy, 0, bottom - MinSize);
  }
  if (handle.includes("s")) {
    bottom = clamp(bottom + dy, top + MinSize, 1);
  }

  return { x: left, y: top, w: right - left, h: bottom - top };
}

/**
 * Dialog content that lets the user draw a free-form crop rectangle over an
 * image and returns the cropped result as a new image file.
 */
export function ImageCropDialog({ src, onSubmit }: Props) {
  const { t } = useTranslation();
  const { dialogs } = useStores();
  const [objectUrl, setObjectUrl] = React.useState<string>();
  const [hasError, setHasError] = React.useState(false);
  const [blob, setBlob] = React.useState<Blob>();
  const [rect, setRect] = React.useState<Rect>({ x: 0, y: 0, w: 1, h: 1 });
  const [isSaving, setIsSaving] = React.useState(false);
  const imageRef = React.useRef<HTMLImageElement>(null);
  const dragRef = React.useRef<{
    handle: Handle;
    startX: number;
    startY: number;
    rect: Rect;
  } | null>(null);

  // Fetch as a blob so the canvas is never tainted by cross-origin data.
  React.useEffect(() => {
    let url: string | undefined;
    let cancelled = false;

    fetch(src)
      .then((response) => response.blob())
      .then((data) => {
        if (cancelled) {
          return;
        }
        url = URL.createObjectURL(data);
        setBlob(data);
        setObjectUrl(url);
      })
      .catch(() => setHasError(true));

    return () => {
      cancelled = true;
      if (url) {
        URL.revokeObjectURL(url);
      }
    };
  }, [src]);

  const handlePointerDown = (handle: Handle) => (ev: React.PointerEvent) => {
    ev.preventDefault();
    ev.stopPropagation();
    ev.currentTarget.setPointerCapture(ev.pointerId);
    dragRef.current = {
      handle,
      startX: ev.clientX,
      startY: ev.clientY,
      rect,
    };
  };

  const handlePointerMove = (ev: React.PointerEvent) => {
    const drag = dragRef.current;
    const bounds = imageRef.current?.getBoundingClientRect();
    if (!drag || !bounds || !bounds.width || !bounds.height) {
      return;
    }
    setRect(
      applyDrag(
        drag.rect,
        drag.handle,
        (ev.clientX - drag.startX) / bounds.width,
        (ev.clientY - drag.startY) / bounds.height
      )
    );
  };

  const handlePointerUp = () => {
    dragRef.current = null;
  };

  const handleSubmit = async () => {
    const image = imageRef.current;
    if (!image || !blob) {
      return;
    }

    setIsSaving(true);
    try {
      const { naturalWidth, naturalHeight } = image;
      const sx = Math.round(rect.x * naturalWidth);
      const sy = Math.round(rect.y * naturalHeight);
      const width = Math.max(1, Math.round(rect.w * naturalWidth));
      const height = Math.max(1, Math.round(rect.h * naturalHeight));

      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext("2d");
      if (!context) {
        throw new Error("Canvas is not supported");
      }
      context.drawImage(image, sx, sy, width, height, 0, 0, width, height);

      // Keep lossless formats lossless, everything else becomes a PNG.
      const type = blob.type === "image/jpeg" ? "image/jpeg" : "image/png";
      const cropped = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, type, 0.92)
      );
      if (!cropped) {
        throw new Error("Failed to crop image");
      }

      const extension = type === "image/jpeg" ? "jpg" : "png";
      onSubmit({
        file: new File([cropped], `cropped-image.${extension}`, { type }),
        naturalWidth,
        naturalHeight,
        width,
        height,
      });
      dialogs.closeAllModals();
    } catch {
      setHasError(true);
      setIsSaving(false);
    }
  };

  const isUnchanged =
    rect.x === 0 && rect.y === 0 && rect.w === 1 && rect.h === 1;

  return (
    <Flex column gap={16}>
      {hasError ? (
        <Message role="alert">{t("This image could not be cropped")}</Message>
      ) : (
        <Stage>
          {objectUrl ? (
            <Frame>
              <Img
                ref={imageRef}
                src={objectUrl}
                alt=""
                draggable={false}
                onError={() => setHasError(true)}
              />
              <CropBox
                role="group"
                aria-label={t("Crop area")}
                style={{
                  left: `${rect.x * 100}%`,
                  top: `${rect.y * 100}%`,
                  width: `${rect.w * 100}%`,
                  height: `${rect.h * 100}%`,
                }}
                onPointerDown={handlePointerDown("move")}
                onPointerMove={handlePointerMove}
                onPointerUp={handlePointerUp}
                onPointerCancel={handlePointerUp}
              >
                {HANDLES.map((handle) => (
                  <HandleDot
                    key={handle}
                    $handle={handle}
                    onPointerDown={handlePointerDown(handle)}
                    onPointerMove={handlePointerMove}
                    onPointerUp={handlePointerUp}
                    onPointerCancel={handlePointerUp}
                  />
                ))}
              </CropBox>
            </Frame>
          ) : (
            <Message>{t("Loading")}…</Message>
          )}
        </Stage>
      )}
      <Flex justify="flex-end" gap={8}>
        <Button type="button" onClick={dialogs.closeAllModals} neutral>
          {t("Cancel")}
        </Button>
        <Button
          type="button"
          onClick={handleSubmit}
          disabled={!objectUrl || hasError || isUnchanged || isSaving}
        >
          {isSaving ? `${t("Saving")}…` : t("Apply")}
        </Button>
      </Flex>
    </Flex>
  );
}

const Stage = styled.div`
  display: flex;
  justify-content: center;
  align-items: center;
  max-height: 60vh;
  background: ${(props) => props.theme.backgroundSecondary};
  border-radius: 8px;
  padding: 12px;
  overflow: hidden;
`;

const Frame = styled.div`
  position: relative;
  display: inline-block;
  line-height: 0;
  touch-action: none;
  user-select: none;
`;

const Img = styled.img`
  display: block;
  max-width: 100%;
  max-height: calc(60vh - 24px);
  pointer-events: none;
`;

const CropBox = styled.div`
  position: absolute;
  border: 2px solid #fff;
  outline: 1px solid rgba(0, 0, 0, 0.5);
  box-shadow: 0 0 0 9999px rgba(0, 0, 0, 0.55);
  cursor: move;
  touch-action: none;
`;

const HandleDot = styled.div<{ $handle: Handle }>`
  position: absolute;
  width: 14px;
  height: 14px;
  background: #fff;
  border: 1px solid rgba(0, 0, 0, 0.6);
  border-radius: 50%;
  touch-action: none;

  /* Enlarge the touch target without changing the visual size. */
  &::after {
    content: "";
    position: absolute;
    inset: -10px;
  }

  ${(props) => {
    const h = props.$handle;
    const horizontal = h.includes("w")
      ? "left: -8px;"
      : h.includes("e")
        ? "right: -8px;"
        : "left: calc(50% - 7px);";
    const vertical = h.includes("n")
      ? "top: -8px;"
      : h.includes("s")
        ? "bottom: -8px;"
        : "top: calc(50% - 7px);";
    const cursor =
      h === "n" || h === "s"
        ? "ns-resize"
        : h === "e" || h === "w"
          ? "ew-resize"
          : h === "nw" || h === "se"
            ? "nwse-resize"
            : "nesw-resize";
    return `${horizontal} ${vertical} cursor: ${cursor};`;
  }}
`;

const Message = styled.div`
  padding: 24px;
  text-align: center;
  color: ${(props) => props.theme.textTertiary};
`;
