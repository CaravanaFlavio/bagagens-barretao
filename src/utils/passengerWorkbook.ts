import type {
  PassengerBusType,
  PassengerReviewStatus,
  PassengerSummary,
  TravelPeriod,
} from '../domain/types'

const PERIOD_LABELS: Record<TravelPeriod, string> = {
  FIRST_WEEK: '1ª semana',
  SECOND_WEEK: '2ª semana',
  BOTH_WEEKS: 'Duas semanas',
}

const BUS_LABELS: Record<PassengerBusType, string> = {
  DOUBLE_DECKER: 'Ônibus 2 andares',
  CONVENTIONAL: 'Ônibus convencional',
  UNSPECIFIED: 'Ônibus não informado',
}

const PERIOD_ORDER: TravelPeriod[] = ['FIRST_WEEK', 'SECOND_WEEK', 'BOTH_WEEKS']
const BUS_ORDER: PassengerBusType[] = ['DOUBLE_DECKER', 'CONVENTIONAL', 'UNSPECIFIED']

const SHEET_PERIOD_LABELS: Record<TravelPeriod, string> = {
  FIRST_WEEK: '1a',
  SECOND_WEEK: '2a',
  BOTH_WEEKS: 'Duas',
}

const SHEET_BUS_LABELS: Record<PassengerBusType, string> = {
  DOUBLE_DECKER: '2 andares',
  CONVENTIONAL: 'convencional',
  UNSPECIFIED: 'sem onibus',
}

export interface PassengerWorkbookOptions {
  city?: string
  travelPeriod?: TravelPeriod | ''
  reviewOnly?: boolean
  query?: string
}

function fileNamePart(value: string) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
}

function suggestedFileName(options: PassengerWorkbookOptions) {
  const parts = ['Lista', 'Passageiros', 'Barretao', '2026']
  if (options.travelPeriod) parts.push(fileNamePart(PERIOD_LABELS[options.travelPeriod]))
  if (options.city) parts.push(fileNamePart(options.city))
  if (options.reviewOnly) parts.push('Revisar')
  if (options.query?.trim()) parts.push('Filtrada')
  if (!options.travelPeriod && !options.city && !options.reviewOnly && !options.query?.trim()) {
    parts.push('Completa')
  }
  return `${parts.join('_')}.xlsx`
}

function documentLabel(passenger: PassengerSummary) {
  if (!passenger.documentNumber) return ''
  const prefix = passenger.documentType === 'UNKNOWN' ? 'DOC' : passenger.documentType
  return `${prefix}: ${passenger.documentNumber}`
}

function reviewLabel(status: PassengerReviewStatus) {
  return status === 'REVIEW' ? 'Revisar' : 'Confirmado'
}

function passengerObservation(passenger: PassengerSummary) {
  return [
    passenger.notes,
    passenger.importWarning ? `Alerta: ${passenger.importWarning}` : '',
  ]
    .filter(Boolean)
    .join(' | ')
}

function sheetName(period: TravelPeriod, busType: PassengerBusType) {
  return `${SHEET_PERIOD_LABELS[period]} - ${SHEET_BUS_LABELS[busType]}`.slice(0, 31)
}

export async function createPassengerWorkbook(
  passengers: PassengerSummary[],
  options: PassengerWorkbookOptions = {},
) {
  const { default: ExcelJSRuntime } = await import('exceljs')
  const workbook = new ExcelJSRuntime.Workbook()
  workbook.creator = 'Caravana Flávio Gonçalves'
  workbook.title = 'Lista de passageiros • Barretão 2026'
  workbook.subject = 'Controle de passageiros'
  workbook.created = new Date()
  workbook.modified = new Date()

  const summary = workbook.addWorksheet('Resumo', {
    properties: { defaultRowHeight: 20 },
    pageSetup: { orientation: 'landscape', paperSize: 9, fitToPage: true, fitToWidth: 1 },
  })

  summary.mergeCells('A1:F1')
  summary.getCell('A1').value = 'LISTA DE PASSAGEIROS • BARRETÃO 2026'
  summary.getCell('A1').font = { bold: true, size: 18, color: { argb: 'FFFFFFFF' } }
  summary.getCell('A1').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0D2236' } }
  summary.getCell('A1').alignment = { vertical: 'middle', horizontal: 'left' }
  summary.getRow(1).height = 30

  summary.mergeCells('A2:F2')
  summary.getCell('A2').value = 'Caravana Flávio Gonçalves • Controle de passageiros'
  summary.getCell('A2').font = { color: { argb: 'FF425466' }, italic: true }

  const firstWeek = passengers.filter((p) => p.travelPeriod === 'FIRST_WEEK').length
  const secondWeek = passengers.filter((p) => p.travelPeriod === 'SECOND_WEEK').length
  const bothWeeks = passengers.filter((p) => p.travelPeriod === 'BOTH_WEEKS').length
  const reviewCount = passengers.filter((p) => p.reviewStatus === 'REVIEW').length

  const summaryRows = [
    ['Indicador', 'Quantidade'],
    ['Total exportado', passengers.length],
    ['1ª semana', firstWeek],
    ['2ª semana', secondWeek],
    ['Duas semanas', bothWeeks],
    ['Cadastros para revisar', reviewCount],
  ]
  summaryRows.forEach((values, index) => {
    summary.getRow(4 + index).values = values
  })
  summary.getRow(4).font = { bold: true, color: { argb: 'FFFFFFFF' } }
  summary.getRow(4).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF153550' } }

  summary.getCell('D4').value = 'Como editar e importar novamente'
  summary.getCell('D4').font = { bold: true, color: { argb: 'FFFFFFFF' } }
  summary.getCell('D4').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF153550' } }
  summary.mergeCells('D4:F4')
  const instructions = [
    'Edite nome, documento, telefone, situação e observação diretamente nas linhas dos passageiros.',
    'No documento, mantenha o prefixo CPF:, RG: ou DOC: para indicar o tipo informado.',
    'Para mudar cidade, mova a linha para o bloco da cidade correta.',
    'Para mudar semana ou ônibus, mova a linha para a aba correspondente.',
    'Para incluir um passageiro novo, crie uma nova linha dentro do bloco da cidade correta. Não preencha as colunas técnicas ocultas.',
    'Não exclua passageiros para representar cancelamento. O aplicativo não apaga cadastros automaticamente durante uma importação.',
  ]
  instructions.forEach((instruction, index) => {
    const row = 5 + index
    summary.mergeCells(`D${row}:F${row}`)
    summary.getCell(`D${row}`).value = `${index + 1}. ${instruction}`
    summary.getCell(`D${row}`).alignment = { wrapText: true, vertical: 'top' }
  })

  summary.columns = [
    { width: 28 },
    { width: 14 },
    { width: 3 },
    { width: 32 },
    { width: 32 },
    { width: 32 },
  ]

  for (const period of PERIOD_ORDER) {
    for (const busType of BUS_ORDER) {
      const group = passengers
        .filter((passenger) => passenger.travelPeriod === period && passenger.busType === busType)
        .sort((a, b) => {
          const city = a.city.localeCompare(b.city, 'pt-BR')
          return city || a.fullName.localeCompare(b.fullName, 'pt-BR')
        })
      if (group.length === 0) continue

      const worksheet = workbook.addWorksheet(sheetName(period, busType), {
        properties: { defaultRowHeight: 18 },
        pageSetup: {
          orientation: 'landscape',
          paperSize: 9,
          fitToPage: true,
          fitToWidth: 1,
          margins: { left: 0.3, right: 0.3, top: 0.45, bottom: 0.45, header: 0.2, footer: 0.2 },
        },
      })

      worksheet.mergeCells('A1:F1')
      worksheet.getCell('A1').value = `${PERIOD_LABELS[period]} • ${BUS_LABELS[busType]}`
      worksheet.getCell('A1').font = { bold: true, size: 16, color: { argb: 'FFFFFFFF' } }
      worksheet.getCell('A1').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF153550' } }
      worksheet.getRow(1).height = 28

      worksheet.mergeCells('A2:F2')
      worksheet.getCell('A2').value = `${group.length} ${group.length === 1 ? 'passageiro' : 'passageiros'} • organizado por cidade e nome`
      worksheet.getCell('A2').font = { color: { argb: 'FF425466' }, italic: true }

      worksheet.getCell('J1').value = 'BAGAGENS_BARRETAO_PASSAGEIROS_V1'
      worksheet.getCell('J2').value = period
      worksheet.getCell('J3').value = busType
      worksheet.getColumn('G').hidden = true
      worksheet.getColumn('H').hidden = true
      worksheet.getColumn('I').hidden = true
      worksheet.getColumn('J').hidden = true
      worksheet.getColumn('K').hidden = true

      worksheet.columns = [
        { key: 'number', width: 6 },
        { key: 'name', width: 34 },
        { key: 'document', width: 22 },
        { key: 'phone', width: 18 },
        { key: 'status', width: 15 },
        { key: 'notes', width: 48 },
        { key: 'id', width: 2, hidden: true },
        { key: 'role', width: 2, hidden: true },
        { key: 'docType', width: 2, hidden: true },
        { key: 'meta', width: 2, hidden: true },
        { key: 'warning', width: 2, hidden: true },
      ]

      let currentRow = 4
      const cities = Array.from(new Set(group.map((passenger) => passenger.city))).sort((a, b) =>
        a.localeCompare(b, 'pt-BR'),
      )

      for (const city of cities) {
        const cityPassengers = group.filter((passenger) => passenger.city === city)

        worksheet.mergeCells(`A${currentRow}:F${currentRow}`)
        const cityCell = worksheet.getCell(`A${currentRow}`)
        cityCell.value = `CIDADE • ${city}`
        cityCell.font = { bold: true, size: 11, color: { argb: 'FF153550' } }
        cityCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8F3FB' } }
        cityCell.alignment = { vertical: 'middle' }
        worksheet.getRow(currentRow).height = 22
        currentRow += 1

        const header = worksheet.getRow(currentRow)
        header.values = ['Nº', 'Nome', 'Documento', 'Telefone', 'Cadastro', 'Observação', '__ID', '__FUNCAO', '__TIPO_DOC', '__ROW', '__ALERTA']
        header.font = { bold: true, color: { argb: 'FFFFFFFF' } }
        header.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0D2236' } }
        header.alignment = { vertical: 'middle', horizontal: 'left', wrapText: true }
        header.height = 22
        currentRow += 1

        cityPassengers.forEach((passenger, index) => {
          const row = worksheet.getRow(currentRow)
          row.values = [
            index + 1,
            passenger.fullName,
            documentLabel(passenger),
            passenger.phone,
            reviewLabel(passenger.reviewStatus),
            passengerObservation(passenger),
            passenger.id,
            passenger.sourceRole ?? 'PASSENGER',
            passenger.documentType,
            'PASSENGER',
            passenger.importWarning,
          ]
          row.alignment = { vertical: 'top', wrapText: true }
          row.height = Math.max(20, passengerObservation(passenger).length > 90 ? 42 : 24)

          for (let column = 1; column <= 6; column += 1) {
            const cell = row.getCell(column)
            cell.border = {
              top: { style: 'thin', color: { argb: 'FFCBD5DF' } },
              left: { style: 'thin', color: { argb: 'FFCBD5DF' } },
              bottom: { style: 'thin', color: { argb: 'FFCBD5DF' } },
              right: { style: 'thin', color: { argb: 'FFCBD5DF' } },
            }
            if (index % 2 === 1) {
              cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF8FAFB' } }
            }
          }

          row.getCell(5).dataValidation = {
            type: 'list',
            allowBlank: false,
            formulae: ['"Confirmado,Revisar"'],
          }
          if (passenger.reviewStatus === 'REVIEW') {
            row.getCell(5).font = { bold: true, color: { argb: 'FF8D4E00' } }
            row.getCell(5).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF1DC' } }
          }
          currentRow += 1
        })

        currentRow += 1
      }

      worksheet.views = [{ state: 'frozen', ySplit: 2 }]
      worksheet.headerFooter.oddFooter = `&LCaravana Flávio Gonçalves&C${PERIOD_LABELS[period]} • ${BUS_LABELS[busType]}&RPágina &P de &N`
    }
  }

  const rawBuffer = await workbook.xlsx.writeBuffer()
  const bytes = new Uint8Array(rawBuffer as ArrayBufferLike)
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
  return {
    buffer,
    fileName: suggestedFileName(options),
  }
}
