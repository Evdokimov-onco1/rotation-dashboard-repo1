import { useMemo, useState } from 'react'
import { computeMetrics, fmtHours, monthName, type Scope } from '../api'
import { useApp } from '../store'
import { Empty } from '../ui'

export default function Overview() {
  const { boot } = useApp()
  const nowMonth = new Date().toISOString().slice(0, 7)

  const [month, setMonth] = useState<string | null>(
    boot.year.months.includes(nowMonth) ? nowMonth : boot.year.months[0] ?? null,
  )
  const [teacherId, setTeacherId] = useState<number | 'all'>(boot.user.teacher_id ?? 'all')
  const [groupId, setGroupId] = useState<string | 'all'>('all')

  const scope: Scope = { month, teacherId, groupId }
  const m = useMemo(
    () => computeMetrics(boot.plans, boot.claims, scope),
    [boot.plans, boot.claims, month, teacherId, groupId],
  )

  // Таблица нагрузок: область — выбранный месяц (или год) и группа,
  // строка = преподаватель; фильтр преподавателя сверху не схлопывает таблицу.
  const teacherRows = useMemo(
    () =>
      boot.teachers.filter((t) => teacherId === 'all' || t.id === teacherId).filter((t)=>!boot.user.roles.every(r=>r==='teacher') || t.id===boot.user.teacher_id).map((t) => ({
        teacher: t,
        m: computeMetrics(boot.plans, boot.claims, { month, teacherId: t.id, groupId }),
      })),
    [boot.plans, boot.claims, boot.teachers, month, groupId, teacherId, boot.user],
  )

  const progress = m.planCent > 0 ? Math.round((m.approvedCent / m.planCent) * 100) : null
  const remaining = Math.max(0, m.planCent - m.approvedCent)
  const overage = Math.max(0, m.approvedCent - m.planCent)

  const scopeLabel =
    (month ? monthName(month) : 'весь учебный год') +
    (groupId !== 'all'
      ? ` · группа ${boot.groups.find((g) => g.id === groupId)?.label ?? groupId}`
      : ' · все группы') +
    (teacherId !== 'all'
      ? ` · ${boot.teachers.find((t) => t.id === teacherId)?.name ?? ''}`
      : '')

  return (
    <div>
      <div className="panel toolbar" role="group" aria-label="Фильтры сводки">
        <select
          className="select"
          aria-label="Месяц"
          value={month ?? ''}
          onChange={(e) => setMonth(e.target.value === '' ? null : e.target.value)}
        >
          <option value="">Весь год</option>
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
          {boot.teachers.filter((t) => teacherId === 'all' || t.id === teacherId).filter((t)=>!boot.user.roles.every(r=>r==='teacher') || t.id===boot.user.teacher_id).map((t) => (
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
        <span className="spacer" />
        <span className="small muted">{scopeLabel}</span>
      </div>

      <div className="kpis" aria-label="Метрики">
        <div className="kpi">
          <div className="k-label">План</div>
          <div className="k-value num">
            {fmtHours(m.planCent)}
            <span className="unit">ч</span>
          </div>
          <div className="k-sub">по выбранной области</div>
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
          <div className="k-sub">
            осталось {fmtHours(remaining)} ч
            {overage > 0 && (
              <>
                {' · '}
                <span className="neg">сверх плана {fmtHours(overage)} ч</span>
              </>
            )}
          </div>
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

      <h2 className="section-title">Нагрузка преподавателей</h2>
      {teacherRows.length === 0 ? (
        <div className="panel">
          <Empty title="Нет преподавателей">
            Список преподавателей пуст — обратитесь в учебную часть.
          </Empty>
        </div>
      ) : (
        <div className="panel table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Преподаватель</th>
                <th className="num">Ставка</th>
                <th className="num">План, ч</th>
                <th className="num">Подтверждено, ч</th>
                <th className="num">Прогресс</th>
                <th className="num">Заявлено, ч</th>
                <th className="num">На проверке, ч</th>
              </tr>
            </thead>
            <tbody>
              {teacherRows.map(({ teacher, m: tm }) => {
                const p = tm.planCent > 0 ? Math.round((tm.approvedCent / tm.planCent) * 100) : null
                return (
                  <tr key={teacher.id}>
                    <td><a href={`#/facts?teacher=${teacher.id}${month ? `&month=${month}` : ""}`}>{teacher.name}</a></td>
                    <td className="num">{teacher.rate.replace(".", ",")}</td>
                    <td className="num">{fmtHours(tm.planCent)}</td>
                    <td className="num">{fmtHours(tm.approvedCent)}</td>
                    <td className="num">{p === null ? '—' : `${p} %`}</td>
                    <td className="num">{fmtHours(tm.declaredCent)}</td>
                    <td className="num">{fmtHours(tm.submittedCent)}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
      <p className="small muted" style={{ marginTop: 10 }}>
        Прогресс = подтверждено / план; при нулевом плане показывается «—». «Заявлено» — последние
        действующие редакции записей по каждой работе в области фильтра.
      </p>
    </div>
  )
}
