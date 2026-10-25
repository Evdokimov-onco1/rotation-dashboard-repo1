<?php
declare(strict_types=1);
require __DIR__.'/../backend/Service.php';require __DIR__.'/../backend/Workbook.php';
use Teaching\Service;use Teaching\Workbook;use Teaching\Problem;
$dir=sys_get_temp_dir().'/teaching-import-'.bin2hex(random_bytes(6));mkdir($dir,0700,true);$s=new Service(['private_dir'=>$dir]);$s->db()->exec("INSERT INTO teachers(id,name) VALUES(1,'Преподаватель А'); INSERT INTO groups(id,course,semester,label) VALUES('c1s1g1',1,1,'Группа 1')");
$actor=['id'=>1,'name'=>'Учебная часть','roles'=>['office'],'teacher_id'=>null];$w=new Workbook($s);$checks=0;
function ok(bool $v,string $label):void {global $checks;$checks++;if(!$v)throw new RuntimeException($label);}
function rejects(callable $f,string $label):void {try{$f();}catch(Problem){ok(true,$label);return;}ok(false,$label);}
function fixture(string $path,string $name='Преподаватель А',bool $missingCache=false,string $quantity='2',string $discipline='Дисциплина'):void {
 $z=new ZipArchive();$z->open($path,ZipArchive::CREATE|ZipArchive::OVERWRITE);
 $z->addFromString('xl/workbook.xml','<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Расчет учебной нагрузки" sheetId="1" r:id="r1"/></sheets></workbook>');
 $z->addFromString('xl/_rels/workbook.xml.rels','<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="r1" Target="worksheets/sheet1.xml"/></Relationships>');
 $cells=['A'=>'1','C'=>$discipline,'D'=>'1','E'=>'1','F'=>'1','H'=>'Лекции','K'=>$name,'L'=>$quantity,'P'=>$quantity];$xml='';
 foreach($cells as $col=>$value){$v=htmlspecialchars($value,ENT_XML1);$xml.='<c r="'.$col.'15"'.(ctype_digit($value)?'><v>'.$v.'</v>':' t="inlineStr"><is><t>'.$v.'</t></is>').'</c>';}
 if($missingCache)$xml.='<c r="Q15"><f>1+1</f></c>';
 $z->addFromString('xl/worksheets/sheet1.xml','<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="15">'.$xml.'</row></sheetData></worksheet>');$z->close();
}
$path=$dir.'/input.xlsx';fixture($path,'Преподаватель А (ст.преподаватель)');$p=$w->preview($path,'input.xlsx',$actor);ok($p['rows']===1&&$p['total_cent']===200&&!$p['errors'],'preview totals');ok(count($s->all('SELECT * FROM plans'))===0,'preview does not mutate plan');$w->commit(['token'=>$p['token']],$actor);ok(count($s->all('SELECT * FROM plans'))===1,'commit one row');ok(count($s->all('SELECT * FROM claims'))===0,'plan never becomes fact');rejects(fn()=>$w->commit(['token'=>$p['token']],$actor),'duplicate commit');$p=$w->preview($path,'input.xlsx',$actor);ok($p['duplicate'],'duplicate file detected');
fixture($path,'Неизвестный');$p=$w->preview($path,'input.xlsx',$actor);ok(count($p['errors'])===1,'unknown teacher visible');rejects(fn()=>$w->commit(['token'=>$p['token']],$actor),'invalid import atomic');
fixture($path,'Преподаватель А',true);$p=$w->preview($path,'input.xlsx',$actor);ok(str_contains($p['errors'][0],'Формулы'),'missing cached formula blocked');
fixture($path);$z=new ZipArchive();$z->open($path);$xml=$z->getFromName('xl/worksheets/sheet1.xml');$xml=str_replace('</sheetData>','<row r="16"><c r="A16"><v>2</v></c><c r="C16" t="inlineStr"><is><t>Другая дисциплина</t></is></c><c r="L16"><v>8</v></c><c r="P16"><v>8</v></c></row></sheetData>',$xml);$z->addFromString('xl/worksheets/sheet1.xml',$xml);$z->close();$p=$w->preview($path,'input.xlsx',$actor);ok(count($p['errors'])===1&&str_contains($p['errors'][0],'преподаватель'),'loaded row without teacher cannot silently disappear');
ok(Workbook::cents('0.59999999999999998')===60,'cached decimal artifact rounds exactly');
rejects(fn()=>$w->preview($path,'input.xlsx',['id'=>2,'name'=>'Teacher','roles'=>['teacher'],'teacher_id'=>1]),'teacher cannot import');
foreach(['0,5','invalid'] as $quantity){fixture($path,'',false,$quantity,'');$p=$w->preview($path,'input.xlsx',$actor);ok($p['rows']===1&&str_contains($p['errors'][0],'преподаватель'),'nonzero or invalid numeric text cannot disappear');}
fixture($path,'',true,'0','');$p=$w->preview($path,'input.xlsx',$actor);ok($p['rows']===1&&$p['errors'],'uncached formula is not a blank placeholder');
$original=$s->all('SELECT original_path,sha256 FROM imports LIMIT 1')[0];ok(str_ends_with($original['original_path'],'.blob')&&hash_file('sha256',$original['original_path'])===$original['sha256'],'private archive uses opaque extension and preserves exact bytes');
echo "Import: $checks checks passed\n";
