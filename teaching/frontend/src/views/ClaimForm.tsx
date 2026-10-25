import { useMemo, useRef, useState } from 'react'
import { AlertCircle } from 'lucide-react'
import {
  api,
  fmtHours,
  isClosed,
  monthName,
  parseQuantity,
  type Claim,
  type EventItem,
} from '../api'
import { hasRole, useApp, useUser } from '../store'
import { Btn, Field, Modal, confirmDiscard, useToday } from '../ui'

export interface ClaimFormProps {
  /** Существующая запись: редактирование черновика/возвращённой или правка утверждённой. */
  claim?: Claim
  /** Новая запись от опубликованного события (лекция/семинар). */
  initialEvent?: EventItem
  /** Месяц по умолчанию для новой записи. */
  month: string
  onClose: () => void
  onSaved: () => Promise<void>
}

// Форма факта нагрузки. Лекции/семинары привязываются к опубликованному событию
// и наследуют его преподавателя, группу, дату и часы; практические — месячные,
// без даты. Итоговые часы считает сервер, здесь только предпросмотр.
export default function ClaimForm({ claim, initialEvent, month, onClose, onSaved }: ClaimFormProps) {
  const { boot } = useApp()
  const user = useUser()
  const today = useToday()

  const canPickTeacher = hasRole(user, 'office', 'admin')
  const fixedTeacherId = user.teacher_id

  const [teacherId, setTeacherId] = useState<number | ''>(
    claim ? claim.teacher_id : initialEvent ? initialEvent.teacher_id : (fixedTeacherId ?? ''),
  )
  const [typeId, setTypeId] = useState<string>(claim ? claim.type : initialEvent ? initialEvent.type : 'practical')
  const [groupId, setGroupId] = useState<string>(claim ? claim.group_id : initialEvent ? initialEvent.group_id : '')
  const [monthV, setMonthV] = useState<string>(claim ? claim.month : initialEvent ? initialEvent.date.slice(0, 7) : month)
  const [date, setDate] = useState<string>(claim ? claim.date : initialEvent ? initialEvent.date : '')
  const [quantity, setQuantity] = useState<string>(claim ? claim.quantity : initialEvent ? String(initialEvent.hours_cent / 100) : '')
  const [discipline, setDiscipline] = useState<string>(claim ? claim.discipline : initialEvent ? initialEvent.title : '')
  const [eventId, setEventId] = useState<number | ''>(claim?.event_id ?? initialEvent?.id ?? '')
  const [notes, setNotes] = useState<string>(claim ? claim.notes : '')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const type = boot.types.find((t) => t.id === typeId)
  const needsEvent = typeId === 'lecture' || typeId === 'seminar'
  const event = useMemo(
    () => boot.events.find((e) => e.id === eventId) ?? null,
    [boot.events, eventId],
  )
  const showDate = !needsEvent && typeId !== 'practical'

  const events = useMemo(
    () =>
      boot.events.filter(
        (e) =>
          e.status === 'published' &&
          e.type === typeId &&
          (canPickTeacher || e.teacher_id === fixedTeacherId) &&
          (teacherId === '' || e.teacher_id === teacherId),
      ),
    [boot.events, typeId, canPickTeacher, fixedTeacherId, teacherId],
  )

  // Отслеживание «грязной» формы для подтверждения закрытия.
  const initial = useRef(
    JSON.stringify({ teacherId, typeId, groupId, monthV, date, quantity, discipline, eventId, notes }),
  )
  const dirty =
    JSON.stringify({ teacherId, typeId, groupId, monthV, date, quantity, discipline, eventId, notes }) !==
    initial.current

  const closed = teacherId !== '' && isClosed(boot.closures, Number(teacherId), monthV)

  const qtyNum = parseQuantity(quantity)
  const hoursPreview = event ? event.hours_cent : qtyNum !== null && type ? Math.round(qtyNum * type.coefficient_cent) : null

  const missing: string[] = []
  if (teacherId === '') missing.push('преподавателя')
  if (!groupId) missing.push('группу')
  if (!discipline.trim()) missing.push('дисциплину')
  if (quantity.trim() === '' || qtyNum === null) missing.push('количество')
  if (needsEvent && !event) missing.push('событие')
  if (showDate && type?.daily_limited && !date) missing.push('дату')
  const canSave = missing.length === 0 && !closed && !saving

  function pickEvent(id: number | '') {
    setEventId(id)
    const ev = boot.events.find((e) => e.id === id)
    if (ev) {
      setTeacherId(ev.teacher_id)
      setGroupId(ev.group_id)
      setDate(ev.date)
      setMonthV(ev.date.slice(0, 7))
      setQuantity(String(ev.hours_cent / 100))
      setDiscipline(ev.title)
    }
  }

  function changeType(id: string) {
    setTypeId(id)
    setEventId('')
    if (id === 'practical') setDate('')
  }

  function handleClose() {
    if (!saving && confirmDiscard(dirty)) onClose()
  }

  async function save() {
    setError(null)
    setSaving(true)
    try {
      await api.claimSave({
        id: claim?.id,
        version: claim?.version,
        teacher_id: Number(teacherId),
        group_id: groupId,
        type: typeId,
        month: monthV,
        date: event ? event.date : showDate ? date : '',
        quantity,
        discipline: discipline.trim(),
        event_id: event ? event.id : null,
        notes,
      })
      await onSaved()
      onClose()
    } catch (e) {
      // Введённые значения сохраняются — показываем ошибку inline.
      setError(e instanceof Error ? e.message : 'Не удалось сохранить запись.')
      setSaving(false)
    }
  }

  const groupLabel = (id: string) => boot.groups.find((g) => g.id === id)?.label ?? id
  const teacherLabel = (id: number) => boot.teachers.find((t) => t.id === id)?.name ?? String(id)

  return (
    <Modal title={claim ? 'Изменение записи факта' : 'Новая запись факта'} onClose={handleClose} wide>
      <div className="modal-body">
        {error && (
          <div className="inline-error" role="alert">
            <AlertCircle size={15} />
            {error}
          </div>
        )}
        {closed && (
          <div className="notice">
            Месяц {monthName(monthV)} для {teacherLabel(Number(teacherId))} закрыт. Изменения заблокированы
            до повторного открытия.
          </div>
        )}

        <div className="form-grid">
          <Field label="Вид работы" htmlFor="cf-type">
            <select
              id="cf-type"
              className="select"
              value={typeId}
              disabled={saving || !!event || (claim?.status !== undefined && claim.status !== 'draft' && claim.status !== 'returned')}
              onChange={(e) => changeType(e.target.value)}
            >
              {boot.types.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.label}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Месяц" htmlFor="cf-month" hint={typeId === 'practical' ? 'Практические — месячные, без даты' : undefined}>
            <select
              id="cf-month"
              className="select"
              value={monthV}
              disabled={saving || !!event}
              onChange={(e) => setMonthV(e.target.value)}
            >
              {boot.year.months.map((mo) => (
                <option key={mo} value={mo}>
                  {monthName(mo)}
                </option>
              ))}
            </select>
          </Field>

          {needsEvent && (
            <Field
              label="Событие"
              htmlFor="cf-event"
              hint="Только опубликованные события. Преподаватель, группа, дата и часы берутся из события."
            >
              <select
                id="cf-event"
                className="select"
                value={eventId}
                disabled={saving}
                onChange={(e) => pickEvent(e.target.value === '' ? '' : Number(e.target.value))}
              >
                <option value="">— выберите событие —</option>
                {events.map((ev) => (
                  <option key={ev.id} value={ev.id}>
                    {ev.date} · {ev.title} · {groupLabel(ev.group_id)} · {fmtHours(ev.hours_cent)} ч
                  </option>
                ))}
              </select>
            </Field>
          )}

          <Field label="Преподаватель" htmlFor="cf-teacher">
            <select
              id="cf-teacher"
              className="select"
              value={teacherId}
              disabled={saving || !!event || !canPickTeacher}
              onChange={(e) => {
                setTeacherId(e.target.value === '' ? '' : Number(e.target.value))
                setEventId('')
              }}
            >
              {canPickTeacher && <option value="">— выберите преподавателя —</option>}
              {boot.teachers
                .filter((t) => canPickTeacher || t.id === fixedTeacherId)
                .map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
            </select>
          </Field>

          <Field label="Группа" htmlFor="cf-group">
            <select
              id="cf-group"
              className="select"
              value={groupId}
              disabled={saving || !!event}
              onChange={(e) => setGroupId(e.target.value)}
            >
              <option value="">— выберите группу —</option>
              {boot.groups.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.label}
                </option>
              ))}
            </select>
          </Field>

          {showDate && (
            <Field
              label="Дата"
              htmlFor="cf-date"
              hint={type?.daily_limited ? 'Для этого вида работы дата обязательна' : 'Можно оставить пустой'}
            >
              <input
                id="cf-date"
                className="input"
                type="date"
                value={date}
                max={today}
                disabled={saving}
                onChange={(e) => setDate(e.target.value)}
              />
            </Field>
          )}

          <Field
            label={`Количество${type ? `, ${type.unit}` : ''}`}
            htmlFor="cf-qty"
            hint={event ? 'Часы берутся из события' : type ? `Формула: ${type.label.toLowerCase()} — ${(type.coefficient_cent / 100).toLocaleString('ru-RU')} ч за 1 ${type.unit}` : undefined}
          >
            <input
              id="cf-qty"
              className="input"
              inputMode="decimal"
              value={quantity}
              disabled={saving || !!event}
              onChange={(e) => setQuantity(e.target.value)}
            />
          </Field>

          <Field label="Дисциплина" htmlFor="cf-disc">
            <input
              id="cf-disc"
              className="input"
              value={discipline}
              disabled={saving || !!event}
              onChange={(e) => setDiscipline(e.target.value)}
            />
          </Field>
        </div>

        <div className="formula" aria-live="polite">
          Предпросмотр часов: <strong>{hoursPreview !== null ? `${fmtHours(hoursPreview)} ч` : '—'}</strong>
          <span className="muted small"> — итог считает сервер по формуле и версии норм записи</span>
        </div>

        <Field label="Примечание" htmlFor="cf-notes">
          <textarea
            id="cf-notes"
            className="input"
            rows={3}
            value={notes}
            disabled={saving}
            onChange={(e) => setNotes(e.target.value)}
          />
        </Field>

        <p className="small muted">Автор записи: {user.name}</p>
      </div>

      <div className="modal-foot">
        {!canSave && missing.length > 0 && !closed && (
          <span className="small muted" style={{ marginRight: 'auto' }}>
            Укажите: {missing.join(', ')}
          </span>
        )}
        <Btn variant="secondary" onClick={handleClose} disabled={saving}>
          Отмена
        </Btn>
        <Btn variant="primary" loading={saving} disabled={!canSave} onClick={() => void save()}>
          Сохранить
        </Btn>
      </div>
    </Modal>
  )
}
