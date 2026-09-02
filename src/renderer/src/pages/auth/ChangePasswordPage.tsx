import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../../lib/api'
import { useAuth } from '../../store/auth'
import { toast } from '../../store/toast'
import { run } from '../../lib/useAsync'
import { Brandmark } from '../../components/Brandmark'

export function ChangePasswordPage(): JSX.Element {
  const { user, refresh, logout } = useAuth()
  const navigate = useNavigate()
  const forced = !!user?.mustChangePassword
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault()
    if (next !== confirm) {
      toast.error('Passwords do not match.')
      return
    }
    setBusy(true)
    const res = await run(() => api.auth.changePassword({ currentPassword: current, newPassword: next }), {
      success: 'Password updated.'
    })
    if (res?.token) localStorage.setItem('hkd.token', res.token)
    setBusy(false)
    if (res !== undefined) {
      await refresh()
      navigate('/')
    }
  }

  return (
    <div className="auth">
      <div className="auth__art">
        <div>
          <div className="kicker">{forced ? 'Welcome' : 'Account'}</div>
          <Brandmark />
        </div>
        <ul>
          {forced && <li>This is a first-time login — choose a private password</li>}
          <li>At least 8 characters, including a letter and a number</li>
          <li>All other devices are signed out when the password changes</li>
        </ul>
        <div />
      </div>
      <div className="auth__form-wrap">
        <form className="auth__form" onSubmit={submit}>
          <h2>{forced ? 'Choose a new password' : 'Change password'}</h2>
          {forced && (
            <div className="auth__note">
              For security, you must replace the shared development password before continuing.
            </div>
          )}
          <div className="field">
            <label>Current password</label>
            <input className="input" type="password" autoFocus value={current} onChange={(e) => setCurrent(e.target.value)} />
          </div>
          <div className="field">
            <label>New password</label>
            <input className="input" type="password" value={next} onChange={(e) => setNext(e.target.value)} />
          </div>
          <div className="field">
            <label>Confirm new password</label>
            <input className="input" type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
          </div>
          <button className="btn btn--primary btn--lg btn--block" disabled={busy}>
            {busy ? 'Saving…' : 'Save password'}
          </button>
          {!forced && (
            <button type="button" className="btn btn--ghost btn--block" onClick={() => navigate(-1)}>
              Cancel
            </button>
          )}
          {forced && (
            <button
              type="button"
              className="btn btn--ghost btn--block"
              onClick={async () => {
                await logout()
                navigate('/login')
              }}
            >
              Sign out instead
            </button>
          )}
        </form>
      </div>
    </div>
  )
}
