import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Flag } from 'lucide-react'
import { apiFetch, ApiError } from '../../lib/api'
import { Card } from '../../components/ui/Card'
import { Button } from '../../components/ui/Button'
import { EmptyState, PageSpinner } from '../../components/ui/EmptyState'
import { WRONG_MATCH_STATUS_BADGE } from '../../lib/statusBadge'
import { toastSuccess, toastError } from '../../lib/toast'

interface WrongMatchReport {
  id: string
  eventName?: string
  photoId: string
  note?: string | null
  status: string
  createdAt: string
}

export function ReportsPage() {
  const queryClient = useQueryClient()
  const { data, isLoading } = useQuery({ queryKey: ['reports'], queryFn: () => apiFetch<{ reports: WrongMatchReport[] }>('/api/admin/reports?pageSize=100') })

  const resolve = useMutation({
    mutationFn: ({ id, status }: { id: string; status: 'REVIEWED' | 'DISMISSED' }) =>
      apiFetch(`/api/admin/reports/${id}/resolve`, { method: 'PATCH', body: { status } }),
    onSuccess: () => {
      toastSuccess('Report updated')
      queryClient.invalidateQueries({ queryKey: ['reports'] })
    },
    onError: (err) => toastError(err instanceof ApiError ? err.message : 'Failed to update report'),
  })

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Wrong-Match Reports</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400">Guest-submitted "this is not me" reports, across events you have access to.</p>
      </div>

      {isLoading ? (
        <PageSpinner />
      ) : !data?.reports.length ? (
        <Card>
          <EmptyState icon={Flag} title="No reports" description="No guests have reported an incorrect match." />
        </Card>
      ) : (
        <Card className="overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 dark:bg-gray-900/40 text-gray-500 dark:text-gray-400 uppercase text-[11px]">
              <tr>
                <th className="text-left px-6 py-3 font-semibold">Event</th>
                <th className="text-left px-6 py-3 font-semibold hidden sm:table-cell">Note</th>
                <th className="text-left px-6 py-3 font-semibold">Status</th>
                <th className="text-left px-6 py-3 font-semibold">Reported</th>
                <th className="text-right px-6 py-3 font-semibold">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
              {data.reports.map((r) => (
                <tr key={r.id}>
                  <td className="px-6 py-4 text-gray-900 dark:text-white">{r.eventName ?? '—'}</td>
                  <td className="px-6 py-4 text-gray-500 dark:text-gray-400 hidden sm:table-cell">{r.note ?? '—'}</td>
                  <td className="px-6 py-4">
                    <span className={`px-2.5 py-1 rounded-full text-xs font-medium ${WRONG_MATCH_STATUS_BADGE[r.status]}`}>{r.status}</span>
                  </td>
                  <td className="px-6 py-4 text-gray-500 dark:text-gray-400">{new Date(r.createdAt).toLocaleDateString()}</td>
                  <td className="px-6 py-4 text-right space-x-2">
                    {r.status === 'OPEN' && (
                      <>
                        <Button variant="secondary" onClick={() => resolve.mutate({ id: r.id, status: 'REVIEWED' })}>
                          Mark reviewed
                        </Button>
                        <Button variant="ghost" onClick={() => resolve.mutate({ id: r.id, status: 'DISMISSED' })}>
                          Dismiss
                        </Button>
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  )
}
