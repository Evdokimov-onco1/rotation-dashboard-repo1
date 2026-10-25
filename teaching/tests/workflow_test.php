<?php
declare(strict_types=1);
require __DIR__.'/../backend/Service.php';

use Teaching\Service;
use Teaching\Problem;

$root=sys_get_temp_dir().'/teaching-test-'.bin2hex(random_bytes(5));
mkdir($root,0700,true);
$s=new Service(['private_dir'=>$root,'today'=>'2026-10-25','template'=>__DIR__.'/../templates/workload-blank.docx']);
$db=$s->db();
$db->exec("INSERT INTO teachers(id,name,rate) VALUES(1,'Преподаватель А','0.25'),(2,'Преподаватель Б','0.1'); INSERT INTO groups(id,course,semester,label) VALUES('c1s1g1',1,1,'1 курс · 1 семестр · группа 1')");
$office=['id'=>1,'name'=>'Учебная часть','roles'=>['office'],'teacher_id'=>null];
$approver=['id'=>2,'name'=>'Подтверждающий','roles'=>['approver'],'teacher_id'=>null];
$teacher=['id'=>3,'name'=>'Преподаватель А','roles'=>['teacher'],'teacher_id'=>1];
$n=0;
function check(bool $value,string $name):void {global $n;$n++;if(!$value)throw new RuntimeException("FAIL: $name");}
function denied(callable $fn,string $name):void {try{$fn();}catch(Problem|InvalidArgumentException $e){check(true,$name);return;}check(false,$name);}
function act(string $name,array $input=[],?array $who=null):array {global $s,$office;if(in_array($name,['claim.submit','claim.review'],true)&&!isset($input['versions'])){$input['versions']=[];foreach($input['ids']??[] as $id){$rows=$s->all('SELECT version FROM claims WHERE id=?',[$id]);$input['versions'][$id]=$rows[0]['version']??1;}}return $s->dispatch($name,$input,$who??$office);}
function claim(array $extra=[],?array $who=null):array {return act('claim.save',array_merge(['teacher_id'=>1,'group_id'=>'c1s1g1','type'=>'practical','month'=>'2026-10','quantity'=>'4','discipline'=>'Учебная дисциплина','notes'=>'Проведено'], $extra),$who);}
function approve(array $ids):array {global $approver;act('claim.submit',['ids'=>$ids]);return act('claim.review',['ids'=>$ids,'decision'=>'approve','comment'=>'Проверено'],$approver);}

check(count($s->snapshot($office)['claims'])===0,'initial fact zero');
denied(fn()=>claim(['teacher_id'=>2],$teacher),'teacher cannot enter another teacher');
denied(fn()=>act('claim.review',['ids'=>[1],'decision'=>'approve'],$office),'office cannot approve');
denied(fn()=>claim(['group_id'=>'missing']),'unknown group');
denied(fn()=>claim(['month'=>'2026-08']),'outside year');
denied(fn()=>claim(['type'=>'exam','date'=>'2026-02-31']),'invalid actual date');
$c=claim([], $teacher);
check($c['hours_cent']===400 && $c['status']==='draft','monthly practical draft');
denied(fn()=>act('claim.save',array_merge($c,['version'=>0,'quantity'=>'5']),$teacher),'stale edit');
denied(fn()=>act('claim.submit',['ids'=>[$c['id']],'versions'=>[$c['id']=>0]],$teacher),'stale batch submit');
act('claim.submit',['ids'=>[$c['id']]],$teacher);
denied(fn()=>act('claim.review',['ids'=>[$c['id']],'versions'=>[$c['id']=>$c['version']],'decision'=>'approve'],$approver),'stale batch review');
denied(fn()=>act('claim.save',array_merge($c,['quantity'=>'5']),$teacher),'submitted immutable');
act('claim.review',['ids'=>[$c['id']],'decision'=>'return','comment'=>'Уточнить объём'],$approver);
$c=$s->row('claims',$c['id']);
$c=act('claim.save',array_merge($c,['quantity'=>'4']),$teacher);
approve([$c['id']]);
$old=$s->row('claims',$c['id']);
$fix=act('claim.correct',['id'=>$old['id'],'version'=>$old['version']],$teacher);
$fix=act('claim.save',array_merge($fix,['quantity'=>'6']),$teacher);
check($s->metrics($office,'2026-10',1)['confirmed_cent']===400,'pending correction preserves confirmed');
check($s->metrics($office,'2026-10',1)['claimed_cent']===600,'pending correction not double counted');
denied(fn()=>act('month.close',['teacher_id'=>1,'month'=>'2026-10'],$approver),'correction blocks closure');
approve([$fix['id']]);
check($s->metrics($office,'2026-10',1)['confirmed_cent']===600,'accepted correction replaces original');
check($s->row('claims',$old['id'])['status']==='superseded','old revision retained');
act('month.close',['teacher_id'=>1,'month'=>'2026-10'],$approver);
denied(fn()=>claim(),'closed month prevents new claim');
denied(fn()=>act('month.reopen',['teacher_id'=>1,'month'=>'2026-10','comment'=>''],$approver),'reopen reason required');
act('month.reopen',['teacher_id'=>1,'month'=>'2026-10','comment'=>'Тест исправления'],$approver);

$exam=claim(['type'=>'exam','date'=>'2026-10-15','quantity'=>'15']);approve([$exam['id']]);
$exam=$s->row('claims',$exam['id']);
$down=act('claim.correct',['id'=>$exam['id'],'version'=>$exam['version']]);
$down=act('claim.save',array_merge($down,['quantity'=>'10']));
act('claim.submit',['ids'=>[$down['id']]]);
$extra=claim(['type'=>'pass','date'=>'2026-10-15','quantity'=>'10']);
denied(fn()=>act('claim.submit',['ids'=>[$extra['id']]]),'pending decrease cannot free submission cap');
// A combined transaction can exchange the six hours for four plus two.
// Simulate an already submitted item from a concurrent legacy queue; approval must still enforce cap.
$db->prepare("UPDATE claims SET status='submitted' WHERE id=?")->execute([$extra['id']]);
denied(fn()=>act('claim.review',['ids'=>[$extra['id']],'decision'=>'approve','comment'=>''],$approver),'approval excludes other pending decreases');
act('claim.review',['ids'=>[$down['id'],$extra['id']],'decision'=>'approve','comment'=>'Одной группой'],$approver);
check($s->row('claims',$down['id'])['status']==='approved','atomic correction and addition cap');
$future=claim(['type'=>'exam','date'=>'2026-10-30','quantity'=>'1']);
denied(fn()=>act('claim.submit',['ids'=>[$future['id']]]),'future fact cannot submit');
act('claim.cancel',['id'=>$future['id'],'version'=>$future['version'],'comment'=>'Тест']);

$e=act('event.save',['type'=>'lecture','title'=>'Тема лекции','teacher_id'=>1,'group_id'=>'c1s1g1','date'=>'2026-10-20','start'=>'09:00','end'=>'10:30','hours_cent'=>200,'room'=>'101']);
denied(fn()=>act('event.save',array_merge($e,['id'=>null,'teacher_id'=>2])),'group/room clash');
denied(fn()=>act('event.save',array_merge($e,['id'=>null,'type'=>'practical'])),'no practical calendar');
denied(fn()=>claim(['type'=>'lecture','date'=>'2026-10-20','event_id'=>$e['id'],'quantity'=>'2']),'unpublished event cannot be claimed');
$e=act('event.publish',['id'=>$e['id'],'version'=>$e['version']]);
$ec=claim(['type'=>'lecture','date'=>'2026-10-20','event_id'=>$e['id'],'quantity'=>'2']);
denied(fn()=>claim(['type'=>'lecture','date'=>'2026-10-20','event_id'=>$e['id'],'quantity'=>'2']),'no event double claim');
denied(fn()=>act('event.save',array_merge($e,['date'=>'2026-10-21'])),'reported event cannot silently move');
approve([$ec['id']]);
denied(fn()=>act('claim.review',['ids'=>[$ec['id']],'decision'=>'approve','comment'=>''],$approver),'no repeat approval');

// A moved correction locks both original and destination scopes until resolved.
$ec=$s->row('claims',$fix['id']);
$cross=act('claim.correct',['id'=>$ec['id'],'version'=>$ec['version']]);
$cross=act('claim.save',array_merge($cross,['teacher_id'=>2,'month'=>'2026-09','quantity'=>'6']));
check($s->metrics($teacher,'2026-10',1)['claimed_cent']===800,'moved correction excluded from old teacher claimed');
$teacher2=['id'=>4,'name'=>'Преподаватель Б','roles'=>['teacher'],'teacher_id'=>2];
check($s->metrics($teacher2,'2026-09',2)['claimed_cent']===600,'new teacher sees only own moved claim');
act('claim.submit',['ids'=>[$cross['id']]]);
act('claim.review',['ids'=>[$cross['id']],'decision'=>'return','comment'=>'Проверить перенос'],$approver);
check($s->metrics($teacher2,'2026-09',2)['claimed_cent']===0,'returned moved correction excluded without exposing original');
check($s->metrics($teacher,'2026-10',1)['claimed_cent']===1400,'old teacher restored after return');
$cross=$s->row('claims',$cross['id']);
denied(fn()=>act('month.close',['teacher_id'=>1,'month'=>'2026-10'],$approver),'old correction scope locked');
denied(fn()=>act('month.close',['teacher_id'=>2,'month'=>'2026-09'],$approver),'new correction scope locked');
act('claim.cancel',['id'=>$cross['id'],'version'=>$cross['version'],'comment'=>'Отменить перенос']);
check($s->row('claims',$ec['id'])['status']==='approved','cancel correction preserves approved');
denied(fn()=>act('claim.submit',['ids'=>[$ec['id'],9999]]),'batch transition all or nothing');
check($s->row('claims',$ec['id'])['status']==='approved','failed batch unchanged');
check(count(array_filter($s->snapshot($teacher)['claims'],fn($c)=>$c['teacher_id']!==1))===0,'teacher rows remain private');
$unrelated=claim(['teacher_id'=>2,'quantity'=>'1']);
check(!in_array($unrelated['id'],array_column($s->snapshot($teacher)['claims'],'id'),true),'unrelated teacher data excluded');
check(count($s->snapshot($office)['audit'])>15,'audit records transitions');
echo "Workflow: $n checks passed\n";
