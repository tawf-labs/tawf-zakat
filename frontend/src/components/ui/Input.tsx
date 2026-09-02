import React from "react";
import { clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
  helperText?: string;
  leftAddon?: React.ReactNode;
  rightAddon?: React.ReactNode;
}

export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, label, error, helperText, leftAddon, rightAddon, id, ...props }, ref) => {
    const inputId = id || (label ? label.toLowerCase().replace(/\s+/g, "-") : undefined);

    return (
      <div className="w-full flex flex-col gap-1.5">
        {label && (
          <label htmlFor={inputId} className="text-xs font-semibold uppercase tracking-wider text-[#17332c]">
            {label}
          </label>
        )}
        <div className="relative flex items-center">
          {leftAddon && (
            <div className="absolute left-3.5 flex items-center pointer-events-none text-[#5e7a70] text-sm">
              {leftAddon}
            </div>
          )}
          <input
            id={inputId}
            ref={ref}
            className={twMerge(
              clsx(
                "w-full rounded-xl border bg-white px-4 py-2.5 text-sm text-[#17332c] placeholder:text-[#5e7a70]/50 transition-all duration-200 outline-none",
                "border-[#dbe7dd] focus:border-[#1b765e] focus:ring-2 focus:ring-[#1b765e]/15",
                leftAddon && "pl-10",
                rightAddon && "pr-10",
                error && "border-rose-400 focus:border-rose-500 focus:ring-rose-500/15",
                props.disabled && "opacity-50 cursor-not-allowed bg-slate-50",
                className
              )
            )}
            {...props}
          />
          {rightAddon && (
            <div className="absolute right-3.5 flex items-center text-[#5e7a70] text-sm">
              {rightAddon}
            </div>
          )}
        </div>
        {error && <span className="text-xs font-medium text-rose-600">{error}</span>}
        {helperText && !error && <span className="text-xs text-[#5e7a70]">{helperText}</span>}
      </div>
    );
  }
);

Input.displayName = "Input";
