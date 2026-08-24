import React from "react";
import { clsx } from "clsx";
import { twMerge } from "tailwind-merge";

interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  elevated?: boolean;
}

export function Card({ className, elevated = false, children, ...props }: CardProps) {
  return (
    <div
      className={twMerge(
        clsx(
          "bg-white rounded-2xl border border-[#0F3D30]/10 p-6 md:p-8 transition-shadow",
          elevated ? "shadow-md hover:shadow-lg" : "shadow-sm",
          className
        )
      )}
      {...props}
    >
      {children}
    </div>
  );
}
