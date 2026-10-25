import { useCallback, useEffect, useState } from 'react'
import {
  BookOpen,
  CalendarDays,
  ClipboardList,
  FileText,
  LayoutDashboard,
  LogOut,
  Menu,
  Scale,
  X,
} from 'lucide-react'
import {
  api,
  setCsrf,
  setUnauthorizedHandler,
  type BootstrapData,
  type FullBootstrap,
  type User,
} from './api'
import { AppContext, ROLE_LABELS, type AppStore } from './store'
import { Btn, Spinner } from './ui'
import Login from './views/Login'
import Overview from './views/Overview'
import CalendarView from './views/Calendar'
import Norms from './views/Norms'
import Facts from './views/Facts'
import Plan from './views/Plan'
import Reports from './views/Reports'

const NAV: Array<{ path: string; label: string; icon: typeof LayoutDashboard }> = [
  { path: '/overview', label: 'Обзор', icon: LayoutDashboard },
  { path: '/lectures', label: 'Лекции', icon: CalendarDays },
  { path: '/seminars', label: 'Семинары', icon: CalendarDays },
  { path: '/facts', label: 'Факты нагрузки', icon: ClipboardList },
  { path: '/plan', label: 'План', icon: BookOpen },
  { path: '/reports', label: 'Отчёты', icon: FileText },
  { path: '/norms', label: 'Нормы', icon: Scale },
]

function parseHash(): { path: string; params: URLSearchParams } {
  const raw = window.location.hash.replace(/^#/, '') || '/overview'
  const [path, query = ''] = raw.split('?')
  return { path: path || '/overview', params: new URLSearchParams(query) }
}

function useHashRoute(): { path: string; params: URLSearchParams } {
  const [route, setRoute] = useState(parseHash)
  useEffect(() => {
    const onChange = () => setRoute(parseHash())
    window.addEventListener('hashchange', onChange)
    return () => window.removeEventListener('hashchange', onChange)
  }, [])
  return route
}

function Brand() {
  return (
    <div className="brand">
      <span className="brand-mark" aria-hidden="true">
        <BookOpen size={22} />
      </span>
      <span>
        <div className="brand-name">Учебная нагрузка</div>
        <div className="brand-scope">Кафедра · {new Date().getFullYear()}</div>
      </span>
    </div>
  )
}

function NavLinks({ path, onNavigate }: { path: string; onNavigate?: () => void }) {
  return (
    <>
      {NAV.map((n) => (
        <a
          key={n.path}
          href={`#${n.path}`}
          className={'nav-item' + (path === n.path ? ' active' : '')}
          onClick={onNavigate}
        >
          <n.icon size={17} />
          {n.label}
        </a>
      ))}
    </>
  )
}

function UserBlock({ user, onLogout, loggingOut }: { user: User; onLogout: () => void; loggingOut: boolean }) {
  return (
    <div className="side-user">
      <div>{user.name}</div>
      <div className="roles">{user.roles.map((r) => ROLE_LABELS[r]).join(' · ')}</div>
      <Btn variant="secondary" sm loading={loggingOut} onClick={onLogout}>
        <LogOut size={14} />
        Выйти
      </Btn>
    </div>
  )
}

export default function App() {
  const [boot, setBoot] = useState<BootstrapData | null>(null)
  const [fatal, setFatal] = useState<string | null>(null)
  const [loggingOut, setLoggingOut] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const route = useHashRoute()

  const load = useCallback(async () => {
    try {
      const data = await api.bootstrap()
      setCsrf(data.csrf)
      setBoot(data)
      setFatal(null)
    } catch (e) {
      setFatal(e instanceof Error ? e.message : 'Не удалось загрузить данные.')
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    setUnauthorizedHandler(() => {
      void load()
    })
    return () => setUnauthorizedHandler(() => {})
  }, [load])

  const logout = useCallback(async () => {
    setLoggingOut(true)
    try {
      await api.logout()
    } catch {
      // Сессия могла уже завершиться — всё равно переходим к анонимному bootstrap.
    }
    window.location.hash = '#/overview'
    await load()
    setLoggingOut(false)
  }, [load])

  if (fatal && !boot) {
    return (
      <div className="loading-screen">
        <div style={{ maxWidth: 420, textAlign: 'center' }}>
          <p className="inline-error" style={{ justifyContent: 'center' }}>
            {fatal}
          </p>
          <Btn variant="primary" onClick={() => void load()}>
            Повторить
          </Btn>
        </div>
      </div>
    )
  }

  if (!boot) {
    return (
      <div className="loading-screen">
        <Spinner label="Загружаем журнал…" />
      </div>
    )
  }

  if (boot.user === null) {
    return <Login onLoggedIn={load} />
  }

  const store: AppStore = { boot: boot as FullBootstrap, reload: load }
  const { path, params } = route

  let view = null
  switch (path) {
    case '/calendar':
    case '/lectures':
      view = <CalendarView key="lectures" initialType="lecture" />
      break
    case '/seminars':
      view = <CalendarView key="seminars" initialType="seminar" />
      break
    case '/facts':
      view = <Facts key={params.toString()} eventId={params.get('event') ? Number(params.get('event')) : undefined} initialTeacher={params.get('teacher') ? Number(params.get('teacher')) : undefined} />
      break
    case '/plan':
      view = <Plan />
      break
    case '/reports':
      view = <Reports />
      break
    case '/norms':
      view = <Norms />
      break
    default:
      view = <Overview />
  }

  const title = NAV.find((n) => n.path === path)?.label ?? 'Обзор'

  return (
    <AppContext.Provider value={store}>
      <div className="shell">
        <aside className="sidebar">
          <Brand />
          <nav className="nav">
            <NavLinks path={path} />
          </nav>
          <a className="rotation-link" href="https://rotation.mmcc-education.ru/">← Расписание ротаций</a>
          <UserBlock user={boot.user} onLogout={() => void logout()} loggingOut={loggingOut} />
        </aside>
        <div className="main">
          <div className="topbar">
            <span className="brand-name">Учебная нагрузка</span>
            <span className="spacer" />
            <button className="icon-btn" aria-label="Меню" onClick={() => setMenuOpen(true)}>
              <Menu size={20} />
            </button>
          </div>
          {menuOpen && (
            <div className="mobile-nav">
              <div className="mobile-nav-head">
                <span className="brand-name">Учебная нагрузка</span>
                <button className="icon-btn" aria-label="Закрыть меню" onClick={() => setMenuOpen(false)}>
                  <X size={20} />
                </button>
              </div>
              <nav className="nav">
                <NavLinks path={path} onNavigate={() => setMenuOpen(false)} />
              </nav>
              <div style={{ marginTop: 16 }}>
                <UserBlock user={boot.user} onLogout={() => void logout()} loggingOut={loggingOut} />
              </div>
            </div>
          )}
          <div className="banner">
            Тестовая версия · подтверждения и выгрузки не являются рабочими отчётами
          </div>
          <main className="content">
            <div className="page-head">
              <div>
                <h1>{title}</h1>
                <div className="sub">
                  Учебный год {store.boot.year.label} · план и подтверждённая нагрузка
                </div>
              </div>
            </div>
            {fatal && <p className="inline-error" role="alert">Не удалось обновить данные: {fatal} <Btn sm onClick={() => void load()}>Повторить</Btn></p>}
            {view}
          </main>
        </div>
      </div>
    </AppContext.Provider>
  )
}
