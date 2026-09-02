import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../../store/auth'
import { ApiCallError } from '../../lib/api'
import { Brandmark } from '../../components/Brandmark'

export function SignupPage(): JSX.Element {
  const { signup } = useAuth()
  const navigate = useNavigate()
  const [form, setForm] = useState({ fullName: '', username: '', password: '', confirm: '' })
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, [k]: e.target.value })

  const submit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault()
    setError(null)
    if (form.password !== form.confirm) {
      setError('Passwords do not match.')
      return
    }
    setBusy(true)
    try {
      const { pending } = await signup(form.username.trim(), form.fullName.trim(), form.password)
      if (pending) {
        navigate('/login')
        setTimeout(
          () =>
            alert(
              'Account created. An administrator must approve it before you can sign in.'
            ),
          50
        )
      } else {
        navigate('/login')
      }
    } catch (err) {
      setError(err instanceof ApiCallError ? err.message : 'Unable to create the account.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="auth">
      <div className="auth__art">
        <div>
          <div className="kicker">Join the team</div>
          <Brandmark />
        </div>
        <ul>
          <li>New accounts start as Employee</li>
          <li>An administrator approves and activates your access</li>
          <li>Admin rights are never granted automatically</li>
        </ul>
        <div className="muted" style={{ fontSize: 'var(--text-xs)' }}>
          Restaurant POS &amp; Management System
        </div>
      </div>
      <div className="auth__form-wrap">
        <form className="auth__form" onSubmit={submit}>
          <h2>Create account</h2>
          {error && <div className="auth__error">{error}</div>}
          <div className="auth__note">
            Newly registered accounts are <strong>pending</strong> until an admin approves them, and always start as
            Employee.
          </div>
          <div className="field">
            <label>Full name</label>
            <input className="input" autoFocus value={form.fullName} onChange={set('fullName')} />
          </div>
          <div className="field">
            <label>Username</label>
            <input className="input" value={form.username} onChange={set('username')} autoComplete="username" />
          </div>
          <div className="field">
            <label>Password</label>
            <input
              className="input"
              type="password"
              value={form.password}
              onChange={set('password')}
              autoComplete="new-password"
            />
          </div>
          <div className="field">
            <label>Confirm password</label>
            <input className="input" type="password" value={form.confirm} onChange={set('confirm')} autoComplete="new-password" />
          </div>
          <span className="muted" style={{ fontSize: 'var(--text-xs)' }}>
            At least 8 characters, including a letter and a number.
          </span>
          <button className="btn btn--primary btn--lg btn--block" disabled={busy}>
            {busy ? 'Creating…' : 'Create account'}
          </button>
          <div className="auth__switch">
            Already have an account? <Link to="/login">Sign in</Link>
          </div>
        </form>
      </div>
    </div>
  )
}
