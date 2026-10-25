import { useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertCircle,
  ClipboardList,
  History,
  Lock,
  LockOpen,
  Pencil,
  Plus,
  RotateCcw,
  Send,
  XCircle,
} from 'lucide-react'
import {
  api,
  computeMetrics,
  fmtHours,
  isClosed,
  monthName,
  type Claim,
  type ClaimStatus,
  type EventItem,
} from '../api'
import {
  canEditClaims,
  canReview,
  hasRole,
  isTeacherOnly,
  useApp,
  useUser,
} from '../store'
import { Btn, Empty, Field, Modal, Segmented, Spinner, useToday } from '../ui'
import ClaimForm from './ClaimForm'

const STATUS_LABEL: Record<ClaimStatus, string> = {
  draft: 'Черновик',
  submitted: 'На проверке',
  approved: 'Подтверждено',
  returned: 'Возвращено',
  cancelled: 'Отменено',
  superseded: 'Заменено',
}

const TABS: Array<{ value: string; label: string }> = [
  { value: 'all', label: 'Все' },
  { value: 'draft', label: 'Черновики' },
  { value: 'submitted', label: 'На проверке' },
  { value: 'approved', label: 'Подтверждено' },
  { value: 'returned', label: 'Возвращено' },
  { value: 'cancelled', label: 'Отменённые' },
]

// Раздел «Факты нагрузки»: журнал фактических записей с фильтрами, пакетной
// отправкой на проверку, согласованием, правками утверждённых записей и
// закрытием месяца. Метрики — только через computeMetrics, чтобы неподтверждённые
// редакции никогда не суммировались с утверждёнными.
export default function Facts({ eventId, initialTeacher }: { eventId?: number; initialTeacher?: number }) {
  const { boot, reload } = useApp()
  const user = useUser()
  const today = useToday()

  const reviewAllowed = canReview(user)
  const editAllowed = canEditClaims(user)
  const pickTeacher = hasRole(user, 'office', 'admin')
  const teacherOnly = isTeacherOnly(user)

  const nowMonth = today.slice(0, 7)
  const [month, setMonth] = useState<string>(
    boot.year.months.includes(new URLSearchParams(location.hash.split('?')[1]).get('month') ?? '') ? new URLSearchParams(location.hash.split('?')[1]).get('month')! : boot.year.months.includes(nowMonth) ? nowMonth : (boot.year.months[0] ?? nowMonth),
  )
  const [teacherId, setTeacherId] = useState<number | 'all'>(
    initialTeacher ?? (teacherOnly && user.teacher_id !== null ? user.teacher_id : 'all'),
  )
  const [groupId, setGroupId] = useState<string | 'all'>('all')
  const [tab, setTab] = useState<string>('all')
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  // Диалоги.
  const [form, setForm] = useState<{ claim?: Claim; event?: EventItem } | null>(null)
  const [cancelTarget, setCancelTarget] = useState<Claim | null>(null)
  const [cancelReason, setCancelReason] = useState('')
  const [reviewOpen, setReviewOpen] = useState(false)
  const [reviewComment, setReviewComment] = useState('')
  const [historyFor, setHistoryFor] = useState<Claim | null>(null)
  const [reopenOpen, setReopenOpen] = useState(false)
  const [reopenReason, setReopenReason] = useState('')

  // Открытие формы по событию из календаря — один раз, на подходящем событии.
  const eventOpened = useRef(false)
  useEffect(() => {
    if (eventOpened.current || eventId === undefined) return
    const ev = boot.events.find((e) => e.id === eventId && e.status === 'published')
    if (ev) {
      eventOpened.current = true
      setForm({ event: ev })
    }
  }, [eventId, boot.events])

  // Текущая редакция определяется порядком создания; возврат остаётся доступным для правки.
  const visible = useMemo(() => {
    const byWork = new Map<string, Claim>()
    for (const c of boot.claims) {
      if (c.status === 'superseded') continue
      const prev = byWork.get(c.work_id)
      if (!prev || c.id > prev.id) byWork.set(c.work_id, c)
    }
    const out: Claim[] = []
    for (const c of byWork.values()) {
      if (c.status === 'cancelled' && c.supersedes_id) {
        const fallback = boot.claims.find((x) => x.id === c.supersedes_id && x.status === 'approved')
        if (fallback) {
          out.push(fallback)
          continue
        }
      }
      out.push(c)
    }
    return out
  }, [boot.claims])

  const rows = useMemo(
    () =>
      (tab === 'approved' ? boot.claims.filter(c => c.status === 'approved') : visible).filter(
        (c) =>
          c.month === month &&
          (teacherId === 'all' || c.teacher_id === teacherId) &&
          (groupId === 'all' || c.group_id === groupId) &&
          (tab === 'all' || c.status === tab),
      ),
    [visible, boot.claims, month, teacherId, groupId, tab],
  )

  const canTouch = (c: Claim) => editAllowed && (pickTeacher || c.teacher_id === user.teacher_id)
  const rowClosed = (c: Claim) => isClosed(boot.closures, c.teacher_id, c.month)
  const submittable = (c: Claim) => canTouch(c) && !rowClosed(c) && c.status === 'draft'
  const reviewable = (c: Claim) => reviewAllowed && !rowClosed(c) && c.status === 'submitted'

  const submitIds = rows.filter(submittable).map((c) => c.id)
  const reviewIds = rows.filter(reviewable).map((c) => c.id)
  const chosenSubmit = submitIds.filter((id) => selected.has(id))
  const chosenReview = reviewIds.filter((id) => selected.has(id))

  // Сброс выбора при смене области или вкладки.
  useEffect(() => {
    setSelected(new Set())
  }, [month, teacherId, groupId, tab])

  const scope = { month, teacherId, groupId }
  const m = useMemo(() => computeMetrics(boot.plans, boot.claims, scope), [boot.plans, boot.claims, month, teacherId, groupId])
  const progress = m.planCent > 0 ? Math.round((m.approvedCent / m.planCent) * 100) : null
  const scopeClosed = teacherId !== 'all' && isClosed(boot.closures, teacherId, month)
  const scopeClosure = scopeClosed
    ? boot.closures.find((c) => c.teacher_id === teacherId && c.month === month)
    : undefined

  const teacherLabel = (id: number) => boot.teachers.find((t) => t.id === id)?.name ?? String(id)
  const groupLabel = (id: string) => boot.groups.find((g) => g.id === id)?.label ?? id
  const typeLabel = (id: string) => boot.types.find((t) => t.id === id)?.label ?? id
  const typeUnit = (id: string) => boot.types.find((t) => t.id === id)?.unit ?? ''

  async function run(fn: () => Promise<unknown>) {
    setError(null)
    setBusy(true)
    try {
      await fn()
      await reload()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Операция не выполнена.')
    } finally {
      setBusy(false)
    }
  }

  function toggleAll(checked: boolean) {
    const next = new Set(selected)
    for (const id of tab === 'submitted' ? reviewIds : submitIds) {
      if (checked) next.add(id)
      else next.delete(id)
    }
    setSelected(next)
  }

  function toggleOne(id: number, checked: boolean) {
    const next = new Set(selected)
    if (checked) next.add(id)
    else next.delete(id)
    setSelected(next)
  }

  async function correct(c: Claim) {
    setError(null)
    setBusy(true)
    try {
      const draft = await api.claimCorrect(c.id, c.version)
      await reload()
      setForm({ claim: draft }) // новый черновик правки в редакторе
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не удалось создать правку.')
    } finally {
      setBusy(false)
    }
  }

  const allChecked =
    (tab === 'submitted' ? reviewIds : submitIds).length > 0 &&
    (tab === 'submitted' ? reviewIds : submitIds).every((id) => selected.has(id))

  return (
    <div>
      {error && (
        <div className="inline-error" role="alert">
          <AlertCircle size={15} />
          {error}
        </div>
      )}

      <div className="panel toolbar" role="group" aria-label="Фильтры фактов">
        <select
          className="select"
          aria-label="Месяц"
          value={month}
          onChange={(e) => setMonth(e.target.value)}
        >
          {boot.year.months.map((mo) => (
            <option key={mo} value={mo}>
              {monthName(mo)}
            </option>
          ))}
        </select>
        <select
          className="select"
          aria-label="Преподаватель"
          value={String(teacherId)}
          disabled={teacherOnly}
          onChange={(e) => setTeacherId(e.target.value === 'all' ? 'all' : Number(e.target.value))}
        >
          {!teacherOnly && <option value="all">Все преподаватели</option>}
          {boot.teachers
            .filter((t) => !teacherOnly || t.id === user.teacher_id)
            .map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
        </select>
        <select
          className="select"
          aria-label="Группа"
          value={groupId}
          onChange={(e) => setGroupId(e.target.value)}
        >
          <option value="all">Все группы</option>
          {boot.groups.map((g) => (
            <option key={g.id} value={g.id}>
              {g.label}
            </option>
          ))}
        </select>
        <Segmented options={TABS} value={tab} onChange={setTab} ariaLabel="Статус записи" />
        <span className="spacer" />
        {editAllowed && !scopeClosed && (
          <Btn variant="primary" sm onClick={() => setForm({})} disabled={busy}>
            <Plus size={14} />
            Новая запись
          </Btn>
        )}
        {chosenSubmit.length > 0 && (
          <Btn
            variant="primary"
            sm
            loading={busy}
            onClick={() =>
              void run(async () => {
                await api.claimSubmit(boot.claims.filter(c=>chosenSubmit.includes(c.id))) // {count} не используем — состояние из bootstrap
                setSelected(new Set())
              })
            }
          >
            <Send size={14} />
            Отправить ({chosenSubmit.length})
          </Btn>
        )}
        {reviewAllowed && chosenReview.length > 0 && (
          <Btn variant="primary" sm loading={busy} onClick={() => setReviewOpen(true)}>
            Согласовать/вернуть ({chosenReview.length})
          </Btn>
        )}
        {reviewAllowed && teacherId !== 'all' && (
          scopeClosed ? (
            <Btn variant="secondary" sm loading={busy} onClick={() => setReopenOpen(true)}>
              <LockOpen size={14} />
              Открыть месяц
            </Btn>
          ) : (
            <Btn
              variant="secondary"
              sm
              loading={busy}
              onClick={() => {
                if (window.confirm(`Закрыть ${monthName(month)} для ${teacherLabel(teacherId)}? Изменения будут заблокированы.`)) {
                  void run(() => api.monthClose(teacherId, month))
                }
              }}
            >
              <Lock size={14} />
              Закрыть месяц
            </Btn>
          )
        )}
      </div>

      {scopeClosed && (
        <div className="notice" style={{ marginTop: 12 }}>
          Месяц закрыт{scopeClosure?.closed_by ? ` (${scopeClosure.closed_by})` : ''}. Записи
          заблокированы до повторного открытия.
        </div>
      )}

      <div className="kpis" aria-label="Метрики" style={{ marginTop: 12 }}>
        <div className="kpi">
          <div className="k-label">План</div>
          <div className="k-value num">
            {fmtHours(m.planCent)}
            <span className="unit">ч</span>
          </div>
          <div className="k-sub">{monthName(month)}</div>
        </div>
        <div className="kpi lead">
          <div className="k-label">Подтверждено</div>
          <div className="k-value num">
            {fmtHours(m.approvedCent)}
            <span className="unit">ч</span>
          </div>
          <div className="k-sub">
            {progress === null ? 'прогресс — (план нулевой)' : `прогресс ${progress} %`}
          </div>
        </div>
        <div className="kpi">
          <div className="k-label">Заявлено</div>
          <div className="k-value num">
            {fmtHours(m.declaredCent)}
            <span className="unit">ч</span>
          </div>
          <div className="k-sub">последние редакции записей</div>
        </div>
        <div className="kpi">
          <div className="k-label">На проверке</div>
          <div className="k-value num">
            {fmtHours(m.submittedCent)}
            <span className="unit">ч</span>
          </div>
          <div className="k-sub">не является фактом</div>
        </div>
      </div>

      {rows.length === 0 ? (
        <div className="panel">
          <Empty
            title="Записей нет"
            action={
              editAllowed && !scopeClosed ? (
                <Btn variant="primary" onClick={() => setForm({})} disabled={busy}>
                  <Plus size={14} />
                  Создать запись
                </Btn>
              ) : undefined
            }
          >
            {monthName(month)}
            {teacherId !== 'all' ? ` · ${teacherLabel(teacherId)}` : ''}
            {groupId !== 'all' ? ` · группа ${groupLabel(groupId)}` : ''} — фактических записей
            с выбранным статусом не найдено.
          </Empty>
        </div>
      ) : (
        <div className="panel table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th style={{ width: 30 }}>
                  {(tab === 'submitted' ? reviewIds : submitIds).length > 0 && (
                    <input
                      type="checkbox"
                      className="checkbox"
                      aria-label="Выбрать все"
                      checked={allChecked}
                      disabled={busy}
                      onChange={(e) => toggleAll(e.target.checked)}
                    />
                  )}
                </th>
                <th>Запись</th>
                <th>Преподаватель</th>
                <th>Группа</th>
                <th>Период</th>
                <th className="num">Кол-во</th>
                <th className="num">Часы</th>
                <th>Статус</th>
                <th>Автор</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((c) => {
                const selectable = submittable(c) || reviewable(c)
                const closedRow = rowClosed(c)
                const editable = canTouch(c) && !closedRow && (c.status === 'draft' || c.status === 'returned')
                const correctable = canTouch(c) && !closedRow && c.status === 'approved' && !c.has_pending_correction
                return (
                  <tr key={c.id}>
                    <td>
                      {selectable && (
                        <input
                          type="checkbox"
                          className="checkbox"
                          aria-label={`Выбрать запись ${c.id}`}
                          checked={selected.has(c.id)}
                          disabled={busy}
                          onChange={(e) => toggleOne(c.id, e.target.checked)}
                        />
                      )}
                    </td>
                    <td>
                      <div>{c.discipline}</div>
                      <div className="small muted">
                        {typeLabel(c.type)} · ред. {c.revision}
                      </div>
                    </td>
                    <td>{teacherLabel(c.teacher_id)}</td>
                    <td>{groupLabel(c.group_id)}</td>
                    <td className="small">
                      {c.date || `${monthName(c.month)} (без даты)`}
                      {closedRow && (
                        <div>
                          <span className="pill pill-closed">месяц закрыт</span>
                        </div>
                      )}
                    </td>
                    <td className="num">
                      {c.quantity} {typeUnit(c.type)}
                    </td>
                    <td className="num">{fmtHours(c.hours_cent)}</td>
                    <td>
                      <span className={`pill pill-${c.status}`}>{STATUS_LABEL[c.status]}</span>
                      {c.status === 'approved' && c.has_pending_correction && <div className="small muted">Есть правка на рассмотрении</div>}
                      {c.supersedes_id && <div className="small muted">Правка подтверждённой записи</div>}
                      {c.comment && <div className="small muted">{c.comment}</div>}
                    </td>
                    <td className="small">{c.author_name}</td>
                    <td>
                      <div className="row-actions">
                        {editable && (
                          <>
                            <button
                              className="icon-btn"
                              title="Изменить"
                              aria-label="Изменить запись"
                              disabled={busy}
                              onClick={() => setForm({ claim: c })}
                            >
                              <Pencil size={15} />
                            </button>
                            <button
                              className="icon-btn"
                              title="Отменить запись"
                              aria-label="Отменить запись"
                              disabled={busy}
                              onClick={() => {
                                setCancelTarget(c)
                                setCancelReason('')
                              }}
                            >
                              <XCircle size={15} />
                            </button>
                          </>
                        )}
                        {correctable && (
                          <button
                            className="icon-btn"
                            title="Внести правку (создаст черновик замены)"
                            aria-label="Внести правку"
                            disabled={busy}
                            onClick={() => void correct(c)}
                          >
                            <RotateCcw size={15} />
                          </button>
                        )}
                        <button
                          className="icon-btn"
                          title="История версий"
                          aria-label="История версий"
                          onClick={() => setHistoryFor(c)}
                        >
                          <History size={15} />
                        </button>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {busy && (
        <p className="small muted" style={{ marginTop: 8 }}>
          <Spinner label="Сохраняем…" />
        </p>
      )}

      {form && (
        <ClaimForm
          claim={form.claim}
          initialEvent={form.event}
          month={month}
          onClose={() => setForm(null)}
          onSaved={reload}
        />
      )}

      {reviewOpen && (
        <Modal title={`Согласование: выбрано ${chosenReview.length}`} onClose={() => setReviewOpen(false)}>
          <div className="modal-body">
            {error && <div className="inline-error" role="alert">{error}</div>}
            <p className="small muted">
              Пакетное решение атомарно. При возврате комментарий обязателен — его увидит автор.
            </p>
            <Field label="Комментарий" htmlFor="rv-comment" hint="Обязателен при возврате">
              <textarea
                id="rv-comment"
                className="input"
                rows={3}
                value={reviewComment}
                onChange={(e) => setReviewComment(e.target.value)}
              />
            </Field>
          </div>
          <div className="modal-foot">
            <Btn variant="secondary" onClick={() => setReviewOpen(false)} disabled={busy}>
              Отмена
            </Btn>
            <Btn
              variant="danger"
              loading={busy}
              disabled={reviewComment.trim() === ''}
              onClick={() =>
                void run(async () => {
                  await api.claimReview(boot.claims.filter(c=>chosenReview.includes(c.id)), 'return', reviewComment.trim())
                  setReviewOpen(false)
                  setReviewComment('')
                  setSelected(new Set())
                })
              }
            >
              Вернуть на доработку
            </Btn>
            <Btn
              variant="primary"
              loading={busy}
              onClick={() =>
                void run(async () => {
                  await api.claimReview(boot.claims.filter(c=>chosenReview.includes(c.id)), 'approve', reviewComment.trim())
                  setReviewOpen(false)
                  setReviewComment('')
                  setSelected(new Set())
                })
              }
            >
              Согласовать
            </Btn>
          </div>
        </Modal>
      )}

      {cancelTarget && (
        <Modal title="Отмена записи" onClose={() => setCancelTarget(null)}>
          <div className="modal-body">
            {error && <div className="inline-error" role="alert">{error}</div>}
            <p className="small muted">
              Запись «{cancelTarget.discipline}» ({fmtHours(cancelTarget.hours_cent)} ч) будет отменена.
              {cancelTarget.supersedes_id
                ? ' Исходная утверждённая запись останется действующей.'
                : ' Действие необратимо в рамках этой редакции.'}
            </p>
            <Field label="Причина отмены" htmlFor="cn-reason" error={cancelReason.trim() === '' ? 'Укажите причину' : null}>
              <textarea
                id="cn-reason"
                className="input"
                rows={3}
                value={cancelReason}
                onChange={(e) => setCancelReason(e.target.value)}
              />
            </Field>
          </div>
          <div className="modal-foot">
            <Btn variant="secondary" onClick={() => setCancelTarget(null)} disabled={busy}>
              Не отменять
            </Btn>
            <Btn
              variant="danger"
              loading={busy}
              disabled={cancelReason.trim() === ''}
              onClick={() =>
                void run(async () => {
                  await api.claimCancel(cancelTarget.id, cancelTarget.version, cancelReason.trim())
                  setCancelTarget(null)
                  setCancelReason('')
                })
              }
            >
              Отменить запись
            </Btn>
          </div>
        </Modal>
      )}

      {reopenOpen && teacherId !== 'all' && (
        <Modal title={`Открыть ${monthName(month)}`} onClose={() => setReopenOpen(false)}>
          <div className="modal-body">
            {error && <div className="inline-error" role="alert">{error}</div>}
            <p className="small muted">
              Месяц для {teacherLabel(teacherId)} будет открыт для изменений. Причина обязательна — она
              попадёт в журнал аудита.
            </p>
            <Field label="Причина открытия" htmlFor="ro-reason">
              <textarea
                id="ro-reason"
                className="input"
                rows={3}
                value={reopenReason}
                onChange={(e) => setReopenReason(e.target.value)}
              />
            </Field>
          </div>
          <div className="modal-foot">
            <Btn variant="secondary" onClick={() => setReopenOpen(false)} disabled={busy}>
              Отмена
            </Btn>
            <Btn
              variant="primary"
              loading={busy}
              disabled={reopenReason.trim() === ''}
              onClick={() =>
                void run(async () => {
                  await api.monthReopen(teacherId, month, reopenReason.trim())
                  setReopenOpen(false)
                  setReopenReason('')
                })
              }
            >
              Открыть месяц
            </Btn>
          </div>
        </Modal>
      )}

      {historyFor && (
        <Modal title={`История работы №${historyFor.work_id}`} onClose={() => setHistoryFor(null)} wide>
          <div className="modal-body">
            <dl className="detail-list">
              <dt>Дисциплина</dt>
              <dd>{historyFor.discipline}</dd>
              <dt>Формула начисления</dt>
              <dd className="formula">{historyFor.formula || '—'}</dd>
            </dl>
            <div className="panel table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Версия</th>
                    <th>Статус</th>
                    <th className="num">Часы</th>
                    <th>Автор</th>
                    <th>Комментарий</th>
                  </tr>
                </thead>
                <tbody>
                  {boot.claims
                    .filter((c) => c.work_id === historyFor.work_id)
                    .sort((a, b) => b.id - a.id)
                    .map((c) => (
                      <tr key={c.id}>
                        <td className="num">{c.revision}</td>
                        <td>
                          <span className={`pill pill-${c.status}`}>{STATUS_LABEL[c.status]}</span>
                        </td>
                        <td className="num">{fmtHours(c.hours_cent)}</td>
                        <td className="small">{c.author_name}</td>
                        <td className="small muted">{c.comment || '—'}</td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          </div>
          <div className="modal-foot">
            <Btn variant="secondary" onClick={() => setHistoryFor(null)}>
              Закрыть
            </Btn>
          </div>
        </Modal>
      )}

      <p className="small muted" style={{ marginTop: 10 }}>
        <ClipboardList size={12} style={{ verticalAlign: '-2px', marginRight: 4 }} />
        «Подтверждено» — только согласованные записи; правка утверждённой записи создаёт отдельный
        черновик и не суммируется с исходной.
      </p>
    </div>
  )
}
