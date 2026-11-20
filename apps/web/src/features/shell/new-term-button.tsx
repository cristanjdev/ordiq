"use client";

import { useQueryClient } from "@tanstack/react-query";
import * as React from "react";
import { type FormValues, RecordFormDialog } from "@/components/ui/record-form-dialog";
import { fetchItems, saveRecord } from "@/features/data/record-api";
import { termFields } from "@/features/data/record-fields";
import { latestTerm, nextTermValues, type TermDefaultsSource } from "@/features/data/term-defaults";
import { useShell } from "./providers";

/** Value of the "Add new semester" entry in the header term picker. */
export const NEW_TERM_OPTION = "__new_term__";

/**
 * Adding the next or an upcoming semester from the header term picker: `start()`
 * opens the form pre-filled as the semester after the latest one; on save the
 * picker switches to it. Render `dialog` once in the page.
 */
export function useNewTermDialog(): { start: () => void; opening: boolean; dialog: React.ReactNode } {
  const queryClient = useQueryClient();
  const { setSelectedTermId } = useShell();
  const [values, setValues] = React.useState<FormValues | null>(null);
  const [existingCodes, setExistingCodes] = React.useState<string[]>([]);
  const [opening, setOpening] = React.useState(false);

  const start = React.useCallback(() => {
    setOpening(true);
    void queryClient
      .fetchQuery({
        queryKey: ["terms-data"],
        queryFn: () => fetchItems<TermDefaultsSource>("terms"),
      })
      .then((terms) => {
        setExistingCodes(terms.map((t) => t.code));
        setValues(nextTermValues(latestTerm(terms)));
      })
      .catch(() => {
        // Without the saved terms, start from the built-in default.
        setExistingCodes([]);
        setValues(nextTermValues(undefined));
      })
      .finally(() => setOpening(false));
  }, [queryClient]);

  const save = async (form: FormValues) => {
    const code = String(form.code ?? "");
    if (existingCodes.includes(code)) {
      throw Object.assign(new Error("This semester already exists."), {
        issues: [{ path: ["code"], message: "This code is already used." }],
      });
    }
    await saveRecord("terms", { ...form, semester: Number(form.semester) });
    setValues(null);
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["terms"] }),
      queryClient.invalidateQueries({ queryKey: ["terms-data"] }),
    ]);
    setSelectedTermId(code);
  };

  const dialog = (
    <RecordFormDialog
      open={values !== null}
      mode="create"
      entityLabel="Semester"
      description="The new semester starts as a Draft. Set it to Active when it becomes the current semester; only one semester should be Active at a time."
      fields={termFields()}
      initialValues={values ?? undefined}
      onClose={() => setValues(null)}
      onSubmit={save}
    />
  );

  return { start, opening, dialog };
}
