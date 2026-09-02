import { useState } from 'react'
import type { Role, User } from '@shared/types'
import { api } from '../lib/api'
import { useAsync, run } from '../lib/useAsync'
import { Loading, EmptyState, Modal, Field } from '../components/ui'
import { confirmDialog } from '../components/confirm'
import { toast } from '../store/toast'
import { formatDateTime, relativeTime } from '../lib/format'

export function EmployeesPage(): JSX.Element {
  const { data, loading, reload } = useAsync(() => api.users.list({ includeArchived: true }), [])
  const [createOpen, setCreateOpen] = useState(false)
  const [detail, setDetail] = useState<User | null>(null)

  if (loading && !data) return <Loading />
  const users = data ?? []
  const pending = users.filter((u) => u.status === 'PENDING')

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>Employees</h1>
          <p>Approve signups, manage roles and access, reset passwords.</p>
        </div>
        <button className="btn btn--primary" onClick={() => setCreateOpen(true)}>
          + New employee
        </button>
      </div>

      {pending.length > 0 && (
        <div className="panel" style={{ marginBottom: 'var(--s-4)', borderColor: 'var(--warn)' }}>
          <div className="panel__head">
            <h3>Pending approval ({pending.length})</h3>
          </div>
          <div className="panel__body stack gap-2">
            {pending.map((u) => (
              <div key={u.id} className="row between">
                <div className="stack gap-1">
                  <strong>{u.fullName}</strong>
                  <span className="muted" style={{ fontSize: 'var(--text-xs)' }}>
                    @{u.username} · requested {relativeTime(u.createdAt)}
                  </span>
                </div>
                <div className="row gap-2">
                  <button
                    className="btn btn--sm"
                    onClick={() =>
                      run(() => api.users.approve({ userId: u.id, role: 'EMPLOYEE' }), { success: 'Approved as employee.' }).then(
                        reload
                      )
                    }
                  >
                    Approve as Employee
                  </button>
                  <button
                    className="btn btn--sm"
                    onClick={() =>
                      run(() => api.users.approve({ userId: u.id, role: 'ADMIN' }), { success: 'Approved as admin.' }).then(reload)
                    }
                  >
                    Approve as Admin
                  </button>
                  <button
                    className="btn btn--sm btn--danger"
                    onClick={async () => {
                      if (
                        await confirmDialog({
                          title: 'Reject signup?',
                          message: `${u.fullName}'s account will be archived.`,
                          danger: true
                        })
                      )
                        run(() => api.users.setStatus({ userId: u.id, status: 'ARCHIVED' }), { success: 'Rejected.' }).then(reload)
                    }}
                  >
                    Reject
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="panel">
        <div className="panel__body" style={{ padding: 0 }}>
          <table className="grid">
            <thead>
              <tr>
                <th>Name</th>
                <th>Username</th>
                <th>Role</th>
                <th>Status</th>
                <th>Last login</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {users
                .filter((u) => u.status !== 'PENDING')
                .map((u) => (
                  <tr key={u.id} className="clickable" onClick={() => setDetail(u)}>
                    <td>{u.fullName}</td>
                    <td className="mono muted">@{u.username}</td>
                    <td>
                      <span className={`chip ${u.role === 'ADMIN' ? 'chip--accent' : ''}`}>{u.role}</span>
                    </td>
                    <td>
                      <span
                        className={`chip ${
                          u.status === 'ACTIVE' ? 'chip--ok' : u.status === 'DISABLED' ? 'chip--danger' : ''
                        }`}
                      >
                        {u.status}
                      </span>
                    </td>
                    <td className="muted">{u.lastLoginAt ? relativeTime(u.lastLoginAt) : 'never'}</td>
                    <td className="num">›</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </div>

      {createOpen && (
        <CreateEmployeeModal
          onClose={() => setCreateOpen(false)}
          onCreated={() => {
            setCreateOpen(false)
            reload()
          }}
        />
      )}
      {detail && (
        <EmployeeDetailModal
          user={detail}
          onClose={() => setDetail(null)}
          onChanged={() => {
            reload()
            setDetail(null)
          }}
        />
      )}
    </div>
  )
}

function CreateEmployeeModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }): JSX.Element {
  const [f, setF] = useState({ fullName: '', username: '', password: '', role: 'EMPLOYEE' as Role })
  const [busy, setBusy] = useState(false)
  return (
    <Modal
      open
      title="New employee"
      onClose={onClose}
      footer={
        <>
          <button className="btn btn--ghost" onClick={onClose}>
            Cancel
          </button>
          <button
            className="btn btn--primary"
            disabled={busy}
            onClick={async () => {
              setBusy(true)
              const r = await run(() => api.users.create(f), { success: 'Employee created.' })
              setBusy(false)
              if (r) onCreated()
            }}
          >
            Create
          </button>
        </>
      }
    >
      <div className="form-grid">
        <Field label="Full name">
          <input className="input" value={f.fullName} onChange={(e) => setF({ ...f, fullName: e.target.value })} />
        </Field>
        <Field label="Username">
          <input className="input" value={f.username} onChange={(e) => setF({ ...f, username: e.target.value })} />
        </Field>
        <Field label="Temporary password" hint="They must change it on first login.">
          <input className="input" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} />
        </Field>
        <Field label="Role">
          <select className="select" value={f.role} onChange={(e) => setF({ ...f, role: e.target.value as Role })}>
            <option value="EMPLOYEE">Employee</option>
            <option value="ADMIN">Admin</option>
          </select>
        </Field>
      </div>
    </Modal>
  )
}

function EmployeeDetailModal({
  user,
  onClose,
  onChanged
}: {
  user: User
  onClose: () => void
  onChanged: () => void
}): JSX.Element {
  const sessions = useAsync(() => api.session.list({ userId: user.id, limit: 20 }), [user.id])
  const [pw, setPw] = useState('')

  return (
    <Modal open title={user.fullName} onClose={onClose} width={560}>
      <div className="row gap-2 wrap" style={{ marginBottom: 'var(--s-3)' }}>
        <span className={`chip ${user.role === 'ADMIN' ? 'chip--accent' : ''}`}>{user.role}</span>
        <span className={`chip ${user.status === 'ACTIVE' ? 'chip--ok' : 'chip--danger'}`}>{user.status}</span>
        <span className="muted mono" style={{ fontSize: 'var(--text-xs)' }}>
          joined {formatDateTime(user.createdAt)}
        </span>
      </div>

      <div className="row gap-2 wrap" style={{ marginBottom: 'var(--s-4)' }}>
        {user.status === 'ACTIVE' ? (
          <button
            className="btn btn--sm btn--danger"
            onClick={() => run(() => api.users.setStatus({ userId: user.id, status: 'DISABLED' }), { success: 'Disabled.' }).then(onChanged)}
          >
            Disable
          </button>
        ) : (
          <button
            className="btn btn--sm"
            onClick={() => run(() => api.users.setStatus({ userId: user.id, status: 'ACTIVE' }), { success: 'Reactivated.' }).then(onChanged)}
          >
            Reactivate
          </button>
        )}
        <button
          className="btn btn--sm"
          onClick={() =>
            run(() => api.users.setRole({ userId: user.id, role: user.role === 'ADMIN' ? 'EMPLOYEE' : 'ADMIN' }), {
              success: 'Role changed.'
            }).then(onChanged)
          }
        >
          Make {user.role === 'ADMIN' ? 'Employee' : 'Admin'}
        </button>
        {user.status !== 'ARCHIVED' && (
          <button
            className="btn btn--sm btn--danger"
            onClick={async () => {
              if (
                await confirmDialog({ title: 'Archive employee?', message: 'They will be hidden from lists but their sales history is kept.', danger: true })
              )
                run(() => api.users.setStatus({ userId: user.id, status: 'ARCHIVED' }), { success: 'Archived.' }).then(onChanged)
            }}
          >
            Archive
          </button>
        )}
      </div>

      <div className="field" style={{ marginBottom: 'var(--s-4)' }}>
        <label>Reset password</label>
        <div className="row gap-2">
          <input className="input" placeholder="New temporary password" value={pw} onChange={(e) => setPw(e.target.value)} />
          <button
            className="btn"
            onClick={async () => {
              if (pw.length < 8) {
                toast.error('At least 8 characters.')
                return
              }
              const r = await run(() => api.users.resetPassword({ userId: user.id, newPassword: pw }), {
                success: 'Password reset. They must change it on next login.'
              })
              if (r !== undefined) setPw('')
            }}
          >
            Reset
          </button>
        </div>
      </div>

      <h4 style={{ marginBottom: 'var(--s-2)' }}>Recent sessions</h4>
      {sessions.loading ? (
        <Loading />
      ) : !sessions.data || sessions.data.length === 0 ? (
        <EmptyState title="No sessions yet" />
      ) : (
        <table className="grid">
          <thead>
            <tr>
              <th>Session</th>
              <th>Business date</th>
              <th>Started</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {sessions.data.map((s) => (
              <tr key={s.id}>
                <td className="mono">#{s.id}</td>
                <td>{s.businessDate}</td>
                <td className="muted">{formatDateTime(s.openedAt)}</td>
                <td>
                  <span className={`chip ${s.status === 'OPEN' ? 'chip--ok' : ''}`}>{s.status}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Modal>
  )
}
