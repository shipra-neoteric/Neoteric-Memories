/**
 * Palette used by the deterministic mock face provider and by the seed-image
 * generator (scripts/generate-seed-photos.ts). Each "identity" is a reserved RGB
 * color; a marker is a solid square of that color rendered into an otherwise plain
 * synthetic photo, standing in for a real face. This lets the full pipeline
 * (detect -> index -> search -> match -> threshold) be exercised deterministically,
 * in CI, with zero real computer vision or third-party AI dependency — see
 * docs/FACE_PROVIDER.md for why this is the right trade-off for L1 mock mode.
 */
export interface PersonMarker {
  id: string
  label: string
  rgb: [number, number, number]
}

export const PERSON_MARKERS: PersonMarker[] = [
  { id: 'person-1', label: 'Asha Kulkarni', rgb: [220, 20, 60] },
  { id: 'person-2', label: 'Rohan Deshmukh', rgb: [34, 139, 34] },
  { id: 'person-3', label: 'Neha Patil', rgb: [30, 60, 200] },
  { id: 'person-4', label: 'Vikram Shah', rgb: [218, 165, 32] },
  { id: 'person-5', label: 'Priya Nair', rgb: [148, 0, 211] },
  { id: 'person-6', label: 'Arjun Mehta', rgb: [0, 139, 139] },
  { id: 'person-7', label: 'Sneha Joshi', rgb: [255, 99, 71] },
  { id: 'person-8', label: 'Karan Malhotra', rgb: [90, 90, 90] },
]

export function markerById(id: string): PersonMarker {
  const marker = PERSON_MARKERS.find((m) => m.id === id)
  if (!marker) throw new Error(`Unknown person marker id: ${id}`)
  return marker
}

export function colorDistance(a: [number, number, number], b: [number, number, number]): number {
  const dr = a[0] - b[0]
  const dg = a[1] - b[1]
  const db = a[2] - b[2]
  return Math.sqrt(dr * dr + dg * dg + db * db)
}

/** Max possible Euclidean RGB distance (black to white), used to normalize similarity scores. */
export const MAX_COLOR_DISTANCE = Math.sqrt(255 ** 2 * 3)
