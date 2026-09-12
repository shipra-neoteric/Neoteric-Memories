export const EVENT_STATUS_BADGE: Record<string, string> = {
  DRAFT: 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300',
  UPLOADING: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300',
  PROCESSING: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300',
  READY: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300',
  LIVE: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300',
  PAUSED: 'bg-slate-200 text-slate-700 dark:bg-slate-700/50 dark:text-slate-300',
  CLOSED: 'bg-gray-200 text-gray-700 dark:bg-gray-700 dark:text-gray-300',
  EXPIRED: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300',
  ARCHIVED: 'bg-slate-200 text-slate-600 dark:bg-slate-800 dark:text-slate-400',
}

export const PHOTO_STATUS_BADGE: Record<string, string> = {
  PENDING: 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300',
  PROCESSING: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300',
  PROCESSED: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300',
  FAILED: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300',
  NO_FACES: 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300',
  ARCHIVED: 'bg-slate-200 text-slate-700 dark:bg-slate-700/50 dark:text-slate-300',
  DELETED: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300',
}

export const WRONG_MATCH_STATUS_BADGE: Record<string, string> = {
  OPEN: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300',
  REVIEWED: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300',
  DISMISSED: 'bg-gray-200 text-gray-700 dark:bg-gray-700 dark:text-gray-300',
}
