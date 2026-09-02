import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../../store/auth'
import { ApiCallError } from '../../lib/api'
import { Brandmark } from '../../components/Brandmark'

export function LoginPage(): JSX.Element {
  const { login, loading } = useAuth()
  const navigate = useNavigate()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)

  const submit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault()
    setError(null)
    try {
      await login(username.trim(), password)
      navigate('/')
    } catch (err) {
      setError(err instanceof ApiCallError ? err.message : 'Unable to sign in.')
    }
  }

  return (
    <div className="auth">
      <div className="auth__art">
        <div>
          <div className="kicker">Est. Lahore</div>
          <Brandmark />
        </div>
        <ul>
          <li>Employee sessions you start and end — never reset by midnight</li>
          <li>Open 24/7 — no “open restaurant” step to use the POS</li>
          <li>Immutable PKR invoices &amp; a full audit trail</li>
          <li>Thermal invoice printing, 58 mm / 80 mm</li>
        </ul>
        <div className="muted" style={{ fontSize: 'var(--text-xs)' }}>
          Restaurant POS &amp; Management System
        </div>
      </div>

      <div className="auth__form-wrap">
        <form className="auth__form" onSubmit={submit}>
          <h2>Sign in</h2>
          {error && <div className="auth__error">{error}</div>}
          <div className="field">
            <label>Username</label>
            <input
              className="input"
              autoFocus
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="username"
            />
          </div>
          <div className="field">
            <label>Password</label>
            <input
              className="input"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
            />
          </div>
          <button className="btn btn--primary btn--lg btn--block" disabled={loading || !username || !password}>
            {loading ? 'Signing in…' : 'Sign in'}
          </button>
          <div className="auth__switch">
            No account? <Link to="/signup">Create one</Link>
          </div>
          <div className="dev-creds">
            <strong style={{ color: 'var(--ink-2)' }}>Development credentials</strong>
            <table>
              <tbody>
                <tr>
                  <td>Admin</td>
                  <td className="mono">admin</td>
                  <td className="mono">Admin@12345</td>
                </tr>
                <tr>
                  <td>Employee</td>
                  <td className="mono">victor1</td>
                  <td className="mono">Victor@12345</td>
                </tr>
                <tr>
                  <td>Employee</td>
                  <td className="mono">victor2</td>
                  <td className="mono">Victor@12345</td>
                </tr>
              </tbody>
            </table>
            <span>You will be asked to set a new password on first login.</span>
          </div>
        </form>
      </div>
    </div>
  )
}
