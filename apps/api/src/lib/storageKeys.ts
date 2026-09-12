export const storageKeys = {
  original: (eventId: string, photoId: string, ext: string) => `events/${eventId}/photos/${photoId}/original.${ext}`,
  thumbnail: (eventId: string, photoId: string) => `events/${eventId}/photos/${photoId}/thumb.jpg`,
  preview: (eventId: string, photoId: string) => `events/${eventId}/photos/${photoId}/preview.jpg`,
  cover: (eventId: string, ext: string) => `events/${eventId}/cover.${ext}`,
  selfie: (eventId: string, faceSearchId: string) => `events/${eventId}/selfies/${faceSearchId}.jpg`,
  zip: (eventId: string, downloadJobId: string) => `events/${eventId}/downloads/${downloadJobId}.zip`,
}
