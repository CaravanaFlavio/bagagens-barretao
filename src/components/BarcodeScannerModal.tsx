import { Camera, CameraOff } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Modal } from './Modal'

interface BarcodeScannerModalProps {
  open: boolean
  onClose: () => void
  onDetected: (code: string) => void
}

export function BarcodeScannerModal({ open, onClose, onDetected }: BarcodeScannerModalProps) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const [errorMessage, setErrorMessage] = useState('')

  useEffect(() => {
    if (!open || !videoRef.current) return

    const videoElement = videoRef.current
    let stopScanner: (() => void) | undefined
    let active = true
    const startScanner = async () => {
      try {
        const { BrowserMultiFormatReader } = await import('@zxing/browser')
        const reader = new BrowserMultiFormatReader()
        setErrorMessage('')
        const controls = await reader.decodeFromConstraints(
          {
            audio: false,
            video: {
              facingMode: { ideal: 'environment' },
            },
          },
          videoElement,
          (result) => {
            if (!result || !active) return
            active = false
            controls.stop()
            onDetected(result.getText())
          },
        )

        stopScanner = () => controls.stop()
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Não foi possível abrir a câmera.'
        setErrorMessage(message)
      }
    }

    void startScanner()

    return () => {
      active = false
      stopScanner?.()
      const stream = videoElement.srcObject
      if (stream instanceof MediaStream) {
        stream.getTracks().forEach((track) => track.stop())
      }
    }
  }, [open, onDetected])

  return (
    <Modal
      open={open}
      title="Escanear código"
      subtitle="Aponte a câmera para o QR Code ou código de barras do lacre."
      onClose={onClose}
    >
      <div className="scanner-frame">
        <video ref={videoRef} autoPlay muted playsInline />
        <div className="scanner-guide" aria-hidden="true" />
      </div>

      {errorMessage ? (
        <div className="alert alert--danger">
          <CameraOff aria-hidden="true" />
          <div>
            <strong>Câmera indisponível</strong>
            <p>{errorMessage}</p>
            <p>Feche esta janela e digite o código manualmente.</p>
          </div>
        </div>
      ) : (
        <div className="scanner-hint">
          <Camera aria-hidden="true" />
          A leitura será preenchida automaticamente.
        </div>
      )}
    </Modal>
  )
}
