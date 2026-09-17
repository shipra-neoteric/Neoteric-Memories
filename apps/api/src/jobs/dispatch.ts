import type { BackgroundJobType } from '@neoteric-memories/shared'
import { processPhotoProcess } from './processors/photoProcess.js'
import { processHeicConvert } from './processors/photoHeicConvert.js'
import { processZipGenerate } from './processors/zipGenerate.js'
import { processSelfieDelete } from './processors/selfieDelete.js'
import { processEventCollectionDelete } from './processors/eventCollectionDelete.js'
import { runRetentionSweep } from './processors/retentionSweep.js'
import { runDriveSyncSweep } from '../modules/drive/service.js'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function dispatchJob(type: BackgroundJobType, payload: any): Promise<void> {
  switch (type) {
    case 'PHOTO_PROCESS':
      return processPhotoProcess(payload)
    case 'PHOTO_HEIC_CONVERT':
      return processHeicConvert(payload)
    case 'ZIP_GENERATE':
      return processZipGenerate(payload)
    case 'SELFIE_DELETE':
      return processSelfieDelete(payload)
    case 'EVENT_COLLECTION_DELETE':
      return processEventCollectionDelete(payload)
    case 'RETENTION_SWEEP':
      await runRetentionSweep()
      return
    case 'DRIVE_SYNC':
      // payload.eventId scopes this to one integration ("Sync Now" — see
      // modules/drive/router.ts); absent for the periodic sweep (all ACTIVE
      // integrations — see jobs/loop.ts's enqueueDueScheduledJobs).
      await runDriveSyncSweep(payload?.eventId)
      return
  }
}
