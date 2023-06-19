import { customAlphabet } from 'nanoid'

// 7-character random string
export const nanoid = customAlphabet(
  '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz',
  7
)

const decoder = new TextDecoder()
export function decodeAIStreamChunk(chunk: Uint8Array): string {
  return decoder.decode(chunk)
}
