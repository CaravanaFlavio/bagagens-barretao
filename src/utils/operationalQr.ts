import { BrowserQRCodeSvgWriter } from '@zxing/browser'

const PASSENGER_PREFIX = 'BB26|P|'
const LUGGAGE_PREFIX = 'BB26|L|'
const COMPACT_PASSENGER_PREFIX = 'P:'
const COMPACT_LUGGAGE_PREFIX = 'L:'

export interface PassengerQrInfo {
  fullName: string
  city: string
  travelPeriod: string
  busType: string
}

export interface LuggageQrInfo extends PassengerQrInfo {
  code: string
  luggageType: string
  volumePosition?: string
}

export type OperationalQrPayload =
  | { kind: 'PASSENGER'; id: string }
  | { kind: 'LUGGAGE'; id: string }
  | { kind: 'EXTERNAL_CODE'; code: string }

function cleanLine(value: string) {
  return value.replace(/[\r\n]+/g, ' ').trim()
}

function compactPeriod(value: string) {
  return cleanLine(value)
    .replace(/1ª/g, '1a')
    .replace(/2ª/g, '2a')
}

function compactBus(value: string) {
  return cleanLine(value)
    .replace(/^Ônibus\s+/i, '')
    .replace(/^Onibus\s+/i, '')
}

function compactRecordId(id: string, prefix: 'passenger' | 'luggage') {
  const expectedPrefix = `${prefix}_`
  return id.startsWith(expectedPrefix) ? id.slice(expectedPrefix.length) : id
}

function restoreRecordId(value: string, prefix: 'passenger' | 'luggage') {
  const clean = value.trim()
  if (!clean) return clean
  return clean.startsWith(`${prefix}_`) ? clean : `${prefix}_${clean}`
}

export function passengerQrValue(passengerId: string, info?: PassengerQrInfo) {
  const technicalId = `${PASSENGER_PREFIX}${passengerId}`
  if (!info) return technicalId

  return [
    'BARRETAO 2026',
    'PASSAGEIRO',
    cleanLine(info.fullName),
    cleanLine(info.city),
    `${compactPeriod(info.travelPeriod)} | ${compactBus(info.busType)}`,
    `${COMPACT_PASSENGER_PREFIX}${compactRecordId(passengerId, 'passenger')}`,
  ].join('\n')
}

export function luggageQrValue(luggageId: string, info?: LuggageQrInfo) {
  const technicalId = `${LUGGAGE_PREFIX}${luggageId}`
  if (!info) return technicalId

  return [
    'BARRETAO 2026',
    'VOLUME SEM LACRE',
    cleanLine(info.fullName),
    cleanLine(info.city),
    `${compactPeriod(info.travelPeriod)} | ${compactBus(info.busType)}`,
    `${info.volumePosition ? `${cleanLine(info.volumePosition)} | ` : ''}${cleanLine(info.luggageType)}`,
    `COD ${cleanLine(info.code)}`,
    `${COMPACT_LUGGAGE_PREFIX}${compactRecordId(luggageId, 'luggage')}`,
  ].join('\n')
}

export function parseOperationalQr(value: string): OperationalQrPayload {
  const trimmed = value.trim()

  // Compatibilidade com QRs antigos: BB26|P|... e BB26|L|...
  const passengerMatch = trimmed.match(/BB26\|P\|([^\s\r\n]+)/)
  if (passengerMatch?.[1]) {
    return { kind: 'PASSENGER', id: passengerMatch[1] }
  }

  const luggageMatch = trimmed.match(/BB26\|L\|([^\s\r\n]+)/)
  if (luggageMatch?.[1]) {
    return { kind: 'LUGGAGE', id: luggageMatch[1] }
  }

  // Novo formato compacto. Mantém dados básicos legíveis fora do app,
  // mas reduz bastante a densidade do QR impresso.
  const compactPassengerMatch = trimmed.match(/(?:^|\r?\n)P:([A-Za-z0-9_-]+)/)
  if (compactPassengerMatch?.[1]) {
    return {
      kind: 'PASSENGER',
      id: restoreRecordId(compactPassengerMatch[1], 'passenger'),
    }
  }

  const compactLuggageMatch = trimmed.match(/(?:^|\r?\n)L:([A-Za-z0-9_-]+)/)
  if (compactLuggageMatch?.[1]) {
    return {
      kind: 'LUGGAGE',
      id: restoreRecordId(compactLuggageMatch[1], 'luggage'),
    }
  }

  return { kind: 'EXTERNAL_CODE', code: trimmed }
}

export function createQrSvgDataUrl(value: string, size = 720) {
  const writer = new BrowserQRCodeSvgWriter()
  const svg = writer.write(value, size, size)
  svg.setAttribute('xmlns', 'http://www.w3.org/2000/svg')
  svg.setAttribute('role', 'img')
  svg.setAttribute('aria-label', 'QR Code')
  svg.setAttribute('preserveAspectRatio', 'xMidYMid meet')
  svg.setAttribute('shape-rendering', 'crispEdges')

  // O fundo branco faz parte do próprio QR. Assim, baixar e imprimir
  // usam exatamente a mesma arte, sem depender do fundo da página.
  const background = document.createElementNS('http://www.w3.org/2000/svg', 'rect')
  background.setAttribute('x', '0')
  background.setAttribute('y', '0')
  background.setAttribute('width', '100%')
  background.setAttribute('height', '100%')
  background.setAttribute('fill', '#ffffff')
  svg.insertBefore(background, svg.firstChild)

  const serialized = new XMLSerializer().serializeToString(svg)
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(serialized)}`
}

export function downloadQrSvg(value: string, fileName: string) {
  const url = createQrSvgDataUrl(value)
  const link = document.createElement('a')
  link.href = url
  link.download = fileName.endsWith('.svg') ? fileName : `${fileName}.svg`
  document.body.appendChild(link)
  link.click()
  link.remove()
}
