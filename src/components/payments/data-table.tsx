"use client";

import { ArrowDownUp, ChevronLeft, ChevronRight, Search } from "lucide-react";
import * as React from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

export interface DataTableColumn<T> {
  key: string;
  header: string;
  render: (row: T) => React.ReactNode;
  className?: string;
  headerClassName?: string;
  /** Enables click-to-sort on this column when provided. */
  sortValue?: (row: T) => string | number;
}

export interface DataTableFilterOption {
  value: string;
  label: string;
}

export interface DataTableProps<T> {
  rows: T[];
  columns: DataTableColumn<T>[];
  rowKey: (row: T) => string;
  /** Text used by the search box (usually user + reference + notes). */
  searchText: (row: T) => string;
  searchPlaceholder?: string;
  filters?: {
    label: string;
    allLabel?: string;
    options: DataTableFilterOption[];
    match: (row: T, value: string) => boolean;
  };
  onRowClick?: (row: T) => void;
  rowAriaLabel?: (row: T) => string;
  emptyMessage?: string;
  caption: string;
  pageSize?: number;
}

/**
 * Client side table with search, one status filter, optional sorting and
 * pagination. Rows are rendered from data already fetched on the server, so no
 * additional request is made while filtering.
 */
export function DataTable<T>({
  rows,
  columns,
  rowKey,
  searchText,
  searchPlaceholder = "Cari...",
  filters,
  onRowClick,
  rowAriaLabel,
  emptyMessage = "Tidak ada data yang cocok dengan filter saat ini.",
  caption,
  pageSize = 10,
}: DataTableProps<T>) {
  const [query, setQuery] = React.useState("");
  const [filterValue, setFilterValue] = React.useState("ALL");
  const [sort, setSort] = React.useState<{ key: string; direction: "asc" | "desc" } | null>(null);
  const [page, setPage] = React.useState(1);

  const filtered = React.useMemo(() => {
    const needle = query.trim().toLowerCase();
    const result = rows.filter((row) => {
      if (filters && filterValue !== "ALL" && !filters.match(row, filterValue)) return false;
      if (!needle) return true;
      return searchText(row).toLowerCase().includes(needle);
    });

    if (!sort) return result;
    const column = columns.find((item) => item.key === sort.key);
    if (!column?.sortValue) return result;

    return [...result].sort((a, b) => {
      const left = column.sortValue!(a);
      const right = column.sortValue!(b);
      const comparison =
        typeof left === "number" && typeof right === "number"
          ? left - right
          : String(left).localeCompare(String(right), "id");
      return sort.direction === "asc" ? comparison : -comparison;
    });
  }, [rows, query, filters, filterValue, sort, columns, searchText]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  const currentPage = Math.min(page, pageCount);
  const visible = filtered.slice((currentPage - 1) * pageSize, currentPage * pageSize);

  function toggleSort(column: DataTableColumn<T>) {
    if (!column.sortValue) return;
    setSort((previous) => {
      if (previous?.key !== column.key) return { key: column.key, direction: "desc" };
      return { key: column.key, direction: previous.direction === "asc" ? "desc" : "asc" };
    });
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <div className="relative flex-1">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-white/35"
            aria-hidden
          />
          <Input
            type="search"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setPage(1);
            }}
            placeholder={searchPlaceholder}
            aria-label={searchPlaceholder}
            className="pl-9"
          />
        </div>

        {filters ? (
          <div className="sm:w-56">
            <label
              className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.14em] text-white/45"
              htmlFor="payment-status-filter"
            >
              {filters.label}
            </label>
            <select
              id="payment-status-filter"
              value={filterValue}
              onChange={(event) => {
                setFilterValue(event.target.value);
                setPage(1);
              }}
              className="h-11 w-full rounded-xl border border-white/12 bg-white/[0.04] px-3 text-sm text-white focus-visible:border-[var(--color-neon)]/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-neon)]/25"
            >
              <option value="ALL">{filters.allLabel ?? "Semua status"}</option>
              {filters.options.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
        ) : null}
      </div>

      <p className="text-xs text-white/45" role="status">
        Menampilkan {visible.length} dari {filtered.length} baris
        {filtered.length !== rows.length ? ` (total ${rows.length})` : ""}.
      </p>



      {filtered.length === 0 ? (
        <p className="rounded-xl border border-dashed border-white/15 bg-white/[0.02] p-6 text-center text-sm text-white/50">
          {emptyMessage}
        </p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-white/10">
          <table className="w-full min-w-[44rem] border-collapse text-left text-sm">
            <caption className="sr-only">{caption}</caption>
            <thead>
              <tr className="bg-white/[0.04] text-[11px] uppercase tracking-[0.12em] text-white/45">
                {columns.map((column) => {
                  const sortable = Boolean(column.sortValue);
                  const active = sort?.key === column.key;
                  return (
                    <th
                      key={column.key}
                      scope="col"
                      className={cn("px-3.5 py-3 font-semibold", column.headerClassName)}
                      aria-sort={
                        active ? (sort!.direction === "asc" ? "ascending" : "descending") : undefined
                      }
                    >
                      {sortable ? (
                        <button
                          type="button"
                          onClick={() => toggleSort(column)}
                          className={cn(
                            "inline-flex items-center gap-1.5 uppercase tracking-[0.12em] transition-colors hover:text-white",
                            active ? "text-[var(--color-neon)]" : undefined,
                          )}
                        >
                          {column.header}
                          <ArrowDownUp className="size-3" aria-hidden />
                        </button>
                      ) : (
                        column.header
                      )}
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {visible.map((row) => {
                const key = rowKey(row);
                return (
                  <tr
                    key={key}
                    className={cn(
                      "border-t border-white/8 align-top",
                      onRowClick ? "cursor-pointer hover:bg-white/[0.05]" : undefined,
                    )}
                    onClick={onRowClick ? () => onRowClick(row) : undefined}
                    onKeyDown={
                      onRowClick
                        ? (event) => {
                            if (event.key === "Enter" || event.key === " ") {
                              event.preventDefault();
                              onRowClick(row);
                            }
                          }
                        : undefined
                    }
                    tabIndex={onRowClick ? 0 : undefined}
                    aria-label={onRowClick ? rowAriaLabel?.(row) : undefined}
                  >
                    {columns.map((column) => (
                      <td key={column.key} className={cn("px-3.5 py-3 text-xs", column.className)}>
                        {column.render(row)}
                      </td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}


      {pageCount > 1 ? (
        <div className="flex items-center justify-between gap-3">
          <p className="text-xs text-white/45">
            Halaman {currentPage} dari {pageCount}
          </p>
          <div className="flex gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setPage((value) => Math.max(1, value - 1))}
              disabled={currentPage === 1}
            >
              <ChevronLeft aria-hidden />
              Sebelumnya
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setPage((value) => Math.min(pageCount, value + 1))}
              disabled={currentPage === pageCount}
            >
              Berikutnya
              <ChevronRight aria-hidden />
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
