import crypto from 'node:crypto'
import sharp from 'sharp'
import { beforeEach, describe, expect, it } from 'vitest'
import { getPrisma } from '../../src/db.js'
import { MockFaceSearchProvider } from '../../src/providers/faceSearch/MockFaceSearchProvider.js'
import { PERSON_MARKERS } from '../../src/providers/faceSearch/colorMarkers.js'

/** MockFaceIndexEntry's eventId/photoId are typed as Mongo ObjectId, so test fixture ids must look like real ones — this deterministically derives a valid 24-hex-char id from a short readable label. */
function fakeId(label: string): string {
  return crypto.createHash('md5').update(label).digest('hex').slice(0, 24)
}

async function customColorPhoto(rgb: [number, number, number], size = 200): Promise<Buffer> {
  const svg = `<svg width="600" height="400" xmlns="http://www.w3.org/2000/svg">
    <rect width="600" height="400" fill="#eef0f3" />
    <rect x="200" y="100" width="${size}" height="${size}" fill="rgb(${rgb[0]},${rgb[1]},${rgb[2]})" />
  </svg>`
  return sharp(Buffer.from(svg)).jpeg({ quality: 95 }).toBuffer()
}

describe('MockFaceSearchProvider', () => {
  const provider = new MockFaceSearchProvider()
  const person1 = PERSON_MARKERS.find((m) => m.id === 'person-1')!
  const person2 = PERSON_MARKERS.find((m) => m.id === 'person-2')!

  beforeEach(async () => {
    await getPrisma().mockFaceIndexEntry.deleteMany({})
  })

  it('detects zero faces in a photo with no markers', async () => {
    const blank = await sharp({ create: { width: 400, height: 300, channels: 3, background: '#f0f0f0' } }).jpeg().toBuffer()
    const faces = await provider.detectFaces(blank)
    expect(faces).toHaveLength(0)
  })

  it('detects one face per distinct marker color, and a bigger square yields higher confidence', async () => {
    const bigFace = await customColorPhoto(person1.rgb, 220)
    const smallFace = await customColorPhoto(person1.rgb, 30)
    const [big] = await provider.detectFaces(bigFace)
    const [small] = await provider.detectFaces(smallFace)
    expect(big.confidence).toBeGreaterThan(small.confidence)
  })

  it('detects multiple faces when a photo has more than one marker', async () => {
    const twoFaces = await sharp(
      Buffer.from(
        `<svg width="600" height="400" xmlns="http://www.w3.org/2000/svg">
          <rect width="600" height="400" fill="#eef0f3" />
          <rect x="50" y="100" width="120" height="120" fill="rgb(${person1.rgb.join(',')})" />
          <rect x="400" y="100" width="120" height="120" fill="rgb(${person2.rgb.join(',')})" />
        </svg>`
      )
    )
      .jpeg()
      .toBuffer()
    const faces = await provider.detectFaces(twoFaces)
    expect(faces.length).toBe(2)
  })

  it('an exact-color selfie matches its own indexed photo at high similarity', async () => {
    await provider.createEventCollection(fakeId('evt-a'))
    const photo = await customColorPhoto(person1.rgb)
    await provider.indexPhotoFaces({ eventId: fakeId('evt-a'), photoId: fakeId('photo-1'), imageBuffer: photo })

    const selfie = await customColorPhoto(person1.rgb)
    const matches = await provider.searchEventBySelfie({ eventId: fakeId('evt-a'), selfieBuffer: selfie, maxResults: 10, minSimilarity: 92 })
    expect(matches).toHaveLength(1)
    expect(matches[0].photoId).toBe(fakeId('photo-1'))
    expect(matches[0].similarity).toBeGreaterThanOrEqual(92)
  })

  it('a "lookalike" color that is visually close but not identical stays below the high-confidence threshold and is never returned', async () => {
    await provider.createEventCollection(fakeId('evt-b'))
    const photo = await customColorPhoto(person1.rgb)
    await provider.indexPhotoFaces({ eventId: fakeId('evt-b'), photoId: fakeId('photo-2'), imageBuffer: photo })

    // Offset each channel by 12 — close enough to still be *detected* as the same
    // person (within the marker-matching tolerance), but far enough that the
    // resulting similarity score should land below the high-confidence threshold.
    // This specifically exercises threshold filtering, not "no face detected".
    const lookalikeRgb: [number, number, number] = [
      Math.min(255, person1.rgb[0] + 12),
      Math.min(255, person1.rgb[1] + 12),
      Math.min(255, person1.rgb[2] + 12),
    ]
    const selfie = await customColorPhoto(lookalikeRgb)

    // Sanity check: the selfie IS detected as a face (so this test is really
    // exercising similarity-threshold filtering, not the separate "no face" path).
    const detected = await provider.detectFaces(selfie)
    expect(detected).toHaveLength(1)

    const matches = await provider.searchEventBySelfie({ eventId: fakeId('evt-b'), selfieBuffer: selfie, maxResults: 10, minSimilarity: 92 })
    expect(matches).toHaveLength(0)
  })

  it('never returns a match from a different event (event isolation)', async () => {
    await provider.createEventCollection(fakeId('evt-iso-a'))
    await provider.createEventCollection(fakeId('evt-iso-b'))
    const photoA = await customColorPhoto(person1.rgb)
    await provider.indexPhotoFaces({ eventId: fakeId('evt-iso-a'), photoId: fakeId('photo-in-a'), imageBuffer: photoA })

    const selfie = await customColorPhoto(person1.rgb)
    const matchesInB = await provider.searchEventBySelfie({ eventId: fakeId('evt-iso-b'), selfieBuffer: selfie, maxResults: 10, minSimilarity: 50 })
    expect(matchesInB).toHaveLength(0)

    const matchesInA = await provider.searchEventBySelfie({ eventId: fakeId('evt-iso-a'), selfieBuffer: selfie, maxResults: 10, minSimilarity: 50 })
    expect(matchesInA).toHaveLength(1)
  })

  it('deleteEventCollection removes all indexed faces for that event only', async () => {
    await provider.createEventCollection(fakeId('evt-del-a'))
    await provider.createEventCollection(fakeId('evt-del-b'))
    const photo = await customColorPhoto(person1.rgb)
    await provider.indexPhotoFaces({ eventId: fakeId('evt-del-a'), photoId: fakeId('p-a'), imageBuffer: photo })
    await provider.indexPhotoFaces({ eventId: fakeId('evt-del-b'), photoId: fakeId('p-b'), imageBuffer: photo })

    await provider.deleteEventCollection(fakeId('evt-del-a'))

    expect((await provider.getProcessingStatus({ eventId: fakeId('evt-del-a') })).indexedFaceCount).toBe(0)
    expect((await provider.getProcessingStatus({ eventId: fakeId('evt-del-b') })).indexedFaceCount).toBe(1)
  })
})
