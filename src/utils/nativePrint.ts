import { Capacitor, registerPlugin } from '@capacitor/core'

interface NativePrintPlugin {
  printCurrentWebView(options: { jobName: string }): Promise<void>
}

const NativePrint = registerPlugin<NativePrintPlugin>('NativePrint')

export function isNativeAndroidPrint() {
  return Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android'
}

export async function printCurrentDocument(jobName: string) {
  if (isNativeAndroidPrint()) {
    await NativePrint.printCurrentWebView({ jobName })
    return
  }

  window.print()
}
