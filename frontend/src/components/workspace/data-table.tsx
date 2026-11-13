import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

export interface DataTableColumn {
  key: string;
  label: string;
  className?: string;
}

/**
 * Table shell used by the list modules. It renders real headers and an empty
 * row today; the moment a module has data it can pass `rows` without touching
 * the surrounding chrome.
 */
export function DataTable({
  columns,
  rows = [],
  empty,
}: {
  columns: DataTableColumn[];
  rows?: ReactNode[][];
  empty: ReactNode;
}) {
  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[40rem] text-sm">
          <thead>
            <tr className="border-b border-border bg-secondary/70 text-left">
              {columns.map((column) => (
                <th
                  key={column.key}
                  scope="col"
                  className={cn(
                    "px-4 py-2.5 text-[11px] font-semibold tracking-[0.1em] text-muted-foreground uppercase",
                    column.className,
                  )}
                >
                  {column.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={columns.length} className="px-4 py-8">
                  {empty}
                </td>
              </tr>
            ) : (
              rows.map((cells, rowIndex) => (
                <tr
                  key={rowIndex}
                  className="border-b border-border transition-colors last:border-0 hover:bg-secondary/50"
                >
                  {cells.map((cell, cellIndex) => (
                    <td key={cellIndex} className="px-4 py-3 align-middle">
                      {cell}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
