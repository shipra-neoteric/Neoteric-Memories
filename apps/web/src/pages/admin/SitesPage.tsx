import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Building2, Plus } from 'lucide-react'
import { apiFetch, ApiError } from '../../lib/api'
import { Card } from '../../components/ui/Card'
import { Button } from '../../components/ui/Button'
import { Drawer } from '../../components/ui/Drawer'
import { Input, Label, FieldError } from '../../components/ui/Input'
import { EmptyState, PageSpinner } from '../../components/ui/EmptyState'
import { toastSuccess } from '../../lib/toast'

interface Site {
  id: string
  name: string
  code: string
  city?: string | null
  isActive: boolean
}

export function SitesPage() {
  const queryClient = useQueryClient()
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [name, setName] = useState('')
  const [code, setCode] = useState('')
  const [city, setCity] = useState('')
  const [error, setError] = useState<string | null>(null)

  const { data, isLoading } = useQuery({ queryKey: ['sites'], queryFn: () => apiFetch<{ sites: Site[] }>('/api/admin/sites') })

  const createSite = useMutation({
    mutationFn: () => apiFetch('/api/admin/sites', { method: 'POST', body: { name, code: code.toUpperCase(), city: city || undefined } }),
    onSuccess: () => {
      toastSuccess('Site created')
      queryClient.invalidateQueries({ queryKey: ['sites'] })
      setDrawerOpen(false)
      setName('')
      setCode('')
      setCity('')
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Failed to create site'),
  })

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Projects / Sites</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400">Neoteric Properties project sites that host events.</p>
        </div>
        <Button variant="primary" icon={<Plus className="w-4 h-4" />} onClick={() => setDrawerOpen(true)}>
          New site
        </Button>
      </div>

      {isLoading ? (
        <PageSpinner />
      ) : !data?.sites.length ? (
        <Card>
          <EmptyState icon={Building2} title="No sites yet" description="Create your first project/site to start scheduling events." />
        </Card>
      ) : (
        <Card className="overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 dark:bg-gray-900/40 text-gray-500 dark:text-gray-400 uppercase text-[11px]">
              <tr>
                <th className="text-left px-6 py-3 font-semibold">Name</th>
                <th className="text-left px-6 py-3 font-semibold">Code</th>
                <th className="text-left px-6 py-3 font-semibold hidden sm:table-cell">City</th>
                <th className="text-left px-6 py-3 font-semibold">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
              {data.sites.map((s) => (
                <tr key={s.id} className="hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors">
                  <td className="px-6 py-4 font-medium text-gray-900 dark:text-white">{s.name}</td>
                  <td className="px-6 py-4 text-gray-500 dark:text-gray-400">{s.code}</td>
                  <td className="px-6 py-4 text-gray-500 dark:text-gray-400 hidden sm:table-cell">{s.city ?? '—'}</td>
                  <td className="px-6 py-4">
                    <span className={`px-2.5 py-1 rounded-full text-xs font-medium ${s.isActive ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300' : 'bg-gray-200 text-gray-600'}`}>
                      {s.isActive ? 'Active' : 'Inactive'}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      <Drawer open={drawerOpen} onClose={() => setDrawerOpen(false)} title="New site" icon={<Building2 className="w-5 h-5 text-white" />}>
        <div className="space-y-4">
          {error && <FieldError>{error}</FieldError>}
          <div>
            <Label required>Site name</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Silver Estate" />
          </div>
          <div>
            <Label required>Code</Label>
            <Input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="SILVER_ESTATE" />
          </div>
          <div>
            <Label>City</Label>
            <Input value={city} onChange={(e) => setCity(e.target.value)} placeholder="Pune" />
          </div>
        </div>
        <div className="pt-2 flex justify-end gap-3">
          <Button variant="secondary" onClick={() => setDrawerOpen(false)}>
            Cancel
          </Button>
          <Button variant="primary" loading={createSite.isPending} onClick={() => createSite.mutate()} disabled={!name || !code}>
            Create site
          </Button>
        </div>
      </Drawer>
    </div>
  )
}
