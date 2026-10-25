import { useApp } from '../store'
import { fmtHours } from '../api'

const unitLabels: Record<string, string> = {
  lecture: 'за академический час', seminar: 'за академический час', practical: 'за академический час',
  consultation: 'за академический час', preexam: 'на группу', control: 'за работу',
  pass: 'на обучающегося', graded_pass: 'на обучающегося', exam: 'на обучающегося',
  state_exam: 'на обучающегося', practice: 'на обучающегося за неделю',
}

export default function Norms() {
  const { boot } = useApp()
  const n = boot.norms

  return (
    <div>
      <div className="panel table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>Вид работы</th>
              <th>Норма часов</th>
              <th>Примечание</th>
            </tr>
          </thead>
          <tbody>
            {boot.types.map((t) => (
              <tr key={t.id}>
                <td>{t.label}</td>
                <td>{fmtHours(t.coefficient_cent)} ч {unitLabels[t.id]}</td>
                <td className="muted small">
                  {t.daily_limited ? 'Общий дневной предел аттестаций — 6 ч.' :
                    t.id === 'consultation' ? 'Ориентир — 10 % аудиторной нагрузки; фактически проведённые часы вносятся отдельно.' :
                    t.id === 'practical' ? 'Учёт за месяц, без календарного расписания.' : ''}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2 className="section-title">Параметры начисления</h2>
      <div className="panel table-wrap">
        <table className="table">
          <tbody>
            <tr>
              <td>Версия норм</td>
              <td>
                Пилотная · 1 <span className="pill pill-draft">На проверке</span>
              </td>
            </tr>
            <tr>
              <td>Дневной лимит</td>
              <td className="num">
                {fmtHours(n.daily_cap_cent)} ч — пилотное значение, 6 часов в день
              </td>
            </tr>
            <tr>
              <td>Консультационный процент</td>
              <td className="num">{n.consultation_percent} %</td>
            </tr>
            <tr>
              <td>Годовой объём</td>
              <td>
                {n.annual_basis !== null
                  ? `${fmtHours(n.annual_basis)} ч`
                  : '800/801 час — не утверждён, остаётся открытым вопросом'}
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <p className="small muted" style={{ marginTop: 10 }}>
        Страница справочная: итоговые часы по каждой записи считает сервер по формуле и версии норм,
        указанным в самой записи. Проверка консультационных 10 % носит информационный характер и не
        создаёт фактических записей.
      </p>
    </div>
  )
}
