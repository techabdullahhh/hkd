/**
 * Turning a colour logo into something a thermal printer can actually print.
 *
 * A thermal head has exactly two states per dot: burn or don't. It has no
 * greys, and a burnt dot costs heat, time and paper life. So a logo cannot
 * simply be dropped into the receipt as-is — it has to be reduced to ink.
 *
 * The naive reduction (greyscale → threshold) is wrong for a logo like HKD's,
 * which is drawn on a **black** background: every one of those background
 * pixels is "dark", so the printer would burn a solid black square the width
 * of the paper. That wastes a strip of ribbon-black paper on every single
 * receipt and makes many printers stutter or overheat.
 *
 * Inverting first fixes the background but turns any photographic part of the
 * logo (here, the chef's face) into a photographic negative — light hair,
 * dark skin — which reads as a mistake.
 *
 * What actually works, and what this module implements, is a **local adaptive
 * threshold**: each pixel is compared against the average brightness of its
 * own neighbourhood rather than one global cut-off. Flat regions — the black
 * background, the flat red field — resolve to paper, while every edge and
 * every dense mark resolves to ink. The result is clean line art: the badge
 * ring, the lettering and the chef all read correctly, using a fraction of
 * the ink a dithered photo would.
 *
 * The neighbourhood mean is computed from a summed-area table, so the cost is
 * O(1) per pixel regardless of window size — a 576-dot logo converts in a few
 * milliseconds, which is why this can run at print time instead of needing a
 * build step (and therefore works for a logo the admin uploads themselves).
 */

import { nativeImage } from 'electron'

/**
 * Window size as a fraction of output width, and how far below the local mean
 * a pixel must sit to become ink. Both were chosen by rendering the HKD badge
 * at 384 and 576 dots and comparing the results: smaller windows outline the
 * lettering instead of filling it, larger ones smear the face.
 */
const WINDOW_RATIO = 0.0625
const OFFSET_RATIO = 0.14

export interface ThermalImage {
  dataUrl: string
  width: number
  height: number
  /** Share of dots that will be burnt — a sanity check on ink use. */
  inkRatio: number
}

/**
 * Convert an arbitrary image to 1-bit line art `dots` wide, returned as a
 * PNG data URL ready to drop into the invoice HTML.
 */
export function toThermalLineArt(source: Buffer, dots: number): ThermalImage | null {
  const img = nativeImage.createFromBuffer(source)
  if (img.isEmpty()) return null

  const scaled = img.resize({ width: dots, quality: 'good' })
  const { width, height } = scaled.getSize()
  if (!width || !height) return null

  // Electron hands back BGRA, 4 bytes per pixel, top-left origin.
  const bgra = scaled.toBitmap()
  const n = width * height
  if (bgra.length < n * 4) return null

  /*
   * Plain luminance — no inversion. The threshold below marks pixels that are
   * *brighter* than their surroundings as ink, which is the right polarity for
   * artwork drawn on a dark ground: the bright lettering burns, the black
   * field does not.
   */
  const lum = new Float64Array(n)
  for (let i = 0; i < n; i++) {
    const o = i * 4
    const b = bgra[o]
    const g = bgra[o + 1]
    const r = bgra[o + 2]
    const a = bgra[o + 3]
    const y = 0.299 * r + 0.587 * g + 0.114 * b
    // Treat transparency as paper so a PNG logo with an alpha channel works.
    lum[i] = a === 0 ? 0 : y
  }

  const ink = localAdaptiveThreshold(lum, width, height, windowHalfFor(dots), OFFSET_RATIO * 255)

  const out = Buffer.alloc(n * 4)
  let burnt = 0
  for (let i = 0; i < n; i++) {
    const v = ink[i] ? 0 : 255
    if (ink[i]) burnt++
    const o = i * 4
    out[o] = v
    out[o + 1] = v
    out[o + 2] = v
    out[o + 3] = 255
  }

  const png = nativeImage.createFromBitmap(out, { width, height }).toPNG()
  if (!png || png.length === 0) return null

  return {
    dataUrl: `data:image/png;base64,${png.toString('base64')}`,
    width,
    height,
    inkRatio: burnt / n
  }
}

/** Half-width of the comparison window for a given output width. */
export function windowHalfFor(dots: number): number {
  return Math.max(2, Math.round((dots * WINDOW_RATIO) / 2))
}

/**
 * The heart of the conversion, kept free of Electron so it can be reasoned
 * about and tested on its own.
 *
 * A pixel becomes ink when it is brighter than its own neighbourhood by more
 * than `offset`. The consequence that matters: a **flat** region — however
 * dark or light — is never ink, because every pixel matches its neighbours.
 * That is precisely what stops a logo drawn on a solid black background from
 * being printed as a solid black block.
 *
 * Window means come from a summed-area table, where
 * `sat[(y+1)*(w+1) + (x+1)]` holds the sum of everything above-and-left of
 * (x, y) inclusive — so any window sum is four lookups regardless of size.
 */
export function localAdaptiveThreshold(
  lum: Float64Array,
  width: number,
  height: number,
  half: number,
  offset: number
): Uint8Array {
  const sw = width + 1
  const sat = new Float64Array(sw * (height + 1))
  for (let y = 0; y < height; y++) {
    let rowSum = 0
    for (let x = 0; x < width; x++) {
      rowSum += lum[y * width + x]
      sat[(y + 1) * sw + (x + 1)] = sat[y * sw + (x + 1)] + rowSum
    }
  }

  const ink = new Uint8Array(width * height)
  for (let y = 0; y < height; y++) {
    const y0 = Math.max(0, y - half)
    const y1 = Math.min(height - 1, y + half)
    for (let x = 0; x < width; x++) {
      const x0 = Math.max(0, x - half)
      const x1 = Math.min(width - 1, x + half)
      const area = (y1 - y0 + 1) * (x1 - x0 + 1)
      const sum =
        sat[(y1 + 1) * sw + (x1 + 1)] - sat[y0 * sw + (x1 + 1)] - sat[(y1 + 1) * sw + x0] + sat[y0 * sw + x0]
      ink[y * width + x] = lum[y * width + x] > sum / area + offset ? 1 : 0
    }
  }
  return ink
}

/** Printable dots across the paper — the standard head widths. */
export function dotsForPaper(paperWidth: 58 | 80): number {
  return paperWidth === 58 ? 384 : 576
}
