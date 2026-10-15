// Electron prefixes errors from the main process with "Error invoking remote method '...': Error: ".
export function cleanIpcError(e: unknown): string {
  return String((e as Error)?.message ?? e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
}
