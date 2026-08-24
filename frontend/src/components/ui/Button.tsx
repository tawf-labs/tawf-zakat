import React from "react";
import { clsx } from "clsx";
import { twMerge } from "tailwind-merge";

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "secondary" | "outline" | "ghost";
  size?: "sm" | "md" | "lg";
}

export function Button({
  className,
  variant = "primary",
  size = "md",
  children,
  ...props
}: ButtonProps) {
  const baseStyles =
    "inline-flex items-center justify-center font-medium rounded-full transition-all duration-200 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed uppercase tracking-wider text-xs focus:outline-none";

  const sizeStyles = {
    sm: "px-4 py-2 text-[11px]",
    md: "px-6 py-2.5 text-xs",
    lg: "px-8 py-3.5 text-sm",
  };

  const variantStyles = {
    primary:
      "bg-[#0F3D30] text-[#F9F6F0] hover:bg-[#1A5242] shadow-sm hover:shadow active:scale-[0.99]",
    secondary:
      "bg-[#C5A869] text-[#1A1A1A] hover:bg-[#A68B4F] shadow-sm active:scale-[0.99]",
    outline:
      "bg-transparent text-[#0F3D30] border border-[#0F3D30]/20 hover:bg-[#0F3D30]/5 active:scale-[0.99]",
    ghost: "bg-transparent text-[#0F3D30] hover:bg-[#0F3D30]/5",
  };

  return (
    <button
      className={twMerge(clsx(baseStyles, sizeStyles[size], variantStyles[variant], className))}
      {...props}
    >
      {children}
    </button>
  );
}
