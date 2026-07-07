"use client";

import { useEffect } from "react";
import {
  useMotionValue,
  useSpring,
  useTransform,
  useReducedMotion,
  motion,
} from "framer-motion";
import { formatNumber } from "../../../utils/format";

interface AnimatedNumberProps {
  value: number;
  /** Formats the interpolated numeric value. Defaults to `formatNumber` (grouped integers). */
  format?: (n: number) => string;
  /** Spring duration in seconds. Default 0.18 (180 ms, within the 100–200 ms spec range). */
  duration?: number;
  className?: string;
}

/**
 * Count-up animation component for numeric dashboard values.
 *
 * Uses Framer Motion `useMotionValue` + `useSpring` to smoothly interpolate
 * between values. Formatting is applied via `useTransform` so the DOM is only
 * updated when the animation produces a distinct formatted string.
 *
 * Respects `prefers-reduced-motion` — renders the final value directly when
 * the user has requested reduced motion.
 */
export function AnimatedNumber({
  value,
  format = formatNumber,
  duration = 0.18,
  className,
}: AnimatedNumberProps) {
  const prefersReducedMotion = useReducedMotion();
  const motionValue = useMotionValue(value);
  const springValue = useSpring(motionValue, { duration, bounce: 0 });

  // Push the target value into the motion value whenever it changes.
  useEffect(() => {
    motionValue.set(value);
  }, [value, motionValue]);

  const formatted = useTransform(springValue, (v) => format(v));

  // When the user prefers reduced motion, skip the spring entirely.
  if (prefersReducedMotion) {
    return <span className={className}>{format(value)}</span>;
  }

  return <motion.span className={className}>{formatted}</motion.span>;
}
