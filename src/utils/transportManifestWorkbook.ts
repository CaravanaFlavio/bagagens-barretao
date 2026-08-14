import type ExcelJS from 'exceljs'
import { TRAVEL_PERIOD_LABELS } from '../constants/travelPeriods'
import { STAGE_LABELS } from '../constants/operations'
import type { ContingencySnapshot, Passenger } from '../domain/types'

const NAVY = '0D2236'
const GRAY = 'F6F8FA'
const WHITE = 'FFFFFF'
const LINE = 'CBD5DF'
const TEXT = '15202B'
const MUTED = '425466'
const AMBER = 'FFF1DC'

function formatDateTime(value: string) {
  return new Date(value).toLocaleString('pt-BR', {
    dateStyle: 'short',
    timeStyle: 'short',
  })
}

function fileTimestamp(value: string) {
  const date = new Date(value)
  const pad = (number: number) => String(number).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}_${pad(date.getHours())}${pad(date.getMinutes())}`
}

function documentLabel(passenger: Passenger) {
  if (!passenger.documentNumber.trim()) return 'Não informado'
  const prefix = passenger.documentType === 'UNKNOWN' ? 'DOC' : passenger.documentType
  return `${prefix}: ${passenger.documentNumber}`
}

function passengerRows(snapshot: ContingencySnapshot) {
  const grouped = new Map<string, {
    passenger: Passenger
    luggageCodes: string[]
  }>()

  for (const row of snapshot.luggageRows) {
    const current = grouped.get(row.passenger.id) ?? {
      passenger: row.passenger,
      luggageCodes: [],
    }
    current.luggageCodes.push(row.luggage.code)
    grouped.set(row.passenger.id, current)
  }

  return Array.from(grouped.values())
    .map((item) => ({
      ...item,
      luggageCodes: [...item.luggageCodes].sort((a, b) =>
        a.localeCompare(b, 'pt-BR', { numeric: true }),
      ),
    }))
    .sort((a, b) => {
      const city = a.passenger.city.localeCompare(b.passenger.city, 'pt-BR')
      return city || a.passenger.fullName.localeCompare(b.passenger.fullName, 'pt-BR')
    })
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
  subtitleCell.font = { size: 10, color: { argb: MUTED }, italic: true }
  subtitleCell.alignment = { vertical: 'middle', wrapText: true }
  sheet.getRow(2).height = 25
}

function applyHeader(sheet: ExcelJS.Worksheet, rowNumber: number, columns: number) {
  const row = sheet.getRow(rowNumber)
  row.height = 30
  for (let column = 1; column <= columns; column += 1) {
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

export async function createTransportManifestWorkbook(snapshot: ContingencySnapshot) {
  const { default: ExcelJSRuntime } = await import('exceljs')
  const workbook = new ExcelJSRuntime.Workbook()
  workbook.creator = 'Caravana Flávio Gonçalves'
  workbook.title = 'Manifesto da carreta · Barretão 2026'
  workbook.subject = 'Relação operacional de passageiros e bagagens'
  workbook.created = new Date()
  workbook.modified = new Date()

  const passengers = passengerRows(snapshot)
  const totalLuggage = passengers.reduce(
    (total, item) => total + item.luggageCodes.length,
    0,
  )

  const manifest = workbook.addWorksheet('Manifesto', {
    views: [{ state: 'frozen', ySplit: 6 }],
    pageSetup: {
      paperSize: 9,
      orientation: 'landscape',
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 0,
      margins: {
        left: 0.3,
        right: 0.3,
        top: 0.45,
        bottom: 0.45,
        header: 0.2,
        footer: 0.2,
      },
    },
  })

  applyTitle(
    manifest,
    'MANIFESTO DA CARRETA · BARRETÃO 2026',
    `Relação operacional gerada em ${formatDateTime(snapshot.generatedAt)}. Confira a carga física antes da saída e gere uma nova versão após qualquer alteração.`,
    8,
  )

  manifest.getCell('A4').value = 'Passageiros com bagagem'
  manifest.getCell('B4').value = passengers.length
  manifest.getCell('D4').value = 'Total de volumes'
  manifest.getCell('E4').value = totalLuggage
  manifest.getCell('G4').value = 'Última alteração'
  manifest.getCell('H4').value = formatDateTime(snapshot.latestDataAt)

  for (const ref of ['A4', 'D4', 'G4']) {
    manifest.getCell(ref).font = { bold: true, color: { argb: MUTED } }
  }
  for (const ref of ['B4', 'E4', 'H4']) {
    manifest.getCell(ref).font = { bold: true, color: { argb: NAVY }, size: 12 }
  }

  manifest.addRow([])
  manifest.addRow([
    'Nº',
    'Passageiro',
    'CPF / Documento',
    'Telefone',
    'Cidade',
    'Período',
    'Volumes',
    'Lacres / Códigos',
  ])
  applyHeader(manifest, 6, 8)

  passengers.forEach((item, index) => {
    const row = manifest.addRow([
      index + 1,
      item.passenger.fullName,
      documentLabel(item.passenger),
      item.passenger.phone || 'Não informado',
      item.passenger.city,
      TRAVEL_PERIOD_LABELS[item.passenger.travelPeriod],
      item.luggageCodes.length,
      item.luggageCodes.join(', '),
    ])

    row.height = item.luggageCodes.length > 5 ? 34 : 26
    row.alignment = { vertical: 'top', wrapText: true }

    for (let column = 1; column <= 8; column += 1) {
      const cell = row.getCell(column)
      cell.font = { size: 9, color: { argb: TEXT } }
      cell.border = {
        bottom: { style: 'hair', color: { argb: LINE } },
      }
      if (index % 2 === 1) {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: GRAY } }
      }
    }

    if (!item.passenger.documentNumber.trim()) {
      row.getCell(3).fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: AMBER },
      }
      row.getCell(3).font = { bold: true, color: { argb: TEXT }, size: 9 }
    }
  })

  ;[7, 34, 24, 18, 22, 17, 10, 54].forEach((width, index) => {
    manifest.getColumn(index + 1).width = width
  })

  manifest.autoFilter = {
    from: { row: 6, column: 1 },
    to: { row: Math.max(manifest.rowCount, 6), column: 8 },
  }
  manifest.headerFooter.oddFooter =
    '&LCaravana Flávio Gonçalves&CManifesto da carreta&R&P de &N'

  const volumes = workbook.addWorksheet('Volumes', {
    views: [{ state: 'frozen', ySplit: 4 }],
    pageSetup: {
      paperSize: 9,
      orientation: 'landscape',
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 0,
    },
  })

  applyTitle(
    volumes,
    'RELAÇÃO INDIVIDUAL DOS VOLUMES',
    'Uma linha por bagagem, permitindo conferir o código do lacre e o passageiro responsável.',
    8,
  )
  volumes.addRow([])
  volumes.addRow([
    'Nº',
    'Lacre / Código',
    'Passageiro',
    'CPF / Documento',
    'Telefone',
    'Cidade',
    'Período',
    'Situação atual',
  ])
  applyHeader(volumes, 4, 8)

  const sortedVolumes = [...snapshot.luggageRows].sort((a, b) => {
    const city = a.passenger.city.localeCompare(b.passenger.city, 'pt-BR')
    const name = a.passenger.fullName.localeCompare(b.passenger.fullName, 'pt-BR')
    return city || name || a.luggage.code.localeCompare(b.luggage.code, 'pt-BR', { numeric: true })
  })

  sortedVolumes.forEach((item, index) => {
    const row = volumes.addRow([
      index + 1,
      item.luggage.code,
      item.passenger.fullName,
      documentLabel(item.passenger),
      item.passenger.phone || 'Não informado',
      item.passenger.city,
      TRAVEL_PERIOD_LABELS[item.passenger.travelPeriod],
      STAGE_LABELS[item.luggage.currentStage],
    ])
    row.height = 24
    row.alignment = { vertical: 'middle', wrapText: true }

    for (let column = 1; column <= 8; column += 1) {
      const cell = row.getCell(column)
      cell.font = { size: 9, color: { argb: TEXT } }
      cell.border = { bottom: { style: 'hair', color: { argb: LINE } } }
      if (index % 2 === 1) {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: GRAY } }
      }
    }

    row.getCell(2).font = { bold: true, color: { argb: NAVY }, size: 10 }
  })

  ;[7, 18, 34, 24, 18, 22, 17, 22].forEach((width, index) => {
    volumes.getColumn(index + 1).width = width
  })
  volumes.autoFilter = `A4:H${Math.max(volumes.rowCount, 4)}`
  volumes.headerFooter.oddFooter =
    '&LCaravana Flávio Gonçalves&CVolumes vinculados&R&P de &N'

  const note = workbook.addWorksheet('Orientações')
  applyTitle(
    note,
    'ORIENTAÇÕES DO MANIFESTO',
    'Documento operacional de identificação e conferência dos volumes transportados.',
    4,
  )
  note.getColumn(1).width = 4
  note.getColumn(2).width = 105
  note.mergeCells('B4:D4')
  note.getCell('B4').value =
    'Este arquivo relaciona os volumes cadastrados no aplicativo aos respectivos passageiros. Ele não substitui documentos fiscais, autorizações ou exigências específicas eventualmente aplicáveis ao transporte.'
  note.getCell('B4').alignment = { wrapText: true, vertical: 'top' }
  note.getCell('B4').font = { color: { argb: MUTED }, size: 11 }
  note.getRow(4).height = 55

  const guidance = [
    'Confirme se todos os volumes físicos estão cadastrados antes de gerar a versão entregue ao motorista.',
    'Após qualquer inclusão, exclusão ou correção de bagagem, gere novamente o manifesto.',
    'A coluna “Lacres / Códigos” é a ligação direta entre o passageiro e cada volume cadastrado.',
    'Documentos não informados aparecem destacados para conferência antes da saída.',
    'A aba “Volumes” apresenta uma linha individual para cada bagagem e facilita a identificação em uma fiscalização.',
  ]

  guidance.forEach((text, index) => {
    const rowNumber = 6 + index
    note.getCell(`A${rowNumber}`).value = index + 1
    note.getCell(`A${rowNumber}`).font = { bold: true, color: { argb: NAVY } }
    note.mergeCells(`B${rowNumber}:D${rowNumber}`)
    note.getCell(`B${rowNumber}`).value = text
    note.getCell(`B${rowNumber}`).alignment = { wrapText: true, vertical: 'top' }
    note.getRow(rowNumber).height = 32
  })

  const rawBuffer = await workbook.xlsx.writeBuffer()
  const bytes = new Uint8Array(rawBuffer as ArrayBufferLike)
  const buffer = bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer

  return {
    blob: new Blob([buffer], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    }),
    fileName: `Manifesto_Carreta_Barretao_${fileTimestamp(snapshot.generatedAt)}.xlsx`,
  }
}
