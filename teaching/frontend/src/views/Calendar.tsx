import { useMemo, useState, type FormEvent } from 'react'
import { ChevronLeft, ChevronRight, Plus } from 'lucide-react'
import {
  api,
  fmtHours,
  monthName,
  parseQuantity,
  type EventItem,
  type EventType,
  type FullBootstrap,
} from '../api'
import { canTimetable, useApp, useUser } from '../store'
import { Btn, Field, Modal, useToday } from '../ui'

const DOW = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс']

interface Cell {
  date: string
  day: number
  other: boolean
}

function monthGrid(month: string): Cell[][] {
  const [y, m] = month.split('-').map(Number)
  const first = new Date(y, m - 1, 1)
  const dow = (first.getDay() + 6) % 7 // понедельник = 0
  const cells: Cell[] = []
  const cur = new Date(first)
  cur.setDate(first.getDate() - dow)
  for (let i = 0; i < 42; i++) {
    cells.push({
      date: `${cur.getFullYear()}-${String(cur.getMonth() + 1).padStart(2, '0')}-${String(cur.getDate()).padStart(2, '0')}`,
      day: cur.getDate(),
      other: cur.getMonth() !== m - 1,
    })
    cur.setDate(cur.getDate() + 1)
  }
  // Отбрасываем хвостовые недели полностью из следующего месяца.
  while (cells.length > 7 * 4 && cells.slice(-7).every((c) => c.other)) cells.length -= 7
  const weeks: Cell[][] = []
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7))
  return weeks
}

const teacherName = (boot: FullBootstrap, id: number) =>
  boot.teachers.find((t) => t.id === id)?.name ?? `№${id}`

export default function CalendarView({ initialType }: { initialType: EventType }) {
  const { boot, reload } = useApp()
  const user = useUser()
  const today = useToday()
  const canEdit = canTimetable(user)

  const nowMonth = today.slice(0, 7)
  const [month, setMonth] = useState(
    boot.year.months.includes(nowMonth) ? nowMonth : boot.year.months[0] ?? nowMonth,
  )
  const type = initialType
  const [teacherId, setTeacherId] = useState<number | 'all'>(user.teacher_id ?? 'all')
  const [editing, setEditing] = useState<EventItem | null>(null)
  const [creating, setCreating] = useState<string | null>(null)
  const [cancelling, setCancelling] = useState<EventItem | null>(null)

  const weeks = useMemo(() => monthGrid(month), [month])

  // Преподаватель видит полное опубликованное расписание; учебная часть/админ — всё.
  const events = useMemo(
    () =>
      boot.events
        .filter((e) => (canEdit || e.status === 'published'))
        .filter((e) => e.type === type)
        .filter((e) => e.date.slice(0, 7) === month)
        .filter((e) => teacherId === 'all' || e.teacher_id === teacherId),
    [boot.events, canEdit, type, month, teacherId],
  )

  const byDate = useMemo(() => {
    const map = new Map<string, EventItem[]>()
    for (const e of events) {
      const arr = map.get(e.date)
      if (arr) arr.push(e)
      else map.set(e.date, [e])
    }
    for (const arr of map.values()) arr.sort((a, b) => a.start.localeCompare(b.start))
    return map
  }, [events])

  const monthIdx = boot.year.months.indexOf(month)
  const scopeLabel =
    (type === 'lecture' ? 'Лекции' : 'Семинары') +
    ' · ' +
    monthName(month) +
    ' · ' +
    (teacherId === 'all' ? 'все преподаватели' : teacherName(boot, teacherId))

  function dayClick(date: string) {
    if (!canEdit) return
    if (!boot.year.months.includes(date.slice(0, 7))) return // только даты учебного года
    setCreating(date)
  }

  return (
    <div>
      <div className="panel toolbar" role="group" aria-label="Фильтры календаря">
        <span className="badge-row">
          <button
            className="icon-btn"
            aria-label="Предыдущий месяц"
            disabled={monthIdx <= 0}
            onClick={() => setMonth(boot.year.months[monthIdx - 1])}
          >
            <ChevronLeft size={18} />
          </button>
          <button
            className="icon-btn"
            aria-label="Следующий месяц"
            disabled={monthIdx < 0 || monthIdx >= boot.year.months.length - 1}
            onClick={() => setMonth(boot.year.months[monthIdx + 1])}
          >
            <ChevronRight size={18} />
          </button>
        </span>
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
          onChange={(e) => setTeacherId(e.target.value === 'all' ? 'all' : Number(e.target.value))}
        >
          <option value="all">Все преподаватели</option>
          {boot.teachers.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
        <span className="spacer" />
        {canEdit && (
          <Btn
            variant="primary"
            sm
            onClick={() => {
              const d = boot.year.months.includes(nowMonth) && month === nowMonth ? today : month + '-01'
              if (boot.year.months.includes(d.slice(0, 7))) setCreating(d)
              else setCreating(month + '-01')
            }}
          >
            <Plus size={14} />
            Занятие
          </Btn>
        )}
      </div>

      <p className="small muted" style={{ margin: '10px 2px' }}>
        Область: {scopeLabel}. Клик по дню — создать занятие, по событию — открыть карточку.
      </p>

      <div className="cal">
        <div className="cal-head">
          {DOW.map((d) => (
            <div key={d} className="cal-dow">
              {d}
            </div>
          ))}
        </div>
        {weeks.map((week, wi) => (
          <div className="cal-week" key={wi}>
            {week.map((c) => {
              const dayEvents = byDate.get(c.date) ?? []
              const clickable = canEdit && !c.other
              return (
                <div
                  key={c.date}
                  className={
                    'cal-day' +
                    (c.other ? ' other' : '') +
                    (c.date === today ? ' today' : '') +
                    (clickable ? ' clickable' : '')
                  }
                  onClick={clickable ? () => dayClick(c.date) : undefined}
                  role={clickable ? 'button' : undefined}
                  aria-label={clickable ? `Добавить занятие на ${c.date}` : undefined}
                  tabIndex={clickable ? 0 : undefined}
                  onKeyDown={clickable ? (e) => {
                    if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) {
                      e.preventDefault()
                      dayClick(c.date)
                    }
                  } : undefined}
                >
                  <span className="cal-date">{c.day}</span>
                  <span className="cal-events">
                    {dayEvents.map((e) => (
                      <button
                        key={e.id}
                        className={'cal-event' + (e.status === 'draft' ? ' draft' : '')}
                        onClick={(ev) => {
                          ev.stopPropagation()
                          setEditing(e)
                        }}
                        title={`${e.title} · ${teacherName(boot, e.teacher_id)} · ${fmtHours(e.hours_cent)} ч · ${e.status}`}
                      >
                        <span className="t">
                          {e.start}–{e.end}
                        </span>
                        {e.title}
                      </button>
                    ))}
                  </span>
                </div>
              )
            })}
          </div>
        ))}
        {events.length === 0 && (
          <div className="cal-empty">
            В этой области расписания нет. {canEdit ? 'Кликните по дню, чтобы создать занятие.' : ''}
          </div>
        )}
      </div>

      {(creating || editing) && (
        <EventModal
          boot={boot}
          event={editing}
          presetDate={creating ?? undefined}
          presetType={type}
          canEdit={canEdit}
          onClose={() => {
            setCreating(null)
            setEditing(null)
          }}
          onRequestCancel={(e) => {
            setEditing(null)
            setCancelling(e)
          }}
          onChanged={reload}
        />
      )}
      {cancelling && (
        <CancelModal
          event={cancelling}
          onClose={() => setCancelling(null)}
          onChanged={reload}
        />
      )}
    </div>
  )
}

function EventModal({
  boot,
  event,
  presetDate,
  presetType,
  canEdit,
  onClose,
  onRequestCancel,
  onChanged,
}: {
  boot: FullBootstrap
  event: EventItem | null
  presetDate?: string
  presetType: EventType
  canEdit: boolean
  onClose: () => void
  onRequestCancel: (e: EventItem) => void
  onChanged: () => Promise<void>
}) {
  const user = useUser()
  const [type, setType] = useState<EventType>(event?.type ?? presetType)
  const [title, setTitle] = useState(event?.title ?? '')
  const [teacherId, setTeacherId] = useState<number>(
    event?.teacher_id ?? boot.teachers[0]?.id ?? 0,
  )
  const [groupId, setGroupId] = useState(event?.group_id ?? boot.groups[0]?.id ?? '')
  const [date, setDate] = useState(event?.date ?? presetDate ?? '')
  const [start, setStart] = useState(event?.start ?? '09:00')
  const [end, setEnd] = useState(event?.end ?? '10:30')
  const [hours, setHours] = useState(event ? String(event.hours_cent / 100) : '2')
  const [room, setRoom] = useState(event?.room ?? '')
  const [planId, setPlanId] = useState<string>(event?.plan_id != null ? String(event.plan_id) : '')
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const plans = boot.plans.filter(
    (p) => p.teacher_id === teacherId && p.group_id === groupId && p.type === type && p.month === date.slice(0, 7),
  )

  async function run(fn: () => Promise<unknown>) {
    setBusy(true)
    setErr(null)
    try {
      await fn()
      await onChanged()
      onClose()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Ошибка сохранения.')
      setBusy(false)
    }
  }

  function save(e: FormEvent) {
    e.preventDefault()
    const h = parseQuantity(hours)
    if (!title.trim()) return setErr('Укажите название занятия.')
    if (!date) return setErr('Укажите дату.')
    if (!boot.year.months.includes(date.slice(0, 7)))
      return setErr('Дата вне учебного года.')
    if (!start || !end) return setErr('Укажите время начала и конца.')
    if (h === null || h <= 0) return setErr('Часы должны быть положительным числом.')
    if (!teacherId || !groupId) return setErr('Выберите преподавателя и группу.')
    void run(() =>
      api.eventSave({
        id: event?.id,
        version: event?.version,
        type,
        title: title.trim(),
        teacher_id: teacherId,
        group_id: groupId,
        date,
        start,
        end,
        hours_cent: Math.round(h * 100),
        room: room.trim(),
        plan_id: planId === '' ? null : Number(planId),
      }),
    )
  }

  function publish() {
    const fresh = boot.events.find((e) => e.id === event?.id)
    if (!fresh) return
    void run(() => api.eventPublish(fresh.id, fresh.version))
  }

  const reported = event !== null && boot.claims.some(c => c.event_id === event.id && !['cancelled', 'superseded'].includes(c.status))
  const readOnly = !canEdit || event?.status === 'cancelled' || reported
  const canClaim = event?.status === 'published' && (canEdit || user.teacher_id === event.teacher_id)

  return (
    <Modal title={event ? `Занятие · ${event.status === 'draft' ? 'черновик' : event.status === 'published' ? 'опубликовано' : 'отменено'}` : 'Новое занятие'} onClose={onClose} wide>
      <form onSubmit={save}>
        <div className="modal-body">
          {err && (
            <div className="inline-error" role="alert">
              {err}
            </div>
          )}
          {readOnly && (
            <div className="notice notice-info">
              {reported
                ? 'По занятию уже внесён факт. Исправления оформляются в журнале выполнения.'
                : 'Просмотр без права редактирования.'}
            </div>
          )}
          {!readOnly && event?.status === 'published' && <div className="notice notice-info">После изменения занятие станет черновиком. Проверьте новую дату и опубликуйте его повторно.</div>}
          <div className="form-grid">
            <Field label="Тип" htmlFor="ev-type">
              <select
                id="ev-type"
                className="select"
                value={type}
                onChange={(e) => setType(e.target.value as EventType)}
                disabled={readOnly || event !== null}
              >
                <option value="lecture">Лекция</option>
                <option value="seminar">Семинар</option>
              </select>
            </Field>
            <Field label="Дата" htmlFor="ev-date">
              <input
                id="ev-date"
                className="input"
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                disabled={readOnly}
              />
            </Field>
            <Field label="Название" htmlFor="ev-title">
              <input
                id="ev-title"
                className="input"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                disabled={readOnly}
              />
            </Field>
            <Field label="Аудитория" htmlFor="ev-room">
              <input
                id="ev-room"
                className="input"
                value={room}
                onChange={(e) => setRoom(e.target.value)}
                disabled={readOnly}
              />
            </Field>
            <Field label="Преподаватель" htmlFor="ev-teacher">
              <select
                id="ev-teacher"
                className="select"
                value={teacherId}
                onChange={(e) => setTeacherId(Number(e.target.value))}
                disabled={readOnly}
              >
                {boot.teachers.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Группа" htmlFor="ev-group">
              <select
                id="ev-group"
                className="select"
                value={groupId}
                onChange={(e) => setGroupId(e.target.value)}
                disabled={readOnly}
              >
                {boot.groups.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.label}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Начало" htmlFor="ev-start">
              <input
                id="ev-start"
                className="input"
                type="time"
                value={start}
                onChange={(e) => setStart(e.target.value)}
                disabled={readOnly}
              />
            </Field>
            <Field label="Конец" htmlFor="ev-end">
              <input
                id="ev-end"
                className="input"
                type="time"
                value={end}
                onChange={(e) => setEnd(e.target.value)}
                disabled={readOnly}
              />
            </Field>
            <Field
              label="Часы (явно)"
              htmlFor="ev-hours"
              hint="Вводятся, а не выводятся из длительности; можно через запятую."
            >
              <input
                id="ev-hours"
                className="input"
                inputMode="decimal"
                value={hours}
                onChange={(e) => setHours(e.target.value)}
                disabled={readOnly}
              />
            </Field>
            <Field label="Строка плана (необязательно)" htmlFor="ev-plan">
              <select
                id="ev-plan"
                className="select"
                value={planId}
                onChange={(e) => setPlanId(e.target.value)}
                disabled={readOnly}
              >
                <option value="">— без привязки —</option>
                {plans.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.discipline} · {monthName(p.month)} · {fmtHours(p.hours_cent)} ч
                  </option>
                ))}
              </select>
            </Field>
          </div>
          {canClaim && event && (
            <p className="small" style={{ marginTop: 4 }}>
              <a
                href={reported ? `#/facts?month=${event.date.slice(0, 7)}&teacher=${event.teacher_id}` : `#/facts?event=${event.id}`}
                onClick={(e) => {
                  e.preventDefault()
                  onClose()
                  window.location.hash = reported ? `#/facts?month=${event.date.slice(0, 7)}&teacher=${event.teacher_id}` : `#/facts?event=${event.id}`
                }}
              >
                {reported ? 'Открыть журнал выполнения →' : 'Отметить выполнение →'}
              </a>
            </p>
          )}
        </div>
        <div className="modal-foot">
          <span style={{ flex: 1 }} />
          {canEdit && !reported && event !== null && event.status !== 'cancelled' && (
            <Btn variant="danger" disabled={busy} onClick={() => onRequestCancel(event)}>
              Отменить занятие
            </Btn>
          )}
          <Btn variant="ghost" onClick={onClose} disabled={busy}>
            Закрыть
          </Btn>
          {canEdit && !readOnly && (
            <Btn variant="primary" loading={busy} type="submit">
              Сохранить
            </Btn>
          )}
          {canEdit && event !== null && event.status === 'draft' && (
            <Btn variant="primary" loading={busy} onClick={publish}>
              Опубликовать
            </Btn>
          )}
        </div>
      </form>
    </Modal>
  )
}

function CancelModal({
  event,
  onClose,
  onChanged,
}: {
  event: EventItem
  onClose: () => void
  onChanged: () => Promise<void>
}) {
  const [comment, setComment] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!comment.trim()) return setErr('Укажите причину отмены.')
    setBusy(true)
    setErr(null)
    try {
      await api.eventCancel(event.id, event.version, comment.trim())
      await onChanged()
      onClose()
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : 'Не удалось отменить занятие.')
      setBusy(false)
    }
  }

  return (
    <Modal title="Отменить занятие" onClose={onClose}>
      <form onSubmit={submit}>
        <div className="modal-body">
          {err && (
            <div className="inline-error" role="alert">
              {err}
            </div>
          )}
          <Field
            label="Причина отмены"
            htmlFor="cancel-comment"
            hint="Занятие с живой заявкой на выполнение отменить нельзя."
          >
            <textarea
              id="cancel-comment"
              className="input"
              rows={3}
              value={comment}
              onChange={(e) => setComment(e.target.value)}
            />
          </Field>
        </div>
        <div className="modal-foot">
          <Btn variant="ghost" onClick={onClose} disabled={busy}>
            Не отменять
          </Btn>
          <Btn variant="danger" loading={busy} type="submit">
            Отменить занятие
          </Btn>
        </div>
      </form>
    </Modal>
  )
}
