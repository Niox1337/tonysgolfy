import type { ScoreImportInput } from '../../api'

function mapHeader(value: string) {
  const key = value.trim().toLowerCase().replaceAll(/[\s_-]+/g, '')

  if (['guideid', 'courseid', 'id'].includes(key)) return 'guideId'
  if (['coursecode', 'code'].includes(key)) return 'courseCode'
  if (['coursename', 'course', 'name', 'title'].includes(key)) return 'courseName'
  if (['judgename', 'judge', 'reviewer'].includes(key)) return 'judgeName'
  if (['score', 'rating', 'points'].includes(key)) return 'score'

  return null
}

export function convertRowsToScoreImports(rows: Record<string, string | number | boolean | null>[]) {
  return rows
    .map((row) => {
      const draft: {
        guideId: string
        courseCode: string
        courseName: string
        judgeName: string
        score: string
      } = {
        guideId: '',
        courseCode: '',
        courseName: '',
        judgeName: '',
        score: '',
      }

      Object.entries(row).forEach(([header, rawValue]) => {
        const mapped = mapHeader(header)
        if (!mapped) return
        draft[mapped] = rawValue == null ? '' : String(rawValue)
      })

      if (!draft.guideId.trim() && !draft.courseCode.trim() && !draft.courseName.trim()) {
        return null
      }

      const score = Number(draft.score)
      if (!Number.isFinite(score)) {
        return null
      }

      const imported: ScoreImportInput = { score }
      if (draft.guideId.trim()) imported.guideId = draft.guideId.trim()
      if (draft.courseCode.trim()) imported.courseCode = draft.courseCode.trim()
      if (draft.courseName.trim()) imported.courseName = draft.courseName.trim()
      if (draft.judgeName.trim()) imported.judgeName = draft.judgeName.trim()
      return imported
    })
    .filter((score): score is ScoreImportInput => score !== null)
}
