import type { PhotoInput } from '../domain/types'

const MAX_DIMENSION = 1600
const TARGET_BYTES = 850_000
const QUALITY_STEPS = [0.82, 0.74, 0.66, 0.58, 0.5]

function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    const objectUrl = URL.createObjectURL(file)

    image.onload = () => {
      URL.revokeObjectURL(objectUrl)
      resolve(image)
    }
    image.onerror = () => {
      URL.revokeObjectURL(objectUrl)
      reject(new Error('Não foi possível abrir esta imagem. Tente outra foto.'))
    }
    image.src = objectUrl
  })
}

function canvasToBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) resolve(blob)
        else reject(new Error('Não foi possível comprimir a fotografia.'))
      },
      'image/jpeg',
      quality,
    )
  })
}

export async function compressPhoto(file: File): Promise<PhotoInput> {
  if (!file.type.startsWith('image/')) {
    throw new Error('Selecione um arquivo de imagem.')
  }

  const image = await loadImage(file)
  const scale = Math.min(1, MAX_DIMENSION / Math.max(image.naturalWidth, image.naturalHeight))
  const width = Math.max(1, Math.round(image.naturalWidth * scale))
  const height = Math.max(1, Math.round(image.naturalHeight * scale))

  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height

  const context = canvas.getContext('2d')
  if (!context) {
    throw new Error('O aparelho não conseguiu preparar a fotografia.')
  }

  context.fillStyle = '#ffffff'
  context.fillRect(0, 0, width, height)
  context.drawImage(image, 0, 0, width, height)

  let compressed = await canvasToBlob(canvas, QUALITY_STEPS[0])
  for (const quality of QUALITY_STEPS.slice(1)) {
    if (compressed.size <= TARGET_BYTES) break
    compressed = await canvasToBlob(canvas, quality)
  }

  return {
    blob: compressed,
    mimeType: compressed.type || 'image/jpeg',
    sizeBytes: compressed.size,
    width,
    height,
  }
}
