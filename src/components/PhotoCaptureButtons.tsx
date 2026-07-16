import { Camera, ImagePlus, LoaderCircle } from 'lucide-react'
import { useRef, type ChangeEvent } from 'react'

interface PhotoCaptureButtonsProps {
  onSelect: (file: File) => void | Promise<void>
  busy?: boolean
  compact?: boolean
  cameraLabel?: string
  galleryLabel?: string
}

export function PhotoCaptureButtons({
  onSelect,
  busy = false,
  compact = false,
  cameraLabel = 'Tirar foto',
  galleryLabel = 'Galeria',
}: PhotoCaptureButtonsProps) {
  const cameraInputRef = useRef<HTMLInputElement>(null)
  const galleryInputRef = useRef<HTMLInputElement>(null)

  const handleChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (file) await onSelect(file)
  }

  return (
    <div className={compact ? 'photo-buttons photo-buttons--compact' : 'photo-buttons'}>
      <input
        ref={cameraInputRef}
        className="visually-hidden"
        type="file"
        accept="image/*"
        capture="environment"
        onChange={(event) => void handleChange(event)}
      />
      <input
        ref={galleryInputRef}
        className="visually-hidden"
        type="file"
        accept="image/*"
        onChange={(event) => void handleChange(event)}
      />

      <button
        type="button"
        className={compact ? 'mini-action-button' : 'secondary-button'}
        onClick={() => cameraInputRef.current?.click()}
        disabled={busy}
        title={cameraLabel}
      >
        {busy ? <LoaderCircle className="spin" aria-hidden="true" /> : <Camera aria-hidden="true" />}
        <span>{cameraLabel}</span>
      </button>
      <button
        type="button"
        className={compact ? 'mini-action-button' : 'secondary-button'}
        onClick={() => galleryInputRef.current?.click()}
        disabled={busy}
        title={galleryLabel}
      >
        <ImagePlus aria-hidden="true" />
        <span>{galleryLabel}</span>
      </button>
    </div>
  )
}
