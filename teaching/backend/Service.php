<?php
declare(strict_types=1);
namespace Teaching;

use PDO;
use RuntimeException;
use InvalidArgumentException;
use Throwable;
require_once __DIR__.'/Rules.php';

final class Problem extends RuntimeException {
    public function __construct(string $message, public readonly int $status=422, public readonly string $kind='validation') {parent::__construct($message);}
}

final class Service {
    private PDO $pdo;
    public readonly array $config;
    private const LIMITED=['pass','graded_pass','exam','state_exam'];
    public function __construct(array $config) {
        $this->config=$config;
        $dir=$config['private_dir'];
        if(!is_dir($dir))mkdir($dir,0700,true);
        $this->pdo=new PDO('sqlite:'.$dir.'/teaching.sqlite',null,null,[PDO::ATTR_ERRMODE=>PDO::ERRMODE_EXCEPTION,PDO::ATTR_DEFAULT_FETCH_MODE=>PDO::FETCH_ASSOC]);
        $this->pdo->exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000; PRAGMA journal_mode=WAL;');
        $this->pdo->exec(file_get_contents(__DIR__.'/../schema/sqlite.sql'));
        @chmod($dir.'/teaching.sqlite',0600);
    }
    public function db():PDO {return $this->pdo;}
    public function now():string {return (new \DateTimeImmutable('now',new \DateTimeZone('Europe/Moscow')))->format('Y-m-d H:i:s');}
    public function today():string {return $this->config['today']??substr($this->now(),0,10);}
    public function months():array {return ['2026-09','2026-10','2026-11','2026-12','2027-01','2027-02','2027-03','2027-04','2027-05','2027-06','2027-07'];}
    public function all(string $sql,array $args=[]):array {$q=$this->pdo->prepare($sql);$q->execute($args);return $q->fetchAll();}
    public function row(string $table,int|string $id):array {
        if(!in_array($table,['claims','events','plans','teachers','groups','reports','users'],true))throw new RuntimeException('Invalid table');
        $r=$this->all("SELECT * FROM $table WHERE id=?",[$id]);if(!$r)throw new Problem('Запись не найдена.',404,'not_found');return $r[0];
    }
    private function sql(string $sql,array $args=[]):void {$this->pdo->prepare($sql)->execute($args);}
    public function transaction(callable $fn):mixed {
        $this->pdo->exec('BEGIN IMMEDIATE');
        try{$r=$fn();$this->pdo->exec('COMMIT');return $r;}catch(Throwable $e){$this->pdo->exec('ROLLBACK');throw $e;}
    }
    public function audit(array $actor,string $action,array $detail):void {
        $this->sql('INSERT INTO audit(created_at,actor,actor_id,action,detail) VALUES(?,?,?,?,?)',[$this->now(),$actor['name'],$actor['id'],$action,json_encode($detail,JSON_UNESCAPED_UNICODE|JSON_THROW_ON_ERROR)]);
    }
    public function has(array $actor,string ...$roles):bool {return (bool)array_intersect($actor['roles'],$roles);}
    private function permit(array $actor,string ...$roles):void {if(!$this->has($actor,...$roles))throw new Problem('Недостаточно прав для этого действия.',403,'forbidden');}
    private function teacherScope(array $actor,int $id):void {
        if(!$this->has($actor,'office','admin') && (!$this->has($actor,'teacher')||(int)($actor['teacher_id']??0)!==$id))throw new Problem('Можно вносить только свою нагрузку.',403,'forbidden');
    }
    private function version(array $row,array $input):void {
        if(!isset($input['version']) || (int)$input['version']!==(int)$row['version'])throw new Problem('Запись уже изменена. Обновите страницу и проверьте актуальную версию.',409,'stale');
    }
    private function text(mixed $v,int $max=240,bool $required=true):string {
        if(!is_string($v))throw new Problem('Ожидается текстовое значение.');$v=trim($v);
        if(($required&&$v==='')||mb_strlen($v)>$max)throw new Problem('Проверьте заполнение и длину текстового поля.');return $v;
    }
    private function integer(mixed $v,int $min=1,int $max=10000000):int {
        if(!is_int($v)||$v<$min||$v>$max)throw new Problem('Проверьте числовое значение.');return $v;
    }
    public function month(string $month):void {if(!in_array($month,$this->months(),true))throw new Problem('Месяц должен относиться к учебному году 2026/27.');}
    private function date(string $date):void {
        $d=\DateTimeImmutable::createFromFormat('!Y-m-d',$date);if(!$d||$d->format('Y-m-d')!==$date)throw new Problem('Укажите существующую дату.');$this->month(substr($date,0,7));
    }
    private function open(int $teacher,string $month):void {
        if($this->all('SELECT 1 FROM closures WHERE teacher_id=? AND month=?',[$teacher,$month]))throw new Problem('Месяц закрыт. Для изменения требуется открыть его с указанием причины.',409,'closed');
    }
    private function openClaim(array $c):void {
        $this->open((int)$c['teacher_id'],$c['month']);
        if($c['supersedes_id']??null){$old=$this->row('claims',(int)$c['supersedes_id']);$this->open((int)$old['teacher_id'],$old['month']);}
    }
    public function snapshot(array $actor):array {
        $staff=$this->has($actor,'office','admin','approver');$scope=$staff?'':' WHERE teacher_id='.(int)$actor['teacher_id'];
        $events=$staff?$this->all('SELECT * FROM events ORDER BY date,start,id'):$this->all("SELECT * FROM events WHERE status='published' ORDER BY date,start,id");
        $imports=$this->all('SELECT filename,payload,committed_at FROM imports WHERE committed_at IS NOT NULL ORDER BY committed_at DESC LIMIT 1');
        $summary=null;
        if($imports){$p=json_decode($imports[0]['payload'],true);$summary=['filename'=>$imports[0]['filename'],'rows'=>$p['rows'],'total_cent'=>$p['total_cent'],'created_at'=>$imports[0]['committed_at']];}
        // Compute canonical work selection globally, expose only flags on the actor's own rows.
        $allClaims=$this->all('SELECT * FROM claims ORDER BY id DESC');$chosen=[];$approved=[];$pending=[];
        foreach($allClaims as $c){if($c['status']==='approved')$approved[$c['work_id']]=$c['id'];if($c['supersedes_id']&&in_array($c['status'],['draft','submitted','returned'],true))$pending[$c['work_id']]=true;if(!in_array($c['status'],['cancelled','superseded'],true)&&!isset($chosen[$c['work_id']]))$chosen[$c['work_id']]=$c;}
        foreach($chosen as $key=>$c)if($c['status']==='returned'&&$c['supersedes_id']&&isset($approved[$key]))$chosen[$key]=['id'=>$approved[$key]];
        $claims=[];foreach($allClaims as $c){if(!$staff&&(int)$c['teacher_id']!==(int)$actor['teacher_id'])continue;$c['is_current_claimed']=($chosen[$c['work_id']]['id']??null)===$c['id'];$c['has_pending_correction']=isset($pending[$c['work_id']]);$claims[]=$c;}
        return ['user'=>$actor,'preview'=>true,'year'=>['id'=>'2026-27','label'=>'2026/27','months'=>$this->months()],
            'teachers'=>$this->all('SELECT * FROM teachers ORDER BY name'),'groups'=>$this->all('SELECT * FROM groups ORDER BY course,semester,id'),
            'types'=>Rules::types(),'plans'=>$this->all('SELECT * FROM plans'.$scope.' ORDER BY month,teacher_id,type,id'),'events'=>$events,
            'claims'=>$claims,'closures'=>$this->all('SELECT * FROM closures'.$scope),
            'reports'=>$this->all('SELECT id,month,group_id,teacher_id,draft,created_at,revision,filename FROM reports'.$scope.' ORDER BY id DESC'),
            'audit'=>$staff?$this->all('SELECT * FROM audit ORDER BY id DESC LIMIT 100'):[],
            'norms'=>['version'=>'preview-1','status'=>'preview','daily_cap_cent'=>600,'annual_basis'=>null,'consultation_percent'=>10], 'import_summary'=>$summary];
    }
    public function metrics(array $actor,string $month,?int $teacher=null):array {
        $snap=$this->snapshot($actor);$in=fn($r)=>$r['month']===$month&&(!$teacher||(int)$r['teacher_id']===$teacher);
        $plan=array_sum(array_column(array_filter($snap['plans'],$in),'hours_cent'));$confirmed=0;$pending=0;$claimed=0;$works=[];
        foreach($snap['claims'] as $c){if(in_array($c['status'],['cancelled','superseded'],true))continue;$works[$c['work_id']][]=$c;if($in($c)&&$c['status']==='approved')$confirmed+=$c['hours_cent'];if($in($c)&&$c['status']==='submitted')$pending+=$c['hours_cent'];}
        foreach($snap['claims'] as $c)if($c['is_current_claimed']&&$in($c))$claimed+=$c['hours_cent'];
        return ['plan_cent'=>$plan,'confirmed_cent'=>$confirmed,'pending_cent'=>$pending,'claimed_cent'=>$claimed];
    }
    public function dispatch(string $action,array $input,array $actor):array {
        if($action==='bootstrap')return $this->snapshot($actor);
        if(str_starts_with($action,'report.')){require_once __DIR__.'/Report.php';return (new Report($this))->dispatch($action,$input,$actor);}
        if($action==='import.commit'){require_once __DIR__.'/Workbook.php';return (new Workbook($this))->commit($input,$actor);}
        return $this->transaction(function()use($action,$input,$actor){
            return match($action){
                'event.save'=>$this->saveEvent($input,$actor),'event.publish'=>$this->changeEvent($input,$actor,false),'event.cancel'=>$this->changeEvent($input,$actor,true),
                'claim.save'=>$this->saveClaim($input,$actor),'claim.correct'=>$this->correct($input,$actor),'claim.submit'=>$this->submit($input,$actor),
                'claim.review'=>$this->review($input,$actor),'claim.cancel'=>$this->cancelClaim($input,$actor),
                'month.close'=>$this->closeMonth($input,$actor,false),'month.reopen'=>$this->closeMonth($input,$actor,true),
                'plan.save'=>$this->savePlan($input,$actor), default=>throw new Problem('Неизвестное действие.',404,'not_found')};
        });
    }
    private function eventEditable(array $e):void {
        $this->open((int)$e['teacher_id'],substr($e['date'],0,7));
        if($this->all("SELECT 1 FROM claims WHERE event_id=? AND status NOT IN ('cancelled','superseded')",[$e['id']]))throw new Problem('По занятию уже внесён факт. Сначала согласуйте исправление учёта; перенос не должен менять отчёт.',409,'reported_event');
    }
    private function clash(array $e):void {
        foreach($this->all("SELECT * FROM events WHERE date=? AND status!='cancelled' AND id!=? AND start<? AND end>?",[$e['date'],$e['id']??0,$e['end'],$e['start']]) as $other){
            if((int)$e['teacher_id']===(int)$other['teacher_id']||$e['group_id']===$other['group_id']||($e['room']!==''&&mb_strtolower($e['room'])===mb_strtolower($other['room'])))throw new Problem('В это время уже заняты преподаватель, группа или аудитория.',409,'schedule_conflict');
        }
    }
    private function saveEvent(array $in,array $actor):array {
        $this->permit($actor,'office','admin');$old=null;
        if(!empty($in['id'])){$old=$this->row('events',(int)$in['id']);$this->version($old,$in);$this->eventEditable($old);if($old['status']==='cancelled')throw new Problem('Отменённое занятие нельзя редактировать.');}
        if(!in_array($in['type']??'', ['lecture','seminar'],true))throw new Problem('В календаре планируются только лекции и семинары.');
        $teacher=$this->integer($in['teacher_id']??null);$this->row('teachers',$teacher);$group=$this->text($in['group_id']??'');$this->row('groups',$group);
        $date=$this->text($in['date']??'',10);$this->date($date);$this->open($teacher,substr($date,0,7));
        $start=$this->text($in['start']??'',5);$end=$this->text($in['end']??'',5);
        if(!preg_match('/^(?:[01]\d|2[0-3]):[0-5]\d$/',$start)||!preg_match('/^(?:[01]\d|2[0-3]):[0-5]\d$/',$end)||$end<=$start)throw new Problem('Проверьте начало и окончание занятия.');
        $e=['id'=>$old['id']??null,'type'=>$in['type'],'title'=>$this->text($in['title']??''),'teacher_id'=>$teacher,'group_id'=>$group,'date'=>$date,'start'=>$start,'end'=>$end,'hours_cent'=>$this->integer($in['hours_cent']??null,1,2400),'room'=>$this->text($in['room']??'',100,false),'plan_id'=>!empty($in['plan_id'])?(int)$in['plan_id']:null];
        if($e['plan_id']){$p=$this->row('plans',$e['plan_id']);if($p['teacher_id']!==$teacher||$p['group_id']!==$group||$p['type']!==$e['type']||$p['month']!==substr($date,0,7))throw new Problem('Занятие не соответствует выбранной строке месячного плана.');}
        $this->clash($e);
        $values=[$e['type'],$e['title'],$teacher,$group,$date,$start,$end,$e['hours_cent'],$e['room'],$e['plan_id']];
        if($old){$this->sql("UPDATE events SET type=?,title=?,teacher_id=?,group_id=?,date=?,start=?,end=?,hours_cent=?,room=?,plan_id=?,status='draft',version=version+1 WHERE id=?",[...$values,$old['id']]);$id=$old['id'];}
        else{$this->sql('INSERT INTO events(type,title,teacher_id,group_id,date,start,end,hours_cent,room,plan_id) VALUES(?,?,?,?,?,?,?,?,?,?)',$values);$id=(int)$this->pdo->lastInsertId();}
        $result=$this->row('events',$id);$this->audit($actor,'event.save',['before'=>$old,'after'=>$result]);return $result;
    }
    private function changeEvent(array $in,array $actor,bool $cancel):array {
        $this->permit($actor,'office','admin');$e=$this->row('events',(int)($in['id']??0));$this->version($e,$in);$this->eventEditable($e);
        if($e['status']==='cancelled')throw new Problem('Занятие уже отменено.');
        $comment=$cancel?$this->text($in['comment']??'',1000):'';if(!$cancel)$this->clash($e);
        $this->sql('UPDATE events SET status=?,version=version+1 WHERE id=?',[$cancel?'cancelled':'published',$e['id']]);
        $this->audit($actor,$cancel?'event.cancel':'event.publish',['id'=>$e['id'],'comment'=>$comment]);return $this->row('events',$e['id']);
    }
    private function saveClaim(array $in,array $actor):array {
        $old=null;if(!empty($in['id'])){$old=$this->row('claims',(int)$in['id']);$this->version($old,$in);$this->teacherScope($actor,(int)$old['teacher_id']);$this->openClaim($old);if(!in_array($old['status'],['draft','returned'],true))throw new Problem('Редактировать можно черновик или возвращённую запись.',409,'state');}
        $teacher=$this->integer($in['teacher_id']??null);$this->teacherScope($actor,$teacher);$this->row('teachers',$teacher);
        $group=$this->text($in['group_id']??'');$this->row('groups',$group);$month=$this->text($in['month']??'',7);$this->month($month);$this->open($teacher,$month);
        $calc=Rules::calculate($in);$date=$this->text($in['date']??'',10,false);if($date!==''){$this->date($date);if(substr($date,0,7)!==$month)throw new Problem('Дата выполнения должна относиться к выбранному месяцу.');}
        if($calc['daily_limited']&&$date==='')throw new Problem('Для зачёта или экзамена укажите дату: действует дневной лимит.');
        $eventId=!empty($in['event_id'])?(int)$in['event_id']:null;
        if(in_array($calc['type'],['lecture','seminar'],true)){
            if(!$eventId)throw new Problem('Выберите опубликованное занятие в соответствующем расписании.');$e=$this->row('events',$eventId);
            if($e['status']!=='published'||$e['type']!==$calc['type']||(int)$e['teacher_id']!==$teacher||$e['group_id']!==$group||$e['date']!==$date||(int)$e['hours_cent']!==$calc['hours_cent'])throw new Problem('Факт должен соответствовать опубликованному занятию: преподаватель, группа, дата и часы.');
            $other=$this->all("SELECT work_id FROM claims WHERE event_id=? AND status NOT IN ('cancelled','superseded')",[$eventId]);
            foreach($other as $r)if(!$old||$r['work_id']!==$old['work_id'])throw new Problem('Это занятие уже учтено. Откройте существующую запись.',409,'duplicate');
        }elseif($eventId)throw new Problem('Этот вид работы не связан с календарным занятием.');
        if($calc['type']==='practical'&&$date!=='')throw new Problem('Практические занятия учитываются месячной строкой без даты.');
        $discipline=$this->text($in['discipline']??'');$notes=$this->text($in['notes']??'',2000,false);
        $values=[$calc['type'],$teacher,$group,$month,$date,$calc['quantity'],$calc['hours_cent'],$discipline,$eventId,$notes,$calc['formula'],$this->now()];
        if($old){$this->sql("UPDATE claims SET type=?,teacher_id=?,group_id=?,month=?,date=?,quantity=?,hours_cent=?,discipline=?,event_id=?,notes=?,formula=?,updated_at=?,status='draft',version=version+1,comment='' WHERE id=?",[...$values,$old['id']]);$id=$old['id'];}
        else{$this->sql('INSERT INTO claims(type,teacher_id,group_id,month,date,quantity,hours_cent,discipline,event_id,notes,formula,updated_at,work_id,author_id,author_name,rule_version,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',[...$values,bin2hex(random_bytes(16)),$actor['id'],$actor['name'],'preview-1',$this->now()]);$id=(int)$this->pdo->lastInsertId();}
        $result=$this->row('claims',$id);$this->audit($actor,'claim.save',['before'=>$old,'after'=>$result]);return $result;
    }
    private function correct(array $in,array $actor):array {
        $old=$this->row('claims',(int)($in['id']??0));$this->version($old,$in);$this->teacherScope($actor,(int)$old['teacher_id']);$this->openClaim($old);
        if($old['status']!=='approved')throw new Problem('Исправление создаётся только для подтверждённой записи.');
        if($this->all("SELECT 1 FROM claims WHERE work_id=? AND status IN ('draft','submitted','returned')",[$old['work_id']]))throw new Problem('Исправление уже открыто. Завершите или отмените его.',409,'pending_correction');
        $cols=['work_id','type','teacher_id','group_id','month','date','quantity','hours_cent','discipline','event_id','notes','rule_version','formula'];
        $values=array_map(fn($k)=>$old[$k],$cols);
        $this->sql('INSERT INTO claims('.implode(',',$cols).',revision,supersedes_id,author_id,author_name,created_at,updated_at) VALUES('.implode(',',array_fill(0,count($cols)+6,'?')).')',[...$values,$old['revision']+1,$old['id'],$actor['id'],$actor['name'],$this->now(),$this->now()]);
        $id=(int)$this->pdo->lastInsertId();$this->audit($actor,'claim.correct',['old_id'=>$old['id'],'new_id'=>$id]);return $this->row('claims',$id);
    }
    private function ids(array $in):array {
        $ids=$in['ids']??null;if(!is_array($ids)||!array_is_list($ids)||count($ids)<1||count($ids)>200)throw new Problem('Выберите от 1 до 200 записей.');
        $ids=array_map(fn($id)=>$this->integer($id),$ids);if(count(array_unique($ids))!==count($ids))throw new Problem('Повторные записи в пакете.');return $ids;
    }
    private function readiness(array $c):void {
        $this->openClaim($c);if($c['hours_cent']<=0)throw new Problem('Укажите положительный объём выполненной работы.');
        if($c['month']>substr($this->today(),0,7)||($c['date']!==''&&$c['date']>$this->today()))throw new Problem('Нельзя подтверждать работу, дата которой ещё не наступила.');
        if($c['event_id']){$e=$this->row('events',(int)$c['event_id']);if($e['status']!=='published')throw new Problem('Связанное занятие не опубликовано.');}
        if($c['supersedes_id']){$old=$this->row('claims',(int)$c['supersedes_id']);if($old['status']!=='approved')throw new Problem('Исходная версия уже изменена. Обновите данные.',409,'stale');}
    }
    private function dailyTotals(array $rows):array {
        $out=[];foreach($rows as $c)if(in_array($c['type'],self::LIMITED,true)){$key=$c['teacher_id'].'|'.$c['date'];$out[$key]=($out[$key]??0)+(int)$c['hours_cent'];}return $out;
    }
    private function checkCap(array $totals):void {foreach($totals as $key=>$hours)if($hours>600)throw new Problem('Дневной лимит зачётов и экзаменов — 6 ч на преподавателя. Проверьте дату, объём и другие записи этого дня.',409,'daily_limit');}
    private function submit(array $in,array $actor):array {
        $ids=$this->ids($in);$rows=[];
        foreach($ids as $id){$c=$this->row('claims',$id);$this->version($c,['version'=>$in['versions'][$id]??null]);$this->teacherScope($actor,(int)$c['teacher_id']);if(!in_array($c['status'],['draft','returned'],true))throw new Problem('На проверку отправляются только черновики и возвращённые записи.',409,'state');$this->readiness($c);$rows[]=$c;}
        $approved=$this->all("SELECT * FROM claims WHERE status='approved'");$totals=$this->dailyTotals($approved);
        // Pending reductions never free capacity. Reserve only the positive difference for the same teacher/day.
        foreach([...$this->all("SELECT * FROM claims WHERE status='submitted'"),...$rows] as $c){
            if(!in_array($c['type'],self::LIMITED,true))continue;$key=$c['teacher_id'].'|'.$c['date'];$delta=(int)$c['hours_cent'];
            if($c['supersedes_id']){$old=$this->row('claims',(int)$c['supersedes_id']);if($old['status']==='approved'&&in_array($old['type'],self::LIMITED,true)&&$old['teacher_id']===$c['teacher_id']&&$old['date']===$c['date'])$delta=max(0,$delta-$old['hours_cent']);}
            $totals[$key]=($totals[$key]??0)+$delta;
        }$this->checkCap($totals);
        foreach($ids as $id)$this->sql("UPDATE claims SET status='submitted',version=version+1,updated_at=? WHERE id=?",[$this->now(),$id]);
        $this->audit($actor,'claim.submit',['ids'=>$ids]);return ['count'=>count($ids)];
    }
    private function review(array $in,array $actor):array {
        $this->permit($actor,'approver');$ids=$this->ids($in);$decision=$in['decision']??'';if(!in_array($decision,['approve','return'],true))throw new Problem('Выберите подтверждение или возврат.');
        $comment=$this->text($in['comment']??'',2000,$decision==='return');$rows=[];$replace=[];
        foreach($ids as $id){$c=$this->row('claims',$id);$this->version($c,['version'=>$in['versions'][$id]??null]);if($c['status']!=='submitted')throw new Problem('В пакете есть запись, которая уже рассмотрена.',409,'state');$this->openClaim($c);if($decision==='approve')$this->readiness($c);$rows[]=$c;if($c['supersedes_id'])$replace[]=(int)$c['supersedes_id'];}
        if($decision==='approve'){
            $approved=array_filter($this->all("SELECT * FROM claims WHERE status='approved'"),fn($c)=>!in_array((int)$c['id'],$replace,true));
            $this->checkCap($this->dailyTotals([...$approved,...$rows]));
            foreach($replace as $old)$this->sql("UPDATE claims SET status='superseded',version=version+1 WHERE id=?",[$old]);
        }
        foreach($ids as $id)$this->sql('UPDATE claims SET status=?,comment=?,approved_by=?,approved_at=?,version=version+1,updated_at=? WHERE id=?',[$decision==='approve'?'approved':'returned',$comment,$decision==='approve'?$actor['name']:null,$decision==='approve'?$this->now():null,$this->now(),$id]);
        $this->audit($actor,'claim.'.$decision,['ids'=>$ids,'comment'=>$comment,'preview'=>true,'self_review_ids'=>array_values(array_map(fn($c)=>$c['id'],array_filter($rows,fn($c)=>(int)$c['author_id']===(int)$actor['id'])))]);
        return ['count'=>count($ids)];
    }
    private function cancelClaim(array $in,array $actor):array {
        $c=$this->row('claims',(int)($in['id']??0));$this->version($c,$in);$this->teacherScope($actor,(int)$c['teacher_id']);$this->openClaim($c);
        if(!in_array($c['status'],['draft','returned'],true))throw new Problem('Отменить можно черновик или возвращённую запись.');$comment=$this->text($in['comment']??'',1000);
        $this->sql("UPDATE claims SET status='cancelled',comment=?,version=version+1,updated_at=? WHERE id=?",[$comment,$this->now(),$c['id']]);$this->audit($actor,'claim.cancel',['id'=>$c['id'],'comment'=>$comment]);return ['count'=>1];
    }
    private function closeMonth(array $in,array $actor,bool $reopen):array {
        $this->permit($actor,'approver');$teacher=$this->integer($in['teacher_id']??null);$this->row('teachers',$teacher);$month=$this->text($in['month']??'',7);$this->month($month);
        if($reopen){$reason=$this->text($in['comment']??'',1000);if(!$this->all('SELECT 1 FROM closures WHERE teacher_id=? AND month=?',[$teacher,$month]))throw new Problem('Месяц уже открыт.',409,'state');$this->sql('DELETE FROM closures WHERE teacher_id=? AND month=?',[$teacher,$month]);}
        else{
            $this->open($teacher,$month);if($month>substr($this->today(),0,7))throw new Problem('Будущий месяц нельзя закрыть.');
            $pending=$this->all("SELECT c.*,o.teacher_id AS old_teacher,o.month AS old_month FROM claims c LEFT JOIN claims o ON o.id=c.supersedes_id WHERE c.status IN ('draft','submitted','returned')");
            foreach($pending as $c)if(((int)$c['teacher_id']===$teacher&&$c['month']===$month)||((int)($c['old_teacher']??0)===$teacher&&$c['old_month']===$month))throw new Problem('Завершите рассмотрение всех записей и исправлений этого месяца.',409,'pending');
            $this->sql('INSERT INTO closures(teacher_id,month,closed_at,closed_by) VALUES(?,?,?,?)',[$teacher,$month,$this->now(),$actor['name']]);$reason='';
        }$this->audit($actor,$reopen?'month.reopen':'month.close',['teacher_id'=>$teacher,'month'=>$month,'comment'=>$reason]);return ['count'=>1];
    }
    private function savePlan(array $in,array $actor):array {
        $this->permit($actor,'office','admin');$p=$this->row('plans',(int)($in['id']??0));$this->version($p,$in);$this->open((int)$p['teacher_id'],$p['month']);
        $hours=$this->integer($in['hours_cent']??null,0);$reason=$this->text($in['reason']??'',1000);
        $this->sql('UPDATE plans SET hours_cent=?,version=version+1 WHERE id=?',[$hours,$p['id']]);$r=$this->row('plans',$p['id']);$this->audit($actor,'plan.save',['before'=>$p,'after'=>$r,'reason'=>$reason]);return $r;
    }
}
