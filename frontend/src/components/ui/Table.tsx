import React from "react";
import { clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export const Table = React.forwardRef<HTMLTableElement, React.HTMLAttributes<HTMLTableElement>>(
  ({ className, ...props }, ref) => (
    <div className="relative w-full overflow-auto rounded-2xl border border-[#dbe7dd] bg-white shadow-xs">
      <table ref={ref} className={twMerge(clsx("w-full caption-bottom text-sm", className))} {...props} />
    </div>
  )
);
Table.displayName = "Table";

export const TableHeader = React.forwardRef<
  HTMLTableSectionElement,
  React.HTMLAttributes<HTMLTableSectionElement>
>(({ className, ...props }, ref) => (
  <thead ref={ref} className={twMerge(clsx("bg-[#f4f8f3] border-b border-[#dbe7dd]", className))} {...props} />
));
TableHeader.displayName = "TableHeader";

export const TableBody = React.forwardRef<
  HTMLTableSectionElement,
  React.HTMLAttributes<HTMLTableSectionElement>
>(({ className, ...props }, ref) => (
  <tbody ref={ref} className={twMerge(clsx("[&_tr:last-child]:border-0", className))} {...props} />
));
TableBody.displayName = "TableBody";

export const TableFooter = React.forwardRef<
  HTMLTableSectionElement,
  React.HTMLAttributes<HTMLTableSectionElement>
>(({ className, ...props }, ref) => (
  <tfoot
    ref={ref}
    className={twMerge(clsx("border-t border-[#dbe7dd] bg-[#f4f8f3] font-medium text-[#17332c]", className))}
    {...props}
  />
));
TableFooter.displayName = "TableFooter";

export const TableRow = React.forwardRef<HTMLTableRowElement, React.HTMLAttributes<HTMLTableRowElement>>(
  ({ className, ...props }, ref) => (
    <tr
      ref={ref}
      className={twMerge(
        clsx(
          "border-b border-[#dbe7dd]/60 transition-colors hover:bg-[#f4f8f3]/50 data-[state=selected]:bg-[#f4f8f3]",
          className
        )
      )}
      {...props}
    />
  )
);
TableRow.displayName = "TableRow";

export const TableHead = React.forwardRef<
  HTMLTableCellElement,
  React.ThHTMLAttributes<HTMLTableCellElement>
>(({ className, ...props }, ref) => (
  <th
    ref={ref}
    className={twMerge(
      clsx(
        "h-11 px-4 text-left align-middle text-[11px] font-bold uppercase tracking-wider text-[#5e7a70] [&:has([role=checkbox])]:pr-0",
        className
      )
    )}
    {...props}
  />
));
TableHead.displayName = "TableHead";

export const TableCell = React.forwardRef<
  HTMLTableCellElement,
  React.TdHTMLAttributes<HTMLTableCellElement>
>(({ className, ...props }, ref) => (
  <td
    ref={ref}
    className={twMerge(clsx("p-4 align-middle text-sm text-[#17332c] [&:has([role=checkbox])]:pr-0", className))}
    {...props}
  />
));
TableCell.displayName = "TableCell";
