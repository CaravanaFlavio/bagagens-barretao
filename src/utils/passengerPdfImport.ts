import { CITIES } from '../constants/cities'
import type {
  PassengerBusType,
  PassengerDocumentType,
  PassengerPdfImportRow,
  PassengerSourceRole,
  TravelPeriod,
} from '../domain/types'

interface TextItemLike {
  str?: string
  transform?: number[]
  hasEOL?: boolean
}

interface ParsedLineContext {
  city: string
  travelPeriod: TravelPeriod | ''
  busType: PassengerBusType
}

const CITY_ALIASES = new Map<string, string>([
  ['BH', 'Belo Horizonte'],
  ['BELO HORIZONTE', 'Belo Horizonte'],
  ['BETIM', 'Betim'],
  ['CARMOPOLIS', 'Carmópolis de Minas'],
  ['CARMOPOLIS DE MINAS', 'Carmópolis de Minas'],
  ['CLAUDIO', 'Cláudio'],
  ['CONTAGEM', 'Contagem'],
  ['CRUZILIA', 'Cruzília'],
  ['DIVINOPOLIS', 'Divinópolis'],
  ['FORMIGA', 'Formiga'],
  ['IGARAPE', 'Igarapé'],
  ['ITAGUARA', 'Itaguara'],
  ['ITAUNA', 'Itaúna'],
  ['ITATIAIUCU', 'Itatiaiuçu'],
  ['NOVA SERRANA', 'Nova Serrana'],
  ['OLIVEIRA', 'Oliveira'],
  ['PASSA TEMPO', 'Passa Tempo'],
  ['RITAPOLIS', 'Ritápolis'],
  ['SANTA TEREZINHA', 'Santa Terezinha'],
  ['SAO JOAO DEL REI', 'São João del-Rei'],
  ['SAO JOAO DEL-REI', 'São João del-Rei'],
  ['SAO TIAGO', 'São Tiago'],
])

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

function normalizeWhitespace(value: string) {
  return value
    .replace(/[\u00a0\u2007\u202f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function canonicalCity(value: string) {
  const normalized = normalizeText(value.replace(/[()]/g, ''))
  const alias = CITY_ALIASES.get(normalized)
  if (alias) return alias

  return CITIES.find((city) => normalizeText(city) === normalized) ?? ''
}

function inferTravelPeriod(value: string): TravelPeriod | '' {
  const normalized = normalizeText(value)
  if (normalized.includes('PRIMEIRA SEMANA')) return 'FIRST_WEEK'
  if (normalized.includes('SEGUNDA SEMANA')) return 'SECOND_WEEK'
  return ''
}

function inferTravelPeriodFromFileName(fileName: string): TravelPeriod | '' {
  return inferTravelPeriod(fileName)
}

function inferBusType(value: string): PassengerBusType | null {
  const normalized = normalizeText(value)
  if (normalized.includes('ONIBUS 2 ANDARES') || normalized.includes('ONIBUS DE 2 ANDARES')) {
    return 'DOUBLE_DECKER'
  }
  if (normalized.includes('ONIBUS CONVENCIONAL')) return 'CONVENTIONAL'
  return null
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

function classifyDocument(rawValue: string): {
  documentType: PassengerDocumentType
  warning: string
} {
  const document = rawValue.trim()
  if (!document) {
    return {
      documentType: 'UNKNOWN',
      warning: 'Documento não identificado nesta linha do PDF.',
    }
  }

  if (/^MG\s*[-.]?/i.test(document)) {
    return { documentType: 'RG', warning: '' }
  }

  const digits = document.replace(/\D/g, '')
  if (digits.length === 11 && normalizeDocument(document) === digits && isValidCpf(digits)) {
    return { documentType: 'CPF', warning: '' }
  }

  if (digits.length === 11 && normalizeDocument(document) === digits) {
    return {
      documentType: 'UNKNOWN',
      warning: 'O número possui 11 dígitos, mas não passa na validação de CPF. Confirmar o documento.',
    }
  }

  if (digits.length > 11) {
    return {
      documentType: 'UNKNOWN',
      warning: 'O documento contém mais de 11 dígitos ou aparece repetido na mesma linha. Confirmar o valor.',
    }
  }

  if (digits.length > 0 && digits.length < 11) {
    return {
      documentType: 'UNKNOWN',
      warning: `Documento possivelmente incompleto: foram informados ${digits.length} dígitos. Confirmar o número.`,
    }
  }

  return { documentType: 'UNKNOWN', warning: '' }
}

function appendWarning(current: string, warning: string) {
  const clean = warning.trim()
  if (!clean) return current
  if (!current) return clean
  if (current.includes(clean)) return current
  return `${current} ${clean}`
}

function linesFromTextItems(items: TextItemLike[]) {
  const positioned = items
    .filter((item) => normalizeWhitespace(item.str ?? ''))
    .map((item, index) => ({
      text: normalizeWhitespace(item.str ?? ''),
      x: item.transform?.[4] ?? index,
      y: item.transform?.[5] ?? 0,
      hasEOL: Boolean(item.hasEOL),
    }))

  const groups: Array<{ y: number; items: typeof positioned }> = []
  const tolerance = 2.5

  for (const item of positioned.sort((a, b) => b.y - a.y || a.x - b.x)) {
    const group = groups.find((candidate) => Math.abs(candidate.y - item.y) <= tolerance)
    if (group) {
      group.items.push(item)
      group.y = (group.y + item.y) / 2
    } else {
      groups.push({ y: item.y, items: [item] })
    }
  }

  return groups
    .sort((a, b) => b.y - a.y)
    .map((group) =>
      normalizeWhitespace(
        group.items
          .sort((a, b) => a.x - b.x)
          .map((item) => item.text)
          .join(' '),
      ),
    )
    .filter(Boolean)
}

function parsePassengerLine(
  line: string,
  context: ParsedLineContext,
  sourceFile: string,
  sourcePage: number,
  rowIndex: number,
): PassengerPdfImportRow | null {
  const numbered = line.match(/^\s*\d+\s*[.)-]\s*(.+)$/)
  if (!numbered) return null

  let body = normalizeWhitespace(numbered[1])
  if (!body) return null

  let sourceRole: PassengerSourceRole = 'PASSENGER'
  let rowCity = ''
  const trailingParenthesis = body.match(/\s*\(([^()]+)\)\s*$/)
  if (trailingParenthesis) {
    const trailingValue = trailingParenthesis[1].trim()
    if (normalizeText(trailingValue) === 'GUIA') {
      sourceRole = 'GUIDE'
      rowCity = context.city
    } else {
      rowCity = canonicalCity(trailingValue)
    }
    body = body.slice(0, trailingParenthesis.index).trim()
  }

  const separator = /\s+[–—-]\s+/.exec(body)
  if (!separator || separator.index === undefined) return null

  const fullName = normalizeWhitespace(body.slice(0, separator.index))
  const documentNumber = normalizeWhitespace(body.slice(separator.index + separator[0].length))
  if (!fullName) return null

  const city = rowCity || context.city
  const documentInfo = classifyDocument(documentNumber)
  let parseWarning = documentInfo.warning

  if (sourceRole === 'GUIDE') {
    parseWarning = appendWarning(
      parseWarning,
      'A lista identifica este registro como GUIA. Confirmar se deve permanecer na base de passageiros.',
    )
  }

  if (!city) {
    parseWarning = appendWarning(
      parseWarning,
      'Não foi possível identificar a cidade desta linha. O registro exige revisão manual.',
    )
  }
  if (!context.travelPeriod) {
    parseWarning = appendWarning(
      parseWarning,
      'Não foi possível identificar se o passageiro pertence à primeira ou à segunda semana.',
    )
  }
  if (context.busType === 'UNSPECIFIED') {
    parseWarning = appendWarning(
      parseWarning,
      'Não foi possível identificar o tipo de ônibus desta linha.',
    )
  }

  return {
    rowKey: `${sourceFile}::${sourcePage}::${rowIndex}::${normalizeText(fullName)}::${normalizeDocument(documentNumber)}`,
    sourceFile,
    sourcePage,
    fullName,
    documentNumber,
    documentType: documentInfo.documentType,
    city,
    travelPeriod: context.travelPeriod,
    busType: context.busType,
    sourceRole,
    parseWarning,
  }
}

function addCrossRowWarnings(rows: PassengerPdfImportRow[]) {
  const byNameDocument = new Map<string, PassengerPdfImportRow[]>()
  const byDocument = new Map<string, PassengerPdfImportRow[]>()

  for (const row of rows) {
    const documentKey = normalizeDocument(row.documentNumber)
    const nameKey = normalizeText(row.fullName)
    if (documentKey) {
      const nameDocumentKey = `${nameKey}::${documentKey}`
      byNameDocument.set(nameDocumentKey, [...(byNameDocument.get(nameDocumentKey) ?? []), row])
      byDocument.set(documentKey, [...(byDocument.get(documentKey) ?? []), row])
    }
  }

  for (const group of byNameDocument.values()) {
    if (group.length < 2) continue
    const distinctPlacements = new Set(
      group.map((row) => `${row.city}::${row.travelPeriod}::${row.busType}`),
    )
    if (distinctPlacements.size < 2) continue
    for (const row of group) {
      row.parseWarning = appendWarning(
        row.parseWarning,
        'Possível duplicidade na lista: o mesmo nome e documento aparecem em mais de uma posição, cidade, período ou ônibus.',
      )
    }
  }

  for (const group of byDocument.values()) {
    const distinctNames = new Set(group.map((row) => normalizeText(row.fullName)))
    if (distinctNames.size < 2) continue
    for (const row of group) {
      row.parseWarning = appendWarning(
        row.parseWarning,
        'Possível documento duplicado: o mesmo número aparece associado a nomes diferentes na lista.',
      )
    }
  }
}

async function fingerprintFiles(files: File[]) {
  const entries: string[] = []
  for (const file of files) {
    const bytes = await file.arrayBuffer()
    const digest = await crypto.subtle.digest('SHA-256', bytes)
    const hash = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
    entries.push(`${file.name}:${file.size}:${hash}`)
  }
  return entries.sort().join('|')
}

export async function parsePassengerUpdatePdfs(files: File[]) {
  if (files.length === 0) {
    throw new Error('Selecione pelo menos um arquivo PDF.')
  }

  for (const file of files) {
    const isPdf = file.type === 'application/pdf' || file.name.toLocaleLowerCase('pt-BR').endsWith('.pdf')
    if (!isPdf) throw new Error(`${file.name} não é um arquivo PDF.`)
  }

  const [{ getDocument, GlobalWorkerOptions }, workerModule] = await Promise.all([
    import('pdfjs-dist'),
    import('pdfjs-dist/build/pdf.worker.mjs?url'),
  ])
  GlobalWorkerOptions.workerSrc = workerModule.default

  const rows: PassengerPdfImportRow[] = []

  for (const file of files) {
    const bytes = new Uint8Array(await file.arrayBuffer())
    const loadingTask = getDocument({ data: bytes })
    const pdf = await loadingTask.promise
    const filePeriod = inferTravelPeriodFromFileName(file.name)

    const context: ParsedLineContext = {
      city: '',
      travelPeriod: filePeriod,
      busType: 'UNSPECIFIED',
    }

    try {
      for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
        const page = await pdf.getPage(pageNumber)
        const content = await page.getTextContent()
        const lines = linesFromTextItems(content.items as TextItemLike[])
        let rowIndex = 0

        for (const line of lines) {
          const period = inferTravelPeriod(line)
          if (period) context.travelPeriod = period

          const busType = inferBusType(line)
          if (busType) {
            context.busType = busType
            continue
          }

          const cityHeader = line.match(/^\s*\(([^()]+)\)\s*$/)
          if (cityHeader) {
            const city = canonicalCity(cityHeader[1])
            if (city) context.city = city
            continue
          }

          const parsed = parsePassengerLine(line, context, file.name, pageNumber, rowIndex)
          if (parsed) {
            rows.push(parsed)
            rowIndex += 1
          }
        }
      }
    } finally {
      await loadingTask.destroy()
    }
  }

  if (rows.length === 0) {
    throw new Error(
      'Nenhum passageiro foi identificado. O PDF pode ser uma imagem escaneada ou estar em um formato diferente das listas atuais.',
    )
  }

  addCrossRowWarnings(rows)

  return {
    fingerprint: await fingerprintFiles(files),
    fileNames: files.map((file) => file.name),
    rows,
  }
}
