import { useQuery } from '@tanstack/react-query'
import {
  CalendarDays,
  CalendarClock,
  Images,
  Loader2,
  CheckCircle2,
  XCircle,
  Search,
  SearchX,
  Download,
  Flag,
  HardDrive,
  AlertTriangle,
} from 'lucide-react'
import { apiFetch } from '../../lib/api'
import { StatCard, StatCardGrid } from '../../components/ui/StatCard'
import { PageSpinner } from '../../components/ui/EmptyState'
import { Card } from '../../components/ui/Card'

interface DashboardData {
  activeEvents: number
  upcomingEvents: number
  totalPhotos: number
  processingQueue: number
  processedPhotos: number
  failedPhotos: number
  totalSearches: number
  successfulSearches: number
  noResultSearches: number
  completedDownloads: number
  openWrongMatchReports: number
  storageUsageBytes: number
  eventsNearingExpiry: { id: string; name: string; guestAccessExpiresAt: string }[]
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  const units = ['KB', 'MB', 'GB', 'TB']
  let value = bytes / 1024
  let i = 0
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024
    i += 1
  }
  return `${value.toFixed(1)} ${units[i]}`
}

export function DashboardPage() {
  const { data, isLoading } = useQuery({ queryKey: ['dashboard'], queryFn: () => apiFetch<DashboardData>('/api/admin/dashboard') })

  if (isLoading || !data) return <PageSpinner />

  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Dashboard</h1>
      <p className="text-sm text-gray-500 dark:text-gray-400 mb-6">An overview of events, photo processing, and guest activity.</p>

      <StatCardGrid>
        <StatCard label="Active events" value={data.activeEvents} icon={CalendarDays} />
        <StatCard label="Upcoming events" value={data.upcomingEvents} icon={CalendarClock} />
        <StatCard label="Total photographs" value={data.totalPhotos} icon={Images} />
        <StatCard label="Processing queue" value={data.processingQueue} icon={Loader2} />
        <StatCard label="Processed photos" value={data.processedPhotos} icon={CheckCircle2} />
        <StatCard label="Failed photos" value={data.failedPhotos} icon={XCircle} />
        <StatCard label="Guest searches" value={data.totalSearches} icon={Search} />
        <StatCard label="Successful searches" value={data.successfulSearches} icon={CheckCircle2} />
        <StatCard label="No-result searches" value={data.noResultSearches} icon={SearchX} />
        <StatCard label="Downloads completed" value={data.completedDownloads} icon={Download} />
        <StatCard label="Open wrong-match reports" value={data.openWrongMatchReports} icon={Flag} />
        <StatCard label="Storage used" value={formatBytes(data.storageUsageBytes)} icon={HardDrive} />
      </StatCardGrid>

      <Card className="p-4 sm:p-5">
        <div className="flex items-center gap-2 mb-3">
          <AlertTriangle className="w-4 h-4 text-amber-500" />
          <h2 className="text-sm font-bold text-gray-900 dark:text-white">Events nearing guest-access expiry (next 7 days)</h2>
        </div>
        {data.eventsNearingExpiry.length === 0 ? (
          <p className="text-sm text-gray-500 dark:text-gray-400">Nothing expiring soon.</p>
        ) : (
          <ul className="divide-y divide-gray-100 dark:divide-gray-700">
            {data.eventsNearingExpiry.map((e) => (
              <li key={e.id} className="py-2 flex items-center justify-between text-sm">
                <span className="text-gray-800 dark:text-gray-200">{e.name}</span>
                <span className="text-gray-500 dark:text-gray-400">{new Date(e.guestAccessExpiresAt).toLocaleString()}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  )
}
