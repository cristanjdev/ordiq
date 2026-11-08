/** Page and tab scopes shared by the download link and workbook generator. */
export const WORKBOOK_TEMPLATE_SHEETS = {
  all: null,
  faculty: ["Faculty"],
  rooms: ["Rooms"],
  subjects: ["Subjects"],
  sections: ["Sections"],
  offerings: ["Offerings"],
} as const;

export type WorkbookTemplateScope = keyof typeof WORKBOOK_TEMPLATE_SHEETS;

export function isWorkbookTemplateScope(value: string): value is WorkbookTemplateScope {
  return Object.hasOwn(WORKBOOK_TEMPLATE_SHEETS, value);
}

export function workbookTemplateUrl(scope: WorkbookTemplateScope, termCode: string): string {
  return `/api/v1/imports?${new URLSearchParams({ template: "1", scope, termCode })}`;
}
