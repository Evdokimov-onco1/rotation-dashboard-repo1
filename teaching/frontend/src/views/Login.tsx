import { useState, type FormEvent } from 'react'
import { BookOpen } from 'lucide-react'
import { api } from '../api'
import { Btn, Field } from '../ui'

// Отдельный экран входа: не хардкодим доступы, всё проверяет сервер.
export default function Login({ onLoggedIn }: { onLoggedIn: () => Promise<void> }) {
  const [login, setLogin] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!login.trim() || !password) {
      setError('Введите логин и пароль.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      await api.login(login.trim(), password)
      await onLoggedIn()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось войти. Попробуйте снова.')
      setBusy(false)
    }
  }

  return (
    <div className="login">
      <div className="login-side">
        <div className="login-brand">
          <span className="brand-mark" aria-hidden="true">
            <BookOpen size={26} />
          </span>
          <span className="brand-name">Кафедра</span>
        </div>
        <h1>Учебная нагрузка</h1>
        <p>
          Электронный журнал учёта учебной нагрузки преподавателей: план, расписание занятий,
          подтверждение фактических часов и отчётные документы.
        </p>
        <div className="notice">Тестовая версия · подтверждения и выгрузки не являются рабочими отчётами</div>
        <div className="login-foot">
          <a href="https://rotation.mmcc-education.ru/">← Вернуться на rotation.mmcc-education.ru</a>
        </div>
      </div>
      <div className="login-form-col">
        <form className="login-form" onSubmit={(e) => void submit(e)}>
          <h2>Вход в журнал</h2>
          {error && (
            <div className="inline-error" role="alert">
              {error}
            </div>
          )}
          <Field label="Логин" htmlFor="login-login">
            <input
              id="login-login"
              className="input"
              autoComplete="username"
              value={login}
              onChange={(e) => setLogin(e.target.value)}
              disabled={busy}
            />
          </Field>
          <Field label="Пароль" htmlFor="login-password">
            <input
              id="login-password"
              className="input"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={busy}
            />
          </Field>
          <Btn type="submit" variant="primary" loading={busy} style={{ width: '100%', justifyContent: 'center' }}>
            Войти
          </Btn>
        </form>
      </div>
    </div>
  )
}
