import { useQuery } from '@tanstack/react-query'
import { ScrollText } from 'lucide-react'
import { apiFetch } from '../../lib/api'
import { Card } from '../../components/ui/Card'
import { EmptyState, PageSpinner } from '../../components/ui/EmptyState'

interface AuditLog {
  id: string
  actorId?: string
  actorRole?: string
  action: string
  entityType: string
  entityId?: string
  createdAt: string
}
interface SecurityEvent {
  id: string
  type: string
  severity: string
  createdAt: string
}

export function AuditLogPage() {
  const { data: logsData, isLoading } = useQuery({ queryKey: ['audit-logs'], queryFn: () => apiFetch<{ logs: AuditLog[] }>('/api/admin/audit/logs?pageSize=50') })
  const { data: secData } = useQuery({ queryKey: ['security-events'], queryFn: () => apiFetch<{ events: SecurityEvent[] }>('/api/admin/audit/security-events?pageSize=50') })

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Audit & Security</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400">Sensitive admin actions and abuse/suspicious-activity signals.</p>
      </div>

      <Card className="p-5">
        <h2 className="text-xs font-bold uppercase tracking-wide text-gray-600 dark:text-gray-300 mb-3">Audit log</h2>
        {isLoading ? (
          <PageSpinner />
        ) : !logsData?.logs.length ? (
          <EmptyState icon={ScrollText} title="No audit entries yet" />
        ) : (
          <div className="space-y-1 max-h-96 overflow-y-auto custom-scrollbar">
            {logsData.logs.map((l) => (
              <div key={l.id} className="flex items-center justify-between text-xs py-1.5 border-b border-gray-100 dark:border-gray-700">
                <span className="font-mono text-gray-700 dark:text-gray-300">{l.action}</span>
                <span className="text-gray-400">{l.entityType}{l.entityId ? ` · ${l.entityId.slice(-6)}` : ''}</span>
                <span className="text-gray-400">{new Date(l.createdAt).toLocaleString()}</span>
              </div>
            ))}
          </div>
        )}
      </Card>

      <Card className="p-5">
        <h2 className="text-xs font-bold uppercase tracking-wide text-gray-600 dark:text-gray-300 mb-3">Security events</h2>
        {!secData?.events.length ? (
          <p className="text-sm text-gray-400">No security events recorded.</p>
        ) : (
          <div className="space-y-1 max-h-96 overflow-y-auto custom-scrollbar">
            {secData.events.map((e) => (
              <div key={e.id} className="flex items-center justify-between text-xs py-1.5 border-b border-gray-100 dark:border-gray-700">
                <span
                  className={`font-mono px-1.5 py-0.5 rounded ${
                    e.severity === 'CRITICAL'
                      ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300'
                      : e.severity === 'WARN'
                        ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300'
                        : 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300'
                  }`}
                >
                  {e.type}
                </span>
                <span className="text-gray-400">{new Date(e.createdAt).toLocaleString()}</span>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  )
}
