"use client";

import { useQuery } from "@tanstack/react-query";
import * as React from "react";
import type { FormValues } from "@/components/ui/record-form-dialog";
import { fetchItems } from "./record-api";
import { type CodeNamed, toOptions } from "./record-fields";

export interface EditorState<T> {
  mode: "create" | "edit";
  /** Values shown in the form (stable object, so the dialog does not reset). */
  values: FormValues;
  /** The record being edited, when mode is "edit". */
  original: T | null;
}

/** Open/close state for a RecordFormDialog. */
export function useRecordEditor<T extends object>() {
  const [state, setState] = React.useState<EditorState<T> | null>(null);
  const openCreate = React.useCallback((defaults: FormValues) => {
    setState({ mode: "create", values: defaults, original: null });
  }, []);
  const openEdit = React.useCallback((record: T) => {
    setState({ mode: "edit", values: { ...(record as FormValues) }, original: record });
  }, []);
  const close = React.useCallback(() => setState(null), []);
  return { state, openCreate, openEdit, close };
}

/** Code/name options for a master-data list (programs, sections, ...). */
export function useCodeOptions(segment: string, params?: Record<string, string>) {
  const query = useQuery({
    queryKey: ["options", segment, params ?? null],
    queryFn: () => fetchItems<CodeNamed>(segment, params),
    staleTime: 60_000,
  });
  return React.useMemo(() => toOptions(query.data ?? []), [query.data]);
}
