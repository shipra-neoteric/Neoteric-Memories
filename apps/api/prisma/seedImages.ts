import sharp from 'sharp'
import { PERSON_MARKERS } from '../src/providers/faceSearch/colorMarkers.js'

export interface MarkerPlacement {
  personId: string
  x: number
  y: number
  size: number
}

const WIDTH = 900
const HEIGHT = 600

function rgbToCss([r, g, b]: [number, number, number]): string {
  return `rgb(${r},${g},${b})`
}

/**
 * Renders a synthetic "event photo": a plain gradient background with one solid
 * square per placed marker (each square = one deterministic mock "face" — see
 * providers/faceSearch/colorMarkers.ts). This is what lets a guest's demo selfie
 * (a single matching marker square) return real, deterministic search results
 * without any actual photograph of a person.
 */
export async function renderSyntheticPhoto(placements: MarkerPlacement[], label: string): Promise<Buffer> {
  const rects = placements
    .map((p) => {
      const marker = PERSON_MARKERS.find((m) => m.id === p.personId)
      if (!marker) throw new Error(`Unknown marker id ${p.personId}`)
      return `<rect x="${p.x}" y="${p.y}" width="${p.size}" height="${p.size}" fill="${rgbToCss(marker.rgb)}" />`
    })
    .join('\n')

  const svg = `
    <svg width="${WIDTH}" height="${HEIGHT}" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stop-color="#e6e9ef" />
          <stop offset="100%" stop-color="#c9cfda" />
        </linearGradient>
      </defs>
      <rect width="${WIDTH}" height="${HEIGHT}" fill="url(#bg)" />
      ${rects}
      <text x="24" y="${HEIGHT - 20}" font-family="sans-serif" font-size="20" fill="#334155">${label}</text>
    </svg>
  `
  return sharp(Buffer.from(svg)).jpeg({ quality: 92 }).toBuffer()
}

/** A demo "selfie" fixture: one prominent, centered marker square, standing in for a guest's live camera capture. Used by seed output + the upload-fallback manual test path. */
export async function renderSyntheticSelfie(personId: string): Promise<Buffer> {
  return renderSyntheticPhoto([{ personId, x: 260, y: 130, size: 340 }], `Demo selfie fixture — ${personId}`)
}
