# Face-Provider Integration Guide

## The interface

`apps/api/src/providers/faceSearch/FaceSearchProvider.ts`:

```ts
interface FaceSearchProvider {
  createEventCollection(eventId: string): Promise<void>
  deleteEventCollection(eventId: string): Promise<void>
  detectFaces(imageBuffer: Buffer): Promise<DetectedFace[]>
  indexPhotoFaces(params: { eventId; photoId; imageBuffer }): Promise<DetectedFace[]>
  removePhotoFaces(params: { eventId; photoId; providerFaceIds }): Promise<void>
  searchEventBySelfie(params: { eventId; selfieBuffer; maxResults; minSimilarity }): Promise<SearchMatch[]>
  getProcessingStatus(params: { eventId }): Promise<{ indexedFaceCount: number }>
}
```

Every method is event-scoped by design — this is the actual enforcement point for "a selfie for Event A can never search Event B" (see `docs/ARCHITECTURE.md#event-isolation`). Two implementations exist behind this interface, selected by `FACE_PROVIDER`:

## `MockFaceSearchProvider` (default, `FACE_PROVIDER=mock`)

**This does not do real computer vision.** It's a deterministic stand-in, designed so the entire pipeline — detect → index → search → threshold → match — can be exercised in CI and demoed locally with zero AI dependency and zero flakiness.

How it works (`apps/api/src/providers/faceSearch/colorMarkers.ts` + `imageMarkerScan.ts`):

- Eight reserved "identity" colors (`person-1` .. `person-8`) stand in for eight demo people.
- A synthetic demo photo is a plain background with a solid-color square placed on it — the square's color is the "face". `apps/api/src/devSeed/seedImages.ts` generates these.
- `detectFaces()`/`indexPhotoFaces()` scan the image on a grid, snap each sampled pixel to its nearest palette color (within a tolerance), and cluster matched points per identity into one bounding box per detected "face". Bigger square → higher detection confidence (simulates "small face in a crowd photo → lower confidence").
- `searchEventBySelfie()` takes the selfie's most prominent detected color, computes Euclidean RGB distance to every indexed face's stored color within that event, and converts distance → a 0–99 similarity score. An exact color match scores ~99; a deliberately close-but-different shade scores lower and is correctly excluded once below the high-confidence threshold.

**Why this design, not a fake/random score generator:** it's genuinely testable (`test/unit/mockFaceProvider.test.ts` verifies exact matches score high, near-miss colors are excluded below threshold, and cross-event isolation holds), and it lets `docs/SETUP.md`'s guest-flow walkthrough produce a real, reproducible match without a live camera or AWS credentials.

**What it means for manual testing**: a real webcam selfie of your actual face will *correctly* find nothing, because your face isn't one of the eight reserved colors. To see a real match, use the "Upload a selfie instead" fallback (enabled on seeded demo events) with one of the generated fixtures in `apps/api/seed-assets/demo-selfies/`.

Its own index state lives in a dedicated `MockFaceIndexEntry` Mongo collection — analogous to what Rekognition keeps server-side in a real Collection, and never queried by the rest of the app directly, only through this provider.

## `RekognitionFaceSearchProvider` (`FACE_PROVIDER=rekognition`)

Implements the same interface against Amazon Rekognition:

- `createEventCollection` / `deleteEventCollection` → `CreateCollection` / `DeleteCollection`, both idempotent (swallow "already exists" / "not found").
- `indexPhotoFaces` → `IndexFaces` with `ExternalImageId` set to the photo's own id and `QualityFilter: 'AUTO'` — this is how a returned match is mapped straight back to a `photoId` with no extra lookup table needed.
- `detectFaces` → `DetectFaces` (no collection needed — used purely for selfie validation before a search).
- `searchEventBySelfie` → `SearchFacesByImage` with `FaceMatchThreshold` set from the same threshold value used everywhere else, deduplicated to the strongest match per photo.
- `removePhotoFaces` → `DeleteFaces`.
- `getProcessingStatus` → `DescribeCollection`'s `FaceCount`.

**Not exercised against live AWS in this repo.** Per the spec's instruction to never call real cloud AI in automated tests, this adapter is implemented to the correct AWS SDK v3 API shape but has only been reviewed, not run against a real AWS account, in this session. Before relying on it:

1. Set `FACE_PROVIDER=rekognition`, `AWS_REGION`, and credentials (see [AWS_DEPLOYMENT.md](AWS_DEPLOYMENT.md)).
2. Create a test event, upload real photographs, confirm `IndexFaces` results and bounding boxes look sane in the AWS console.
3. Run a real selfie search and manually verify the returned similarity scores against what a human would call a correct match.

## Calibrating the high-confidence threshold

`HIGH_CONFIDENCE_THRESHOLD` (env var, default `92`) and the per-event `matchThreshold` override are **starting points, not validated production values**. Rekognition similarity scores depend heavily on photo quality, lighting, crowd density, and camera angle at your actual events. Before any real pilot:

1. Run a controlled test: index ~50-100 real photographs from a past Neoteric event (or a representative shoot), capture selfies from a handful of people who appear in them, and record the similarity scores Rekognition returns for true matches vs. near-miss/lookalike photos.
2. Pick a threshold that keeps false positives (showing someone else's photo) effectively at zero, even if it costs some recall (occasionally missing a real match) — the spec is explicit that under-inclusion is acceptable, showing a stranger's photo is not.
3. Set it as the default via `HIGH_CONFIDENCE_THRESHOLD`, or per-event for a specific tricky venue (bad lighting, large crowds) via the event's `matchThreshold` field.

Never treat the output of either provider as identity verification — the UI copy is deliberately worded "probabilistic" and "may produce incomplete or inaccurate results" throughout, and this must not be changed to stronger language.

## Adding a third provider

Implement the `FaceSearchProvider` interface, add it to `apps/api/src/providers/faceSearch/index.ts#getFaceSearchProvider()` behind a new `FACE_PROVIDER` value, and nothing else in the codebase needs to change — every call site goes through this interface.
