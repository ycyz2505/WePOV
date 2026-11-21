// Roster CSV parsing that mirrors the backend's accepted format (§4.3):
// fields `学号,真实姓名,性别,昵称,初始密码`; supports English commas, full-width
// commas, tabs, quoted fields, a UTF-8 BOM and `#` comment lines.
//
// The backend performs the authoritative import and nickname-uniqueness check;
// this parser is used only for client-side preview and early feedback so the
// admin sees line-level problems before submitting.

export interface RosterRow {
  line: number
  studentNumber: string
  realName: string
  gender: string
  nickname: string
  initialPassword: string
}

export interface RosterParseIssue {
  line: number
  message: string
}

export interface RosterParseResult {
  rows: RosterRow[]
  issues: RosterParseIssue[]
  duplicateNicknames: string[]
}

function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text
}

/** Split one logical record into fields, honoring double-quoted fields that may
 *  contain the delimiter or escaped quotes (""). */
function splitFields(line: string, delimiter: string): string[] {
  const fields: string[] = []
  let current = ''
  let inQuotes = false
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i]
    if (inQuotes) {
      if (char === '"') {
        if (line[i + 1] === '"') {
          current += '"'
          i += 1
        } else {
          inQuotes = false
        }
      } else {
        current += char
      }
    } else if (char === '"') {
      inQuotes = true
    } else if (char === delimiter) {
      fields.push(current)
      current = ''
    } else {
      current += char
    }
  }
  fields.push(current)
  return fields.map((field) => field.trim())
}

function detectDelimiter(line: string): string {
  if (line.includes('\t')) return '\t'
  if (line.includes('，')) return '，'
  return ','
}

export function parseRosterCsv(text: string): RosterParseResult {
  const issues: RosterParseIssue[] = []
  const rows: RosterRow[] = []
  const nicknameCounts = new Map<string, number>()

  const rawLines = stripBom(text).split(/\r\n|\r|\n/)
  rawLines.forEach((rawLine, index) => {
    const lineNumber = index + 1
    const trimmed = rawLine.trim()
    if (!trimmed || trimmed.startsWith('#')) return
    // Skip an optional header row.
    if (lineNumber === 1 && /学号|student/i.test(trimmed) && !/\d{2,}/.test(trimmed)) return

    const delimiter = detectDelimiter(trimmed)
    const fields = splitFields(trimmed, delimiter)
    const [studentNumber = '', realName = '', gender = '', nickname = '', initialPassword = ''] = fields

    if (!realName) {
      issues.push({ line: lineNumber, message: '缺少真实姓名' })
      return
    }
    if (!nickname) {
      issues.push({ line: lineNumber, message: '缺少昵称' })
      return
    }
    if (nickname.length > 12) {
      issues.push({ line: lineNumber, message: `昵称超过 12 字：${nickname}` })
    }
    if (initialPassword && initialPassword.length < 8) {
      issues.push({ line: lineNumber, message: `初始密码少于 8 位：${nickname}` })
    }
    if (studentNumber && !/^[0-9A-Za-z-]+$/.test(studentNumber)) {
      issues.push({ line: lineNumber, message: `学号格式可疑：${studentNumber}` })
    }

    const key = nickname.toLowerCase()
    nicknameCounts.set(key, (nicknameCounts.get(key) ?? 0) + 1)

    rows.push({
      line: lineNumber,
      studentNumber,
      realName,
      gender,
      nickname,
      initialPassword,
    })
  })

  const duplicateNicknames = [...nicknameCounts.entries()]
    .filter(([, count]) => count > 1)
    .map(([nickname]) => nickname)

  return { rows, issues, duplicateNicknames }
}
