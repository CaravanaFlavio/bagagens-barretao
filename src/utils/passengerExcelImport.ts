import { CITIES } from '../constants/cities'
import type {
  PassengerBusType,
  PassengerDocumentType,
  PassengerPdfImportRow,
  PassengerReviewStatus,
  PassengerSourceRole,
  TravelPeriod,
} from '../domain/types'

const TEMPLATE_MARKER = 'BAGAGENS_BARRETAO_PASSAGEIROS_V1'

function normalizeText(value: string) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLocaleUpperCase('pt-BR')
}

function normalizeDocument(value: string) {
  return normalizeText(value).replace(/[^A-Z0-9]/g, '')
}

function cellText(cell: { text?: string; value?: unknown }) {
  if (typeof cell.text === 'string' && cell.text.trim()) return cell.text.trim()
  if (cell.value === null || cell.value === undefined) return ''
  if (typeof cell.value === 'string' || typeof cell.value === 'number') return String(cell.value).trim()
  return ''
}

function canonicalCity(value: string) {
  const normalized = normalizeText(value)
  return CITIES.find((city) => normalizeText(city) === normalized) ?? ''
}

function isValidCpf(value: string) {
  const digits = value.replace(/\D/g, '')
  if (digits.length !== 11 || /^(\d)\1{10}$/.test(digits)) return false

  const calculateDigit = (base: string, factor: number) => {
    let total = 0
    for (const char of base) {
      total += Number(char) * factor
      factor -= 1
    }
    const remainder = (total * 10) % 11
    return remainder === 10 ? 0 : remainder
  }

  const firstDigit = calculateDigit(digits.slice(0, 9), 10)
  const secondDigit = calculateDigit(digits.slice(0, 10), 11)
  return firstDigit === Number(digits[9]) && secondDigit === Number(digits[10])
}

function parseDocument(value: string, hiddenType: string) {
  const raw = value.trim()
  const hidden = normalizeText(hiddenType)
  const prefixMatch = raw.match(/^\s*(CPF|RG|DOC)\s*:\s*(.+)$/i)
  const documentNumber = (prefixMatch?.[2] ?? raw).trim()
  const normalized = normalizeDocument(documentNumber)

  let documentType: PassengerDocumentType =
    hidden === 'CPF' ? 'CPF' : hidden === 'RG' ? 'RG' : 'UNKNOWN'
  let warning = ''

  if (prefixMatch) {
    const prefix = normalizeText(prefixMatch[1])
    documentType = prefix === 'CPF' ? 'CPF' : prefix === 'RG' ? 'RG' : 'UNKNOWN'
  } else if (/^MG\s*[-.]?/i.test(documentNumber)) {
    documentType = 'RG'
  } else if (/^\d{11}$/.test(normalized) && isValidCpf(normalized)) {
    documentType = 'CPF'
  }

  if (documentType === 'CPF' && !isValidCpf(documentNumber)) {
    warning = 'O número informado como CPF possui 11 dígitos, mas não passa na validação. Confirmar o documento.'
    documentType = 'UNKNOWN'
  } else if (documentNumber && documentType === 'UNKNOWN') {
    const digits = documentNumber.replace(/\D/g, '')
    if (digits.length > 0 && digits.length < 11) {
      warning = `Documento possivelmente incompleto: foram informados ${digits.length} dígitos. Confirmar o número.`
    } else if (digits.length > 11) {
      warning = 'O documento contém mais de 11 dígitos. Confirmar o valor.'
    }
  }

  return { documentNumber, documentType, warning }
}

function parseReviewStatus(value: string): PassengerReviewStatus | undefined {
  const normalized = normalizeText(value)
  if (!normalized) return undefined
  if (normalized.includes('REVISAR')) return 'REVIEW'
  if (normalized.includes('CONFIRM')) return 'CONFIRMED'
  return undefined
}

function parseRole(value: string): PassengerSourceRole {
  return normalizeText(value) === 'GUIDE' ? 'GUIDE' : 'PASSENGER'
}

function cleanNotes(value: string, hiddenWarning: string) {
  let notes = value.trim()
  const warning = hiddenWarning.trim()
  if (!warning) return notes

  const variants = [`Alerta: ${warning}`, warning]
  for (const variant of variants) {
    notes = notes
      .split(' | ')
      .filter((part) => part.trim() !== variant)
      .join(' | ')
      .trim()
  }
  return notes
}

async function fingerprintFile(file: File) {
  const bytes = await file.arrayBuffer()
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  const hash = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
  return `${file.name}:${file.size}:${hash}`
}

export async function parsePassengerUpdateExcel(file: File) {
  const isExcel =
    file.name.toLocaleLowerCase('pt-BR').endsWith('.xlsx') ||
    file.type === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'

  if (!isExcel) {
    throw new Error(`${file.name} não é uma planilha Excel .xlsx.`)
  }

  const { default: ExcelJSRuntime } = await import('exceljs')
  const workbook = new ExcelJSRuntime.Workbook()
  await workbook.xlsx.load(await file.arrayBuffer())

  const rows: PassengerPdfImportRow[] = []
  let recognizedSheets = 0

  workbook.eachSheet((worksheet) => {
    if (cellText(worksheet.getCell('J1')) !== TEMPLATE_MARKER) return

    const travelPeriod = cellText(worksheet.getCell('J2')) as TravelPeriod
    const busType = cellText(worksheet.getCell('J3')) as PassengerBusType
    if (!['FIRST_WEEK', 'SECOND_WEEK', 'BOTH_WEEKS'].includes(travelPeriod)) return
    if (!['DOUBLE_DECKER', 'CONVENTIONAL', 'UNSPECIFIED'].includes(busType)) return

    recognizedSheets += 1
    let currentCity = ''

    worksheet.eachRow((row, rowNumber) => {
      const firstCell = cellText(row.getCell(1))
      if (normalizeText(firstCell).startsWith('CIDADE •')) {
        const rawCity = firstCell.replace(/^\s*CIDADE\s*•\s*/i, '').trim()
        currentCity = canonicalCity(rawCity) || rawCity
        return
      }

      const fullName = cellText(row.getCell(2))
      if (!fullName || normalizeText(fullName) === 'NOME') return
      if (!currentCity) return

      const rawDocument = cellText(row.getCell(3))
      const hiddenDocumentType = cellText(row.getCell(9))
      const document = parseDocument(rawDocument, hiddenDocumentType)
      const phone = cellText(row.getCell(4))
      const reviewStatus = parseReviewStatus(cellText(row.getCell(5)))
      const hiddenWarning = cellText(row.getCell(11))
      const notes = cleanNotes(cellText(row.getCell(6)), hiddenWarning)
      const passengerId = cellText(row.getCell(7)) || undefined
      const sourceRole = parseRole(cellText(row.getCell(8)))

      let parseWarning = document.warning
      if (!reviewStatus && cellText(row.getCell(5))) {
        parseWarning = [parseWarning, 'Situação do cadastro não reconhecida na planilha. Use “Confirmado” ou “Revisar”.']
          .filter(Boolean)
          .join(' ')
      }

      rows.push({
        rowKey: `${file.name}::${worksheet.name}::${rowNumber}::${passengerId ?? normalizeText(fullName)}::${normalizeDocument(document.documentNumber)}`,
        passengerId,
        sourceFile: `${file.name} • aba ${worksheet.name}`,
        sourcePage: 0,
        fullName,
        documentNumber: document.documentNumber,
        documentType: document.documentType,
        city: currentCity,
        travelPeriod,
        busType,
        sourceRole,
        phone,
        reviewStatus,
        notes,
        parseWarning,
      })
    })
  })

  if (recognizedSheets === 0) {
    throw new Error('A planilha não possui o modelo de passageiros exportado pelo aplicativo.')
  }
  if (rows.length === 0) {
    throw new Error('Nenhum passageiro foi encontrado nas abas reconhecidas da planilha.')
  }

  return {
    rows,
    fingerprint: await fingerprintFile(file),
    fileNames: [file.name],
  }
}
