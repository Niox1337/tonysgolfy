export type ThemeMode = 'day' | 'night'
export type RegionFilter = 'all' | string

export type FormState = {
  courseName: string
  region: string
  courseCode: string
  greenFee: string
  bestSeason: string
  notes: string
}

export type SpreadsheetSheet = unknown

export type SpreadsheetBook = {
  SheetNames: string[]
  Sheets: Record<string, SpreadsheetSheet>
}

export type SpreadsheetUtils = {
  sheet_to_json: (
    sheet: SpreadsheetSheet,
    options: { defval: string },
  ) => Record<string, string | number | boolean | null>[]
  json_to_sheet: (rows: Record<string, string | number>[]) => SpreadsheetSheet
  book_new: () => SpreadsheetBook
  book_append_sheet: (workbook: SpreadsheetBook, sheet: SpreadsheetSheet, name: string) => void
}

export type SpreadsheetReader = {
  read: (data: ArrayBuffer, options: { type: 'array' }) => SpreadsheetBook
  writeFile: (workbook: SpreadsheetBook, filename: string) => void
  utils: SpreadsheetUtils
}

declare global {
  interface Window {
    XLSX?: SpreadsheetReader
  }
}
