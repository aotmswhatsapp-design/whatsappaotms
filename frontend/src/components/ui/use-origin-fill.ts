"use client";

import * as React from "react";

/**
 * The circle has to be large enough to cover the surface from wherever the
 * pointer entered, so its diameter is twice the distance to the farthest
 * corner.
 */
export function getCoverDiameter(
  width: number,
  height: number,
  x: number,
  y: number,
): number {
  return Math.ceil(
    2 *
      Math.max(
        Math.hypot(x, y),
        Math.hypot(width - x, y),
        Math.hypot(x, height - y),
        Math.hypot(width - x, height - y),
      ),
  );
}

export interface OriginFillOptions {
  /**
   * Wire the fill to the surface's own pointer and keyboard focus. Native
   * listeners are used instead of `onPointerEnter` props so the hook can be
   * dropped on controls that already own those props (Radix triggers, for
   * example) without the two handlers fighting each other.
   */
  hover?: boolean;
}

export interface OriginFill {
  /** Stable callback ref — assign it to the surface that owns the fill. */
  setNode: (node: HTMLElement | null) => void;
  origin: { x: number; y: number };
  coverSize: number;
  /** True while the surface should stay filled. */
  active: boolean;
  setActive: (active: boolean) => void;
  /** Grow the circle from wherever the pointer entered. */
  moveToPointer: (event: React.PointerEvent<HTMLElement>) => void;
  /** Keyboard focus has no pointer, so it grows from the centre. */
  moveToCenter: () => void;
}

/**
 * Shared core of the "Start with a plan" hover: a circle that expands from the
 * pointer to fill the control. Consumers own the colour and the transition;
 * this only tracks geometry and whether the fill is showing.
 */
export function useOriginFill({
  hover = false,
}: OriginFillOptions = {}): OriginFill {
  const nodeRef = React.useRef<HTMLElement | null>(null);
  const [active, setActive] = React.useState(false);
  const [origin, setOrigin] = React.useState({ x: 0, y: 0 });
  const [coverSize, setCoverSize] = React.useState(0);

  const setNode = React.useCallback((node: HTMLElement | null) => {
    nodeRef.current = node;
  }, []);

  const updateOrigin = React.useCallback((x: number, y: number) => {
    const node = nodeRef.current;
    if (!node) return;

    const rect = node.getBoundingClientRect();
    setOrigin({ x, y });
    setCoverSize(getCoverDiameter(rect.width, rect.height, x, y));
  }, []);

  const moveToPointer = React.useCallback(
    (event: React.PointerEvent<HTMLElement>) => {
      const rect = event.currentTarget.getBoundingClientRect();
      updateOrigin(event.clientX - rect.left, event.clientY - rect.top);
    },
    [updateOrigin],
  );

  const moveToCenter = React.useCallback(() => {
    const node = nodeRef.current;
    if (!node) return;

    const rect = node.getBoundingClientRect();
    updateOrigin(rect.width / 2, rect.height / 2);
  }, [updateOrigin]);

  React.useEffect(() => {
    if (!hover) return;

    // The callback ref has already run by the time effects fire, and it is
    // referentially stable, so `nodeRef.current` is the mounted surface.
    const node = nodeRef.current;
    if (!node) return;

    const onPointerEnter = (event: PointerEvent) => {
      const rect = node.getBoundingClientRect();
      updateOrigin(event.clientX - rect.left, event.clientY - rect.top);
      setActive(true);
    };

    const onPointerLeave = () => setActive(false);

    const onFocus = () => {
      // Only keyboard focus should light the surface up; a mouse click also
      // focuses, but the pointer handlers already cover that case.
      if (!node.matches(":focus-visible")) return;
      const rect = node.getBoundingClientRect();
      updateOrigin(rect.width / 2, rect.height / 2);
      setActive(true);
    };

    const onBlur = () => setActive(false);

    node.addEventListener("pointerenter", onPointerEnter);
    node.addEventListener("pointerleave", onPointerLeave);
    node.addEventListener("focus", onFocus);
    node.addEventListener("blur", onBlur);

    return () => {
      node.removeEventListener("pointerenter", onPointerEnter);
      node.removeEventListener("pointerleave", onPointerLeave);
      node.removeEventListener("focus", onFocus);
      node.removeEventListener("blur", onBlur);
    };
  }, [hover, updateOrigin]);

  // Web fonts and layout changes can resize the surface after the first paint;
  // without re-measuring, the circle would stop short of the edges.
  React.useLayoutEffect(() => {
    const node = nodeRef.current;
    if (!(node && active)) return;

    const measure = () => {
      const rect = node.getBoundingClientRect();
      setCoverSize(
        getCoverDiameter(rect.width, rect.height, origin.x, origin.y),
      );
    };

    measure();

    const observer = new ResizeObserver(measure);
    observer.observe(node);

    const fonts = document.fonts;
    if (fonts?.ready) {
      fonts.ready.then(measure).catch(() => undefined);
    }

    return () => observer.disconnect();
  }, [active, origin.x, origin.y]);

  return {
    setNode,
    origin,
    coverSize,
    active,
    setActive,
    moveToPointer,
    moveToCenter,
  };
}
