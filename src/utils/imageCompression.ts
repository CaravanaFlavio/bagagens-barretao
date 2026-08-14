import type { PhotoInput } from '../domain/types'

const MAX_DIMENSION = 1280
const TARGET_BYTES = 220_000
const HARD_LIMIT_BYTES = 350_000
const MIN_LONG_EDGE = 720
const QUALITY_STEPS = [0.72, 0.64, 0.56, 0.48, 0.42]
const RESIZE_FACTOR = 0.86

function loadImage(blob: Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    const objectUrl = URL.createObjectURL(blob)

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

function canvasToBlob(
  canvas: HTMLCanvasElement,
  mimeType: 'image/webp' | 'image/jpeg',
  quality: number,
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) resolve(blob)
        else reject(new Error('Não foi possível comprimir a fotografia.'))
      },
      mimeType,
      quality,
    )
  })
}

async function encodeCanvas(canvas: HTMLCanvasElement, quality: number) {
  const webp = await canvasToBlob(canvas, 'image/webp', quality)
  if (webp.type === 'image/webp') return webp
  return canvasToBlob(canvas, 'image/jpeg', quality)
}

function fitDimensions(
  originalWidth: number,
  originalHeight: number,
  maxDimension: number,
) {
  const scale = Math.min(1, maxDimension / Math.max(originalWidth, originalHeight))
  return {
    width: Math.max(1, Math.round(originalWidth * scale)),
    height: Math.max(1, Math.round(originalHeight * scale)),
  }
}

function drawImage(
  image: HTMLImageElement,
  width: number,
  height: number,
) {
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
  return canvas
}

export async function compressPhotoBlob(blob: Blob): Promise<PhotoInput> {
  if (!blob.type.startsWith('image/')) {
    throw new Error('Selecione um arquivo de imagem.')
  }

  const image = await loadImage(blob)
  let maxDimension = MAX_DIMENSION
  let bestResult: PhotoInput | null = null

  while (maxDimension >= MIN_LONG_EDGE) {
    const { width, height } = fitDimensions(
      image.naturalWidth,
      image.naturalHeight,
      maxDimension,
    )
    const canvas = drawImage(image, width, height)

    for (const quality of QUALITY_STEPS) {
      const compressed = await encodeCanvas(canvas, quality)
      const result: PhotoInput = {
        blob: compressed,
        mimeType: compressed.type || 'image/webp',
        sizeBytes: compressed.size,
        width,
        height,
      }

      if (!bestResult || result.sizeBytes < bestResult.sizeBytes) {
        bestResult = result
      }

      if (result.sizeBytes <= TARGET_BYTES) {
        return result
      }
    }

    if (bestResult && bestResult.sizeBytes <= HARD_LIMIT_BYTES) {
      return bestResult
    }

    maxDimension = Math.floor(maxDimension * RESIZE_FACTOR)
  }

  throw new Error(
    'A fotografia ficou grande demais mesmo após a compactação. Tente enquadrar novamente.',
  )
}

export async function compressPhoto(file: File): Promise<PhotoInput> {
  return compressPhotoBlob(file)
}
