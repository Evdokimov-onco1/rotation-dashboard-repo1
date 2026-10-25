import { useMemo, useState, type FormEvent } from 'react'
import { FileSpreadsheet, Pencil, Upload } from 'lucide-react'
import { api, fmtHours, importPreview, monthName, type ImportPreview, type PlanRow } from '../api'
import { canImport, useApp } from '../store'
import { Btn, Empty, Field, Modal } from '../ui'

export function parseHoursCent(value:string):number|null {
  const v=value.trim().replace(',','.')
  if(!/^\d{1,5}(\.\d{1,2})?$/.test(v))return null
  const [a,b='']=v.split('.')
  return Number(a)*100+Number(b.padEnd(2,'0'))
}

export default function Plan(){
  const {boot,reload}=useApp();const now=new Date().toISOString().slice(0,7)
  const [month,setMonth]=useState(boot.year.months.includes(now)?now:boot.year.months[0])
  const [teacher,setTeacher]=useState(boot.user.teacher_id??0);const [type,setType]=useState('')
  const [query,setQuery]=useState('');const [editing,setEditing]=useState<PlanRow|null>(null)
  const [upload,setUpload]=useState<ImportPreview|null>(null);const [busy,setBusy]=useState(false);const [error,setError]=useState('');const [message,setMessage]=useState('')
  const editable=canImport(boot.user)
  const rows=useMemo(()=>boot.plans.filter(p=>p.month===month&&(!teacher||p.teacher_id===teacher)&&(!type||p.type===type)&&(!query||p.discipline.toLowerCase().includes(query.toLowerCase()))),[boot.plans,month,teacher,type,query])
  const teacherName=(id:number)=>boot.teachers.find(t=>t.id===id)?.name??''
  async function loadFile(file:File){setError('');setMessage('');setBusy(true);try{setUpload(await importPreview(file))}catch(e){setError((e as Error).message)}finally{setBusy(false)}}
  async function commit(){if(!upload)return;setBusy(true);setError('');try{await api.importCommit(upload.token);await reload();setUpload(null);setMessage('Месячный план загружен. Фактическая нагрузка не изменена.')}catch(e){setError((e as Error).message)}finally{setBusy(false)}}
  return <>
    <p className="sub">Предварительное распределение на учебный год. Изменение плана сохраняется с причиной и не начисляет выполненные часы.</p>
    {boot.import_summary&&<div className="source-line"><FileSpreadsheet size={18}/><div><strong>{fmtHours(boot.import_summary.total_cent)} ч</strong> в исходном годовом плане · {boot.import_summary.rows} строк<br/><span className="small muted">{boot.import_summary.filename}</span></div></div>}
    {error&&<p className="inline-error" role="alert">{error}</p>}{message&&<p className="notice" role="status">{message}</p>}
    <div className="toolbar">
      <select className="select" aria-label="Месяц плана" value={month} onChange={e=>setMonth(e.target.value)}>{boot.year.months.map(m=><option key={m} value={m}>{monthName(m)}</option>)}</select>
      <select className="select" aria-label="Преподаватель плана" value={teacher} onChange={e=>setTeacher(Number(e.target.value))}><option value={0}>Все преподаватели</option>{boot.teachers.map(t=><option key={t.id} value={t.id}>{t.name}</option>)}</select>
      <select className="select" aria-label="Вид нагрузки плана" value={type} onChange={e=>setType(e.target.value)}><option value="">Все виды работы</option>{boot.types.map(t=><option key={t.id} value={t.id}>{t.label}</option>)}</select>
      <span className="spacer"/><strong className="num">{fmtHours(rows.reduce((s,p)=>s+p.hours_cent,0))} ч</strong>
    </div>
    <div className="toolbar" style={{marginTop:12,marginBottom:16}}><input className="input" style={{maxWidth:320}} aria-label="Поиск по дисциплине" placeholder="Найти дисциплину" value={query} onChange={e=>setQuery(e.target.value)}/><span className="small muted">{rows.length} строк в выбранной области</span><span className="spacer"/>{editable&&<label className="btn btn-secondary" style={{cursor:busy?'wait':'pointer'}}><Upload size={15}/>{busy?'Проверяем файл…':'Проверить Excel'}<input type="file" accept=".xlsx" disabled={busy} aria-label="Загрузить Excel для проверки" style={{position:'absolute',width:1,height:1,opacity:0}} onChange={e=>{const f=e.target.files?.[0];if(f)void loadFile(f);e.target.value=''}}/></label>}</div>
    {rows.length?<div className="table-wrap"><table className="table"><thead><tr><th>Дисциплина и группа</th><th>Преподаватель</th><th>Работа</th><th className="num">План, ч</th><th>Источник</th>{editable&&<th><span className="sr-only">Изменить</span></th>}</tr></thead><tbody>{rows.map(p=><tr key={p.id}><td><strong>{p.discipline}</strong><div className="small muted">{boot.groups.find(g=>g.id===p.group_id)?.label}</div></td><td>{teacherName(p.teacher_id)}</td><td>{boot.types.find(t=>t.id===p.type)?.label}</td><td className="num">{fmtHours(p.hours_cent)}</td><td className="small muted">{p.source.split('!')[1]??p.source}<br/>версия {p.version}</td>{editable&&<td><Btn sm variant="ghost" aria-label={`Изменить план: ${p.discipline}, ${teacherName(p.teacher_id)}`} onClick={()=>setEditing(p)} disabled={boot.closures.some(c=>c.teacher_id===p.teacher_id&&c.month===p.month)}><Pencil size={14}/></Btn></td>}</tr>)}</tbody></table></div>:<Empty title="В этой области плана нет строк">Выберите другой месяц, преподавателя или вид работы.</Empty>}
    {upload&&<Modal title="Проверка книги перед импортом" wide onClose={()=>!busy&&setUpload(null)}><div className="modal-body"><p>{upload.filename}</p><div className="kpis"><div className="kpi"><div className="k-label">Строк</div><div className="k-value">{upload.rows}</div></div><div className="kpi"><div className="k-label">Годовой план</div><div className="k-value">{fmtHours(upload.total_cent)} <span className="unit">ч</span></div></div></div>{upload.warnings.map(w=><p className="notice" key={w}>{w}</p>)}{upload.errors.length>0&&<div className="inline-error" role="alert"><ul>{upload.errors.map((e,i)=><li key={i}>{e}</li>)}</ul></div>}{upload.duplicate&&<p className="notice">Этот файл уже загружен. Дубликаты не создаются.</p>}{boot.import_summary&&!upload.duplicate&&<p className="notice">В этом году план уже существует. В пилоте изменяйте нужные строки с указанием причины; замена всего года отключена.</p>}<div className="table-wrap"><table className="table"><thead><tr><th>Месяц</th><th className="num">Часы</th></tr></thead><tbody>{upload.monthly.map(m=><tr key={m.month}><td>{monthName(m.month)}</td><td className="num">{fmtHours(m.hours_cent)}</td></tr>)}</tbody></table></div></div><div className="modal-foot"><Btn onClick={()=>setUpload(null)} disabled={busy}>Закрыть</Btn><Btn variant="primary" loading={busy} disabled={!!upload.errors.length||upload.duplicate||!!boot.import_summary} onClick={()=>void commit()}>Загрузить как план</Btn></div></Modal>}
    {editing&&<PlanEdit row={editing} onClose={()=>setEditing(null)} onSaved={async()=>{await reload();setEditing(null);setMessage('Изменение плана сохранено в журнале.')}}/>}
  </>
}

function PlanEdit({row,onClose,onSaved}:{row:PlanRow;onClose:()=>void;onSaved:()=>Promise<void>}){
  const [hours,setHours]=useState(fmtHours(row.hours_cent).replace(/\s/g,''));const [reason,setReason]=useState('');const [busy,setBusy]=useState(false);const [error,setError]=useState('')
  async function save(e:FormEvent){e.preventDefault();const cents=parseHoursCent(hours);if(cents===null){setError('Введите неотрицательное число часов, не более двух знаков после запятой.');return}setBusy(true);setError('');try{await api.planSave(row.id,row.version,cents,reason);await onSaved()}catch(e){setError((e as Error).message)}finally{setBusy(false)}}
  return <Modal title="Изменить месячный план" onClose={()=>!busy&&onClose()}><form onSubmit={save}><div className="modal-body"><p>{row.discipline} · {monthName(row.month)}</p><Field label="План, академических часов" htmlFor="plan-hours"><input id="plan-hours" className="input" inputMode="decimal" value={hours} onChange={e=>setHours(e.target.value)} required/></Field><Field label="Причина изменения" htmlFor="plan-reason"><textarea id="plan-reason" className="input" value={reason} onChange={e=>setReason(e.target.value)} required maxLength={1000}/></Field><p className="small muted">Предыдущие часы и причина сохранятся. Подтверждённый факт останется прежним.</p>{error&&<p className="inline-error" role="alert">{error}</p>}</div><div className="modal-foot"><Btn onClick={onClose} disabled={busy} type="button">Отмена</Btn><Btn type="submit" variant="primary" loading={busy}>Сохранить изменение</Btn></div></form></Modal>
}
