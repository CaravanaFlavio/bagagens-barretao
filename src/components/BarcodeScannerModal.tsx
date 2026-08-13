import { Capacitor } from '@capacitor/core'
import { Camera, CameraOff } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Modal } from './Modal'

interface BarcodeScannerModalProps {
  open: boolean
  onClose: () => void
  onDetected: (code: string) => void
}

const SCAN_ATTEMPT_DELAY_MS = 100

export function BarcodeScannerModal({ open, onClose, onDetected }: BarcodeScannerModalProps) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const nativeScanInFlightRef = useRef(false)
  const onCloseRef = useRef(onClose)
  const onDetectedRef = useRef(onDetected)
  const [errorMessage, setErrorMessage] = useState('')

  useEffect(() => {
    onCloseRef.current = onClose
  }, [onClose])

  useEffect(() => {
    onDetectedRef.current = onDetected
  }, [onDetected])

  const isNativeAndroid = Capacitor.getPlatform() === 'android'

  useEffect(() => {
    if (!open || !isNativeAndroid || nativeScanInFlightRef.current) return

    let active = true
    nativeScanInFlightRef.current = true

    const startNativeScanner = async () => {
      try {
        const {
          CapacitorBarcodeScanner,
          CapacitorBarcodeScannerAndroidScanningLibrary,
          CapacitorBarcodeScannerCameraDirection,
          CapacitorBarcodeScannerScanOrientation,
          CapacitorBarcodeScannerTypeHint,
        } = await import('@capacitor/barcode-scanner')

        const result = await CapacitorBarcodeScanner.scanBarcode({
          hint: CapacitorBarcodeScannerTypeHint.ALL,
          cameraDirection: CapacitorBarcodeScannerCameraDirection.BACK,
          scanOrientation: CapacitorBarcodeScannerScanOrientation.ADAPTIVE,
          scanInstructions: 'Aponte a câmera para o QR Code ou código de barras.',
          scanButton: false,
          scanText: 'Ler código',
          cancelButtonAccessibilityLabel: 'Cancelar leitura',
          torchButtonOnAccessibilityLabel: 'Desligar lanterna',
          torchButtonOffAccessibilityLabel: 'Ligar lanterna',
          android: {
            scanningLibrary: CapacitorBarcodeScannerAndroidScanningLibrary.MLKIT,
          },
        })

        if (!active) return

        const code = result.ScanResult?.trim()
        if (code) {
          onDetectedRef.current(code)
        } else {
          onCloseRef.current()
        }
      } catch (error) {
        if (!active) return
        console.error('Falha no scanner nativo:', error)
        onCloseRef.current()
      } finally {
        nativeScanInFlightRef.current = false
      }
    }

    void startNativeScanner()

    return () => {
      active = false
    }
  }, [open, isNativeAndroid])

  useEffect(() => {
    if (!open || isNativeAndroid || !videoRef.current) return

    const videoElement = videoRef.current
    let stopScanner: (() => void) | undefined
    let active = true

    const startWebScanner = async () => {
      try {
        const { BarcodeFormat, BrowserMultiFormatReader } = await import('@zxing/browser')

        const reader = new BrowserMultiFormatReader(undefined, {
          delayBetweenScanAttempts: SCAN_ATTEMPT_DELAY_MS,
          delayBetweenScanSuccess: SCAN_ATTEMPT_DELAY_MS,
          tryPlayVideoTimeout: 5000,
        })

        reader.possibleFormats = [
          BarcodeFormat.QR_CODE,
          BarcodeFormat.CODE_128,
          BarcodeFormat.CODE_39,
          BarcodeFormat.EAN_13,
          BarcodeFormat.EAN_8,
          BarcodeFormat.ITF,
        ]

        setErrorMessage('')

        const controls = await reader.decodeFromConstraints(
          {
            audio: false,
            video: {
              facingMode: { ideal: 'environment' },
              width: { ideal: 1280 },
              height: { ideal: 720 },
              frameRate: { ideal: 30 },
            },
          },
          videoElement,
          (result) => {
            if (!result || !active) return
            active = false
            controls.stop()
            onDetectedRef.current(result.getText())
          },
        )

        stopScanner = () => controls.stop()
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Não foi possível abrir a câmera.'
        setErrorMessage(message)
      }
    }

    void startWebScanner()

    return () => {
      active = false
      stopScanner?.()

      const stream = videoElement.srcObject
      if (stream instanceof MediaStream) {
        stream.getTracks().forEach((track) => track.stop())
      }
    }
  }, [open, isNativeAndroid])

  if (isNativeAndroid) return null

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
