"use client";

import * as React from "react";
import { motion, type Variants } from "motion/react";

import { cn } from "@/lib/utils";

type AnimatedGroupProps = {
  children: React.ReactNode;
  className?: string;
  /**
   * Overrides for the stagger container and for each child. Pass `item` to
   * animate blur/scale alongside the fade; the container only orchestrates.
   */
  variants?: {
    container?: Variants;
    item?: Variants;
  };
};

const containerVariants: Variants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: { delayChildren: 0.06, staggerChildren: 0.09 },
  },
};

const itemVariants: Variants = {
  hidden: { opacity: 0, y: 12 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { type: "spring", bounce: 0.2, duration: 0.9 },
  },
};

/**
 * Reveals direct children one after another. Each child gets its own motion
 * wrapper because a variant label only reaches the immediate children of the
 * element that owns it — a plain <div> in between would break the chain.
 */
export function AnimatedGroup({
  children,
  className,
  variants,
}: AnimatedGroupProps) {
  return (
    <motion.div
      className={cn("flex flex-col items-center", className)}
      initial="hidden"
      animate="visible"
      variants={variants?.container ?? containerVariants}
    >
      {React.Children.toArray(children).map((child, index) => (
        <motion.div
          // The child list is static, so position is a stable identity here.
          key={index}
          className="flex w-full justify-center"
          variants={variants?.item ?? itemVariants}
        >
          {child}
        </motion.div>
      ))}
    </motion.div>
  );
}
