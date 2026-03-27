import type { GuideInput, GuideRecord } from '../../api'
import type { FormState } from './types'

export const THEME_KEY = 'tonysgolfy-theme'

export const initialForm: FormState = {
  courseName: '',
  region: '',
  courseCode: '',
  greenFee: '1500',
  bestSeason: '',
  notes: '',
}

export const emptyGuideMessage =
  '输入你的旅行偏好，例如“海景球场、适合 3 天行程、预算 3000 内”，然后点击生成。'

export function toGuideInput(form: FormState): GuideInput {
  return {
    courseName: form.courseName.trim(),
    region: form.region.trim(),
    courseCode: form.courseCode.trim(),
    greenFee: Number(form.greenFee) || 0,
    bestSeason: form.bestSeason.trim(),
    notes: form.notes.trim(),
  }
}

export function toFormState(record: GuideRecord): FormState {
  return {
    courseName: record.courseName,
    region: record.region,
    courseCode: record.courseCode,
    greenFee: String(record.greenFee),
    bestSeason: record.bestSeason,
    notes: record.notes,
  }
}

export function loadTheme() {
  return localStorage.getItem(THEME_KEY) === 'night' ? 'night' : 'day'
}

export function parseCsv(text: string) {
  const rows: string[][] = []
  let cell = ''
  let row: string[] = []
  let inQuotes = false

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]
    const next = text[index + 1]

    if (char === '"') {
      if (inQuotes && next === '"') {
        cell += '"'
        index += 1
      } else {
        inQuotes = !inQuotes
      }
      continue
    }

    if (char === ',' && !inQuotes) {
      row.push(cell)
      cell = ''
      continue
    }

    if ((char === '\n' || char === '\r') && !inQuotes) {
      if (char === '\r' && next === '\n') index += 1
      row.push(cell)
      if (row.some((entry) => entry.trim() !== '')) rows.push(row)
      row = []
      cell = ''
      continue
    }

    cell += char
  }

  row.push(cell)
  if (row.some((entry) => entry.trim() !== '')) rows.push(row)

  return rows
}

function mapHeader(value: string) {
  const key = value.trim().toLowerCase().replaceAll(/[\s_-]+/g, '')
  if (['coursename', 'course', 'name', 'title'].includes(key)) return 'courseName'
  if (['region', 'city', 'country', 'destination'].includes(key)) return 'region'
  if (['coursecode', 'code', 'sku', 'courseid'].includes(key)) return 'courseCode'
  if (['greenfee', 'fee', 'price', 'rate'].includes(key)) return 'greenFee'
  if (['bestseason', 'season', 'playseason', 'besttime'].includes(key)) return 'bestSeason'
  if (['notes', 'note', 'tips', 'remark', 'details'].includes(key)) return 'notes'
  return null
}

export function convertRowsToGuideInputs(rows: Record<string, string | number | boolean | null>[]) {
  return rows
    .map((row) => {
      const draft: FormState = { ...initialForm }

      Object.entries(row).forEach(([header, rawValue]) => {
        const mapped = mapHeader(header)
        if (!mapped) return
        draft[mapped] = rawValue == null ? '' : String(rawValue)
      })

      if (!draft.courseName.trim() && !draft.courseCode.trim()) return null
      return toGuideInput(draft)
    })
    .filter((guide): guide is GuideInput => guide !== null)
}
