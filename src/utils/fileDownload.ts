import { Capacitor } from '@capacitor/core'
import { Directory, Filesystem } from '@capacitor/filesystem'

const ANDROID_EXPORT_FOLDER = 'BagagensBarretao'

export interface DownloadFileResult {
  native: boolean
  displayPath?: string
  uri?: string
}

function downloadBlobInBrowser(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = fileName
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 0)
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()

    reader.onloadend = () => {
      if (typeof reader.result !== 'string') {
        reject(new Error('Não foi possível preparar o arquivo para salvar no celular.'))
        return
      }

      const commaIndex = reader.result.indexOf(',')
      if (commaIndex < 0) {
        reject(new Error('O arquivo gerado possui um formato inválido para o Android.'))
        return
      }

      resolve(reader.result.slice(commaIndex + 1))
    }

    reader.onerror = () => {
      reject(new Error('Não foi possível ler o arquivo gerado antes de salvá-lo.'))
    }

    reader.readAsDataURL(blob)
  })
}

function safeFileName(fileName: string) {
  return fileName.replace(/[\\/:*?"<>|]+/g, '_')
}

export async function downloadBlobFile(
  blob: Blob,
  fileName: string,
): Promise<DownloadFileResult> {
  if (!Capacitor.isNativePlatform() || Capacitor.getPlatform() !== 'android') {
    downloadBlobInBrowser(blob, fileName)
    return { native: false }
  }

  const safeName = safeFileName(fileName)
  const relativePath = `${ANDROID_EXPORT_FOLDER}/${safeName}`
  const data = await blobToBase64(blob)

  const result = await Filesystem.writeFile({
    path: relativePath,
    data,
    directory: Directory.Documents,
    recursive: true,
  })

  return {
    native: true,
    displayPath: `Documentos/${relativePath}`,
    uri: result.uri,
  }
}
