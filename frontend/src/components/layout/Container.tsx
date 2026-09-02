import React from "react";
import { clsx } from "clsx";
import { twMerge } from "tailwind-merge";

interface ContainerProps extends React.HTMLAttributes<HTMLDivElement> {
  size?: "sm" | "md" | "lg" | "xl" | "full";
}

export function Container({
  className,
  size = "lg",
  children,
  ...props
}: ContainerProps) {
  const sizeClasses = {
    sm: "max-w-3xl",
    md: "max-w-5xl",
    lg: "max-w-7xl",
    xl: "max-w-(--breakpoint-2xl)",
    full: "max-w-full",
  };

  return (
    <div
      className={twMerge(
        clsx("mx-auto w-full px-4 sm:px-6 lg:px-8", sizeClasses[size], className)
      )}
      {...props}
    >
      {children}
    </div>
  );
}
