/**
 * Base64 → bytes.
 *
 * PTY output crosses the IPC boundary base64-encoded on purpose: a read can split a UTF-8
 * sequence, so the bytes have to arrive untouched and be handed to the terminal's own UTF-8
 * decoder (xterm decodes `Uint8Array` writes itself).
 */
export function base64ToBytes(data: string): Uint8Array {
  const binary = atob(data)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index)
  }
  return bytes
}
