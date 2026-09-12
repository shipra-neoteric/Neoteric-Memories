import type { BackgroundJobType } from '@neoteric-memories/shared'
import { processPhotoProcess } from './processors/photoProcess.js'
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
      await runDriveSyncSweep()
      return
  }
}
