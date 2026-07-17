import type ExcelJS from 'exceljs'
import { CITIES } from '../constants/cities'
import { STAGE_LABELS } from '../constants/operations'
import { TRAVEL_PERIOD_LABELS } from '../constants/travelPeriods'
import type {
  ContingencyLuggageRow,
  ContingencySnapshot,
  LuggageMovement,
  OperationKey,
  TravelPeriod,
} from '../domain/types'

const NAVY = '0D2236'
const GREEN = 'E6F6EF'
const AMBER = 'FFF1DC'
const GRAY = 'EEF3F7'
const WHITE = 'FFFFFF'
const LINE = 'DCE4EB'
const TEXT = '15202B'
const MUTED = '425466'

const CONTROL_HEADERS = [
  'Cidade',
  'Passageiro',
  'Telefone',
  'Período',
  'Código do lacre',
  'Tipo da bagagem',
  'Cor da etiqueta',
  'Status atual',
  'Recebida no galpão',
  'Galpão → carreta',
  'Entrega da 1ª semana',
  'Recolhimento da 1ª semana',
  'Entrega da 2ª semana',
  'Recolhimento final',
  'Carreta → galpão',
  'Entregue à cidade',
  'Responsável pela cidade',
  'Veículo',
  'Placa',
  'Observações',
]

const CITY_CONTROL_HEADERS = CONTROL_HEADERS.slice(1)

function formatDateTime(value: string | undefined) {
  if (!value) return ''
  return new Date(value).toLocaleString('pt-BR', {
    dateStyle: 'short',
    timeStyle: 'short',
  })
}

function movementForOperation(
  row: ContingencyLuggageRow,
  operationKey: OperationKey,
): LuggageMovement | undefined {
  const exact = row.movements.find((movement) => movement.operationKey === operationKey)
  if (exact) return exact

  const period = row.passenger.travelPeriod
  return row.movements.find((movement) => {
    if (operationKey === 'WAREHOUSE_TO_TRAILER') {
      return movement.type === 'WAREHOUSE_TO_TRAILER'
    }
    if (operationKey === 'TRAILER_TO_WAREHOUSE') {
      return movement.type === 'TRAILER_TO_WAREHOUSE'
    }
    if (movement.type === 'TRAILER_TO_PASSENGER') {
      return period === 'SECOND_WEEK'
        ? operationKey === 'DELIVER_SECOND_WEEK'
        : operationKey === 'DELIVER_FIRST_WEEK'
    }
    if (movement.type === 'PASSENGER_TO_TRAILER') {
      return period === 'FIRST_WEEK'
        ? operationKey === 'COLLECT_FIRST_WEEK'
        : operationKey === 'COLLECT_SECOND_WEEK'
    }
    return false
  })
}

function isApplicable(period: TravelPeriod, operationKey: OperationKey) {
  if (operationKey === 'WAREHOUSE_TO_TRAILER' || operationKey === 'TRAILER_TO_WAREHOUSE') {
    return true
  }
  if (operationKey === 'DELIVER_FIRST_WEEK') {
    return period === 'FIRST_WEEK' || period === 'BOTH_WEEKS'
  }
  if (operationKey === 'COLLECT_FIRST_WEEK') {
    return period === 'FIRST_WEEK'
  }
  if (operationKey === 'DELIVER_SECOND_WEEK') {
    return period === 'SECOND_WEEK'
  }
  return period === 'SECOND_WEEK' || period === 'BOTH_WEEKS'
}

function stageControlValue(
  row: ContingencyLuggageRow,
  operationKey: OperationKey,
) {
  if (!isApplicable(row.passenger.travelPeriod, operationKey)) return 'NÃO SE APLICA'
  const movement = movementForOperation(row, operationKey)
  return movement ? `✓ ${formatDateTime(movement.occurredAt)}` : '☐ PENDENTE'
}

function registeredValue(row: ContingencyLuggageRow) {
  const movement = row.movements.find(
    (item) => item.type === 'REGISTERED_AT_WAREHOUSE',
  )
  return movement ? `✓ ${formatDateTime(movement.occurredAt)}` : '☐ PENDENTE'
}

function cityDeliveryValue(row: ContingencyLuggageRow) {
  const movement = row.movements.find((item) => item.type === 'WAREHOUSE_TO_CITY')
  return movement ? `✓ ${formatDateTime(movement.occurredAt)}` : '☐ PENDENTE'
}

function controlRow(row: ContingencyLuggageRow) {
  const transfer = row.cityTransfer
  return [
    row.passenger.city,
    row.passenger.fullName,
    row.passenger.phone,
    TRAVEL_PERIOD_LABELS[row.passenger.travelPeriod],
    row.luggage.code,
    row.luggage.luggageType,
    row.luggage.labelColor,
    STAGE_LABELS[row.luggage.currentStage],
    registeredValue(row),
    stageControlValue(row, 'WAREHOUSE_TO_TRAILER'),
    stageControlValue(row, 'DELIVER_FIRST_WEEK'),
    stageControlValue(row, 'COLLECT_FIRST_WEEK'),
    stageControlValue(row, 'DELIVER_SECOND_WEEK'),
    stageControlValue(row, 'COLLECT_SECOND_WEEK'),
    stageControlValue(row, 'TRAILER_TO_WAREHOUSE'),
    cityDeliveryValue(row),
    transfer?.responsibleName || null,
    transfer?.vehicleDescription || null,
    transfer?.vehiclePlate || null,
    [row.passenger.notes, row.luggage.notes].filter(Boolean).join(' | ') || null,
  ]
}

function applyTitle(
  sheet: ExcelJS.Worksheet,
  title: string,
  subtitle: string,
  columns: number,
) {
  sheet.mergeCells(1, 1, 1, columns)
  const titleCell = sheet.getCell(1, 1)
  titleCell.value = title
  titleCell.font = { bold: true, size: 18, color: { argb: WHITE } }
  titleCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: NAVY } }
  titleCell.alignment = { vertical: 'middle', horizontal: 'left' }
  sheet.getRow(1).height = 30

  sheet.mergeCells(2, 1, 2, columns)
  const subtitleCell = sheet.getCell(2, 1)
  subtitleCell.value = subtitle
  subtitleCell.font = { size: 10, color: { argb: MUTED } }
  subtitleCell.alignment = { vertical: 'middle', wrapText: true }
  sheet.getRow(2).height = 26
}

function applyHeader(sheet: ExcelJS.Worksheet, rowNumber: number, columnCount: number) {
  const row = sheet.getRow(rowNumber)
  row.height = 34
  for (let column = 1; column <= columnCount; column += 1) {
    const cell = row.getCell(column)
    cell.font = { bold: true, color: { argb: WHITE }, size: 10 }
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: NAVY } }
    cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true }
    cell.border = {
      top: { style: 'thin', color: { argb: LINE } },
      bottom: { style: 'thin', color: { argb: LINE } },
      left: { style: 'thin', color: { argb: LINE } },
      right: { style: 'thin', color: { argb: LINE } },
    }
  }
}

function styleControlRows(
  sheet: ExcelJS.Worksheet,
  firstDataRow: number,
  lastDataRow: number,
  firstStageColumn: number,
  lastStageColumn: number,
) {
  for (let rowNumber = firstDataRow; rowNumber <= lastDataRow; rowNumber += 1) {
    const row = sheet.getRow(rowNumber)
    row.height = 29
    row.alignment = { vertical: 'middle', wrapText: true }
    row.font = { size: 9, color: { argb: TEXT } }

    for (let column = 1; column <= sheet.columnCount; column += 1) {
      const cell = row.getCell(column)
      cell.border = {
        bottom: { style: 'hair', color: { argb: LINE } },
      }
      if (rowNumber % 2 === 0 && column < firstStageColumn) {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'F8FAFB' } }
      }
    }

    for (let column = firstStageColumn; column <= lastStageColumn; column += 1) {
      const cell = row.getCell(column)
      const value = String(cell.value ?? '')
      const fill = value.startsWith('✓')
        ? GREEN
        : value === 'NÃO SE APLICA'
          ? GRAY
          : AMBER
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: fill } }
      cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true }
      cell.font = { size: 8, color: { argb: TEXT }, bold: value.startsWith('✓') }
    }
  }
}

function configureControlColumns(sheet: ExcelJS.Worksheet, includeCity: boolean) {
  const widths = includeCity
    ? [20, 28, 16, 16, 15, 16, 14, 20, 19, 19, 20, 20, 20, 19, 19, 19, 22, 18, 13, 32]
    : [28, 16, 16, 15, 16, 14, 20, 19, 19, 20, 20, 20, 19, 19, 19, 22, 18, 13, 32]
  widths.forEach((width, index) => {
    sheet.getColumn(index + 1).width = width
  })
}

function addControlSheet(
  workbook: ExcelJS.Workbook,
  name: string,
  rows: ContingencyLuggageRow[],
  generatedAt: string,
  includeCity: boolean,
) {
  const headers = includeCity ? CONTROL_HEADERS : CITY_CONTROL_HEADERS
  const sheet = workbook.addWorksheet(name, {
    views: [{ state: 'frozen', ySplit: 4, xSplit: includeCity ? 4 : 3 }],
    pageSetup: {
      paperSize: 9,
      orientation: 'landscape',
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 0,
      margins: {
        left: 0.25,
        right: 0.25,
        top: 0.45,
        bottom: 0.45,
        header: 0.2,
        footer: 0.2,
      },
    },
  })
  sheet.properties.defaultRowHeight = 22
  sheet.pageSetup.printTitlesRow = '4:4'
  sheet.headerFooter.oddFooter =
    '&LPlano de contingência&C&P de &N&RCaravana Flávio Gonçalves'

  applyTitle(
    sheet,
    includeCity ? 'Plano de contingência das bagagens' : `Controle manual · ${name.replace('Cidade - ', '')}`,
    `Gerado em ${formatDateTime(generatedAt)}. Células com ☐ podem ser preenchidas manualmente em caso de contingência.`,
    headers.length,
  )
  sheet.addRow([])
  sheet.addRow(headers)
  applyHeader(sheet, 4, headers.length)

  for (const item of rows) {
    const values = controlRow(item)
    sheet.addRow(includeCity ? values : values.slice(1))
  }

  configureControlColumns(sheet, includeCity)
  const lastRow = Math.max(sheet.rowCount, 4)
  sheet.autoFilter = {
    from: { row: 4, column: 1 },
    to: { row: lastRow, column: headers.length },
  }
  if (lastRow >= 5) {
    styleControlRows(
      sheet,
      5,
      lastRow,
      includeCity ? 9 : 8,
      includeCity ? 16 : 15,
    )
  }
  return sheet
}

function addPassengerSheet(workbook: ExcelJS.Workbook, snapshot: ContingencySnapshot) {
  const sheet = workbook.addWorksheet('Passageiros', {
    views: [{ state: 'frozen', ySplit: 4 }],
    pageSetup: { paperSize: 9, orientation: 'landscape', fitToPage: true, fitToWidth: 1 },
  })
  const headers = ['Cidade', 'Passageiro', 'Telefone', 'Período', 'Bagagens', 'Observações']
  applyTitle(
    sheet,
    'Passageiros cadastrados',
    `Relação gerada em ${formatDateTime(snapshot.generatedAt)}.`,
    headers.length,
  )
  sheet.addRow([])
  sheet.addRow(headers)
  applyHeader(sheet, 4, headers.length)
  for (const item of snapshot.passengers) {
    sheet.addRow([
      item.passenger.city,
      item.passenger.fullName,
      item.passenger.phone,
      TRAVEL_PERIOD_LABELS[item.passenger.travelPeriod],
      item.luggageCount,
      item.passenger.notes,
    ])
  }
  ;[21, 30, 17, 18, 12, 42].forEach((width, index) => {
    sheet.getColumn(index + 1).width = width
  })
  for (let rowNumber = 5; rowNumber <= sheet.rowCount; rowNumber += 1) {
    const row = sheet.getRow(rowNumber)
    row.height = 25
    row.alignment = { vertical: 'middle', wrapText: true }
    if (rowNumber % 2 === 0) {
      row.eachCell((cell) => {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'F8FAFB' } }
      })
    }
  }
  sheet.autoFilter = `A4:F${Math.max(sheet.rowCount, 4)}`
}

function addSummarySheet(workbook: ExcelJS.Workbook, snapshot: ContingencySnapshot) {
  const sheet = workbook.addWorksheet('Resumo', {
    views: [{ state: 'frozen', ySplit: 5 }],
    pageSetup: { paperSize: 9, orientation: 'landscape', fitToPage: true, fitToWidth: 1 },
  })
  applyTitle(
    sheet,
    'Resumo da operação',
    `Fotografia dos dados em ${formatDateTime(snapshot.generatedAt)}.`,
    9,
  )
  sheet.addRow([])
  sheet.addRow(['Passageiros', snapshot.passengerCount, '', 'Bagagens', snapshot.luggageCount, '', 'Última alteração', formatDateTime(snapshot.latestDataAt), ''])
  sheet.mergeCells('A4:A4')
  for (const cellRef of ['A4', 'D4', 'G4']) {
    const cell = sheet.getCell(cellRef)
    cell.font = { bold: true, color: { argb: MUTED } }
  }
  for (const cellRef of ['B4', 'E4', 'H4']) {
    const cell = sheet.getCell(cellRef)
    cell.font = { bold: true, size: 14, color: { argb: NAVY } }
  }

  sheet.addRow([])
  sheet.addRow(['Resumo por município'])
  sheet.getCell('A6').font = { bold: true, size: 13, color: { argb: NAVY } }
  const cityHeaderRow = 7
  sheet.addRow([
    'Cidade',
    'Passageiros',
    'Bagagens',
    'No galpão',
    'Carreta de ida',
    'Com passageiro',
    'Carreta retorno',
    'Galpão retorno',
    'Entregues à cidade',
  ])
  applyHeader(sheet, cityHeaderRow, 9)
  for (const summary of snapshot.citySummaries) {
    sheet.addRow([
      summary.city,
      summary.passengerCount,
      summary.luggageCount,
      summary.stageCounts.WAREHOUSE_INITIAL,
      summary.stageCounts.TRAILER_OUTBOUND,
      summary.stageCounts.WITH_PASSENGER,
      summary.stageCounts.TRAILER_RETURN,
      summary.stageCounts.WAREHOUSE_RETURN,
      summary.stageCounts.DELIVERED_TO_CITY,
    ])
  }

  const periodTitleRow = sheet.rowCount + 2
  sheet.getCell(periodTitleRow, 1).value = 'Resumo por período'
  sheet.getCell(periodTitleRow, 1).font = { bold: true, size: 13, color: { argb: NAVY } }
  const periodHeaderRow = periodTitleRow + 1
  sheet.getRow(periodHeaderRow).values = [
    'Período',
    'Passageiros',
    'Bagagens',
    'No galpão',
    'Carreta de ida',
    'Com passageiro',
    'Carreta retorno',
    'Galpão retorno',
    'Entregues à cidade',
  ]
  applyHeader(sheet, periodHeaderRow, 9)
  for (const summary of snapshot.periodSummaries) {
    sheet.addRow([
      TRAVEL_PERIOD_LABELS[summary.travelPeriod],
      summary.passengerCount,
      summary.luggageCount,
      summary.stageCounts.WAREHOUSE_INITIAL,
      summary.stageCounts.TRAILER_OUTBOUND,
      summary.stageCounts.WITH_PASSENGER,
      summary.stageCounts.TRAILER_RETURN,
      summary.stageCounts.WAREHOUSE_RETURN,
      summary.stageCounts.DELIVERED_TO_CITY,
    ])
  }

  ;[22, 13, 13, 15, 16, 17, 17, 17, 18].forEach((width, index) => {
    sheet.getColumn(index + 1).width = width
  })
  for (let rowNumber = 8; rowNumber <= sheet.rowCount; rowNumber += 1) {
    const row = sheet.getRow(rowNumber)
    row.height = 23
    row.alignment = { vertical: 'middle', horizontal: rowNumber >= periodHeaderRow ? 'center' : undefined }
  }
}

function addInstructionsSheet(workbook: ExcelJS.Workbook, snapshot: ContingencySnapshot) {
  const sheet = workbook.addWorksheet('Instruções')
  applyTitle(
    sheet,
    'Como usar o plano de contingência',
    `Arquivo gerado em ${formatDateTime(snapshot.generatedAt)}.`,
    6,
  )
  sheet.getColumn(1).width = 4
  sheet.getColumn(2).width = 26
  sheet.getColumn(3).width = 80
  sheet.getColumn(4).width = 16
  sheet.getColumn(5).width = 16
  sheet.getColumn(6).width = 16

  const instructions = [
    ['1', 'Antes da operação', 'Gere uma nova planilha e salve uma cópia no computador, celular reserva ou nuvem.'],
    ['2', 'Em caso de falha', 'Use a aba Controle Geral ou a aba da cidade. Cada linha representa uma bagagem individual.'],
    ['3', 'Marcação manual', 'Substitua “☐ PENDENTE” pela data e pelo horário da ação, ou marque com X durante a conferência em papel.'],
    ['4', 'Não se aplica', 'Não altere as células “NÃO SE APLICA”. Elas representam etapas que não pertencem ao período do passageiro.'],
    ['5', 'Retorno ao aplicativo', 'Quando o aplicativo voltar, concilie os registros manualmente com cuidado para evitar movimentos duplicados.'],
  ]
  let rowNumber = 4
  for (const [number, title, description] of instructions) {
    sheet.getCell(rowNumber, 1).value = number
    sheet.getCell(rowNumber, 1).font = { bold: true, size: 13, color: { argb: WHITE } }
    sheet.getCell(rowNumber, 1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: NAVY } }
    sheet.getCell(rowNumber, 1).alignment = { horizontal: 'center', vertical: 'middle' }
    sheet.getCell(rowNumber, 2).value = title
    sheet.getCell(rowNumber, 2).font = { bold: true, color: { argb: NAVY } }
    sheet.getCell(rowNumber, 3).value = description
    sheet.getCell(rowNumber, 3).alignment = { wrapText: true, vertical: 'middle' }
    sheet.getRow(rowNumber).height = 38
    rowNumber += 1
  }

  rowNumber += 1
  sheet.getCell(rowNumber, 2).value = 'Legenda'
  sheet.getCell(rowNumber, 2).font = { bold: true, size: 13, color: { argb: NAVY } }
  rowNumber += 1
  const legend = [
    ['✓ Data e hora', 'Etapa já registrada no aplicativo.', GREEN],
    ['☐ PENDENTE', 'Etapa ainda não registrada. Pode ser preenchida manualmente.', AMBER],
    ['NÃO SE APLICA', 'Etapa incompatível com o período do passageiro.', GRAY],
  ]
  for (const [status, description, fill] of legend) {
    sheet.getCell(rowNumber, 2).value = status
    sheet.getCell(rowNumber, 2).font = { bold: true, color: { argb: TEXT } }
    sheet.getCell(rowNumber, 2).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: fill } }
    sheet.getCell(rowNumber, 3).value = description
    sheet.getRow(rowNumber).height = 28
    rowNumber += 1
  }
}

export async function createContingencyWorkbook(snapshot: ContingencySnapshot) {
  const { default: ExcelJSRuntime } = await import('exceljs')
  const workbook = new ExcelJSRuntime.Workbook()
  workbook.creator = 'Caravana Flávio Gonçalves'
  workbook.lastModifiedBy = 'Aplicativo Bagagens Barretão'
  workbook.created = new Date(snapshot.generatedAt)
  workbook.modified = new Date(snapshot.generatedAt)
  workbook.subject = 'Plano de contingência para controle manual das bagagens'
  workbook.title = 'Plano de Contingência das Bagagens'

  addSummarySheet(workbook, snapshot)
  addControlSheet(workbook, 'Controle Geral', snapshot.luggageRows, snapshot.generatedAt, true)
  addPassengerSheet(workbook, snapshot)

  for (const city of CITIES) {
    const cityRows = snapshot.luggageRows.filter((row) => row.passenger.city === city)
    if (cityRows.length === 0) continue
    addControlSheet(
      workbook,
      `Cidade - ${city}`.slice(0, 31),
      cityRows,
      snapshot.generatedAt,
      false,
    )
  }

  addInstructionsSheet(workbook, snapshot)
  const buffer = await workbook.xlsx.writeBuffer()
  return new Blob([new Uint8Array(buffer)], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  })
}
