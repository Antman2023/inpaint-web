const UPSCALE_FACTOR = 4
const MAX_UPSCALE_OUTPUT_PIXELS = 20_000_000

export type UpscalePlan =
  | { ok: true; width: number; height: number }
  | { ok: false; reason: 'invalid_image_dimensions' | 'upscale_too_large' }

export function getUpscalePlan(width: number, height: number): UpscalePlan {
  if (
    !Number.isSafeInteger(width) ||
    !Number.isSafeInteger(height) ||
    width < 1 ||
    height < 1
  ) {
    return { ok: false, reason: 'invalid_image_dimensions' }
  }
  const outputWidth = width * UPSCALE_FACTOR
  const outputHeight = height * UPSCALE_FACTOR
  if (outputWidth * outputHeight > MAX_UPSCALE_OUTPUT_PIXELS) {
    return { ok: false, reason: 'upscale_too_large' }
  }
  return { ok: true, width: outputWidth, height: outputHeight }
}
