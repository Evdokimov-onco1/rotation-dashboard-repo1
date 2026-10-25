# Teaching preview API v1

Independent application, mounted at `/teaching-preview/`. All UI labels are Russian. Never call the rotation `/api/` or read its cookies. Hash navigation only. Endpoint is `./api.php?action=NAME`. All responses are JSON `{ok:true,data:...}` or `{ok:false,error:{code,message}}`. Non-GET requires `X-CSRF-Token` from bootstrap; use credentials:same-origin. HTTP 401 returns to login; 409 means stale state or business conflict. Refresh bootstrap after every mutation. No optimistic approval state. Display server error inline; retain form inputs on error.

GET bootstrap is allowed anonymously: `{user:null,csrf,preview:true}`. Authenticated returns:

```
{user:{id,name,roles:["admin","office","approver","teacher"],teacher_id:null|number},csrf,preview:true,
year:{id:"2026-27",label:"2026/27",months:["2026-09",...,"2027-07"]},
teachers:[{id,name,rate}], groups:[{id,course,semester,label}],
types:[{id,label,unit,coefficient_cent,integer_quantity,daily_limited}],
plans:[{id,teacher_id,group_id,discipline,month,type,hours_cent,source,version}],
events:[{id,type,title,teacher_id,group_id,date,start,end,hours_cent,room,status,version,plan_id}],
claims:[{id,work_id,version,status,type,teacher_id,group_id,month,date,quantity,hours_cent,discipline,event_id,notes,author_name,rule_version,formula,supersedes_id,comment}],
closures:[{teacher_id,month,closed_at,closed_by}],
reports:[{id,month,group_id,teacher_id,draft,created_at,revision,filename}],
audit:[{id,created_at,actor,action,detail}],
norms:{version:"preview-1",status:"preview",daily_cap_cent:600,annual_basis:null,consultation_percent:10},
import_summary:null|{filename,rows,total_cent,created_at}}
```

Hours are integer hundredths throughout, show via Intl.NumberFormat('ru-RU') on hours_cent/100, max2decimals. Quantity must be STRING, comma allowed. Types: lecture,seminar,practical,consultation,preexam,control,pass,graded_pass,exam,state_exam,practice. Teacher view receives only its own plans/claims. Canonical is_current_claimed and has_pending_correction flags are computed globally to resolve cross-teacher revisions without revealing another teacher’s rows. full published schedule. Other roles receive all datasets. Event statuses draft/published/cancelled. Claim statuses draft/submitted/approved/returned/cancelled/superseded.

## Actions

POST JSON except upload. IDs integer, group_id string (e.g. c1s1g1).

- login `{login,password}` -> user. logout `{}`.
- event.save `{id?:number,version?:number,type:"lecture"|"seminar",title,teacher_id,group_id,date:"YYYY-MM-DD",start:"HH:mm",end:"HH:mm",hours_cent:number,room,plan_id?:number|null}` -> event. Office/admin only. Timetable hours explicitly entered, not derived from elapsed time. Only academic year dates, prevent teacher/group/room overlaps among active events. Approved/reported event cannot move. No practical events. All edits return to draft and require publication. Single event is sufficient for v1; create series by explicit user choice only if backend supports it (not currently).
- event.publish `{id,version}`; event.cancel `{id,version,comment}`. Office/admin only. Cannot cancel event with live claim. Calendar drag/drop calls event.save with changed date and full existing fields, asks confirmation, refreshes. Always provide equivalent form editing.
- claim.save `{id?:number,version?:number,teacher_id,group_id,type,month,date?:"YYYY-MM-DD"|"",quantity:string,discipline,event_id?:number|null,notes}` -> claim. Teacher only own, office/admin any. Draft/returned editing only. Lecture/seminar requires a published event; use event's teacher/group/date/hours. Practical permits month only. Daily limited types require date. Show quantity unit and computed hours preview; backend authoritative. New claim starts draft.
- claim.correct `{id,version}` -> new draft retaining original approved record until replacement approved. Only one pending correction per work. New draft returned from action can be opened for editing.
- claim.submit `{ids:[number],versions:{id:number}}` -> count. All-or-nothing. Available to teacher/office/admin. Submitted records read-only.
- claim.cancel `{id,version,comment}` -> count. Pending draft/returned correction can be cancelled; original remains approved. Requires comment.
- claim.review `{ids:[number],versions:{id:number},decision:"approve"|"return",comment:string}` -> count. Approver only; return requires comment. Batch is atomic. Approving correction replaces previous revision, never sums both. Daily cap validated against approved totals with ONLY this batch's replacements.
- month.close `{teacher_id,month}`; month.reopen `{teacher_id,month,comment}`. Approver only; close blocks outstanding draft/submitted/returned work including corrections across both months/teachers. Reopen reason mandatory. Closed scope blocks all changes until reopened.
- plan.save `{id,version,hours_cent:number,reason:string}`. Office/admin; edit monthly plan hours, audit previous value; closed month blocks. Plan does not alter fact.
- import.preview multipart FormData `file`: XLSX original compatible book -> `{token,filename,rows,total_cent,teachers,monthly:[{month,hours_cent}],warnings:[],errors:[],duplicate:boolean}`. Office/admin. No changes before commit. Display results and explicit button. Errors block commit.
- import.commit `{token}` -> summary. Exact duplicate refused; existing plans cannot be silently replaced (import is for initial empty year only in this preview; later plan changes via plan.save).
- report.create `{month,group_id?:string|null,teacher_id?:number|null,draft:boolean}` -> `{id,filename}`. Available office/admin/approver. Teacher only own. draft=false requires every included teacher/month closed. Entire test environment still marks document PROJECT. Includes approved claims only; freezes snapshot, no pending claims.
- GET report.download&id=N -> authenticated DOCX binary; use normal anchor `./api.php?action=report.download&id=N`.
- GET report.snapshot&id=N -> JSON frozen rows and totals for reconciliation.

## Metrics and scope

Every displayed total respects selected month and teacher (and group when selected). “План” = plans sum. “Подтверждено” = approved claims only. “На проверке” = submitted hours. “Заявлено” = latest noncancelled/nonsuperseded revision per work (draft/submitted/returned new works included; returned correction falls back to approved revision). Never add pending correction to old approved record. Progress = confirmed/plan, show — for zero plan; not average of percentages. Expose on-check separately, do not call it fact. Hours remaining max(0,plan-confirmed); overage separately. Calendar heading and filter scope are explicit. No invented fact, no demo records when connected to live bootstrap.

## Preview boundaries

Visible banner on every authenticated page: «Тестовая версия · подтверждения и выгрузки не являются рабочими отчётами». Initial fact is zero. Empty states need useful action. Norms page states annual 800/801 unresolved, preexam2/group, exam.4/student, stateexam.5/student per teacher, control.5/work, pass.2, graded.3, practical/lecture/seminar1, practice1/student-week. Consultation10% check is informational, not fact generation. Authenticated role names use actual user.name; do not fabricate a signature. Show link back to https://rotation.mmcc-education.ru/.
