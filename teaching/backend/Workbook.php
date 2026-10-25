<?php
declare(strict_types=1);
namespace Teaching;
use ZipArchive;
use DOMDocument;
use DOMXPath;

final class Workbook {
    private const NS='http://schemas.openxmlformats.org/spreadsheetml/2006/main';
    private const MAP=[
        'Лекции'=>'lecture','Семинары'=>'seminar','Практические занятия'=>'practical',
        'Проведение консультаций по дисциплинам'=>'consultation','Проведение консультаций перед экзаменами'=>'preexam',
        'Контроль самостоятельной работы'=>'control','Прием экзамена по дисциплине'=>'exam','Прием зачета по дисциплине'=>'pass',
        'Прием государственного экзамена'=>'state_exam','Прием зачета по практике'=>'pass','Прием зачета с оценкой по практике'=>'graded_pass',
        'Руководство производственной (клинической) практикой (включая проверку отчетов и написание отзыва)'=>'practice'];
    public function __construct(private Service $s){}
    private function xml(string $xml):DOMDocument {
        if(strlen($xml)>16000000||preg_match('/<!DOCTYPE|<!ENTITY/i',$xml))throw new Problem('Небезопасная XML-структура файла.');
        $d=new DOMDocument();$prior=libxml_use_internal_errors(true);$ok=$d->loadXML($xml,LIBXML_NONET);libxml_clear_errors();libxml_use_internal_errors($prior);if(!$ok)throw new Problem('Некорректная структура XLSX.');return $d;
    }
    private function xp(DOMDocument $d):DOMXPath {$x=new DOMXPath($d);$x->registerNamespace('s',self::NS);return $x;}
    private function norm(string $value):string {return preg_replace('/\s+/u',' ',trim(str_replace("\u{00A0}",' ',$value)));}
    public static function cents(string $v):int {
        $v=trim(str_replace(',','.',$v));if($v==='')return 0;
        if(!preg_match('/^\d{1,7}(?:\.\d{1,17})?$/D',$v))throw new Problem('Некорректное числовое значение в XLSX: '.$v);
        [$a,$b]=array_pad(explode('.',$v),2,'');$b=str_pad($b,3,'0');return (int)$a*100+(int)substr($b,0,2)+((int)$b[2]>=5?1:0);
    }
    public function parse(string $path):array {
        if(filesize($path)>10*1024*1024)throw new Problem('Размер XLSX превышает 10 МБ.',413);
        $z=new ZipArchive();if($z->open($path)!==true)throw new Problem('Ожидается книга XLSX.');
        try{
            if($z->numFiles>3000)throw new Problem('Слишком много элементов в книге.');$size=0;
            for($i=0;$i<$z->numFiles;$i++){$stat=$z->statIndex($i);$size+=$stat['size'];if($stat['size']>16000000||$size>80000000)throw new Problem('Слишком большой распакованный файл.');if(preg_match('/vbaProject|externalLinks/i',$stat['name']))throw new Problem('Макросы и внешние связи в импорте не поддерживаются.');}
            $book=$z->getFromName('xl/workbook.xml');$rels=$z->getFromName('xl/_rels/workbook.xml.rels');if($book===false||$rels===false)throw new Problem('Не найдена структура книги XLSX.');
            $b=$this->xp($this->xml($book));$id='';foreach($b->query('//s:sheet') as $sheet)if($sheet->getAttribute('name')==='Расчет учебной нагрузки')$id=$sheet->getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships','id');
            if($id==='')throw new Problem('Не найден лист «Расчет учебной нагрузки». Используйте исходную структуру книги.');
            $r=$this->xml($rels);$target='';foreach($r->documentElement->childNodes as $rel)if($rel instanceof \DOMElement&&$rel->getAttribute('Id')===$id){if($rel->getAttribute('TargetMode')==='External')throw new Problem('Внешний лист запрещён.');$target=$rel->getAttribute('Target');}
            $target=ltrim($target,'/');if(str_starts_with($target,'xl/'))$target=substr($target,3);if(!preg_match('~^worksheets/[^/]+\.xml$~D',$target))throw new Problem('Недопустимый путь листа.');
            $sheetXml=$z->getFromName('xl/'.$target);if($sheetXml===false)throw new Problem('Не найден файл листа.');
            $strings=[];$raw=$z->getFromName('xl/sharedStrings.xml');if($raw!==false){$sx=$this->xp($this->xml($raw));foreach($sx->query('//s:si') as $si){$text='';foreach($sx->query('.//s:t',$si) as $t)$text.=$t->textContent;$strings[]=$text;}}
            $teachers=[];foreach($this->s->all('SELECT id,name FROM teachers') as $t)$teachers[$this->norm($t['name'])]=(int)$t['id'];
            $groups=array_column($this->s->all('SELECT id FROM groups'),'id');$x=$this->xp($this->xml($sheetXml));$plans=[];$errors=[];$sourceRows=0;$total=0;$monthly=array_fill_keys($this->s->months(),0);
            foreach($x->query('//s:sheetData/s:row') as $row){
                $cells=[];$formulas=[];foreach($x->query('./s:c',$row) as $c){$ref=$c->getAttribute('r');$col=preg_replace('/\d/','',$ref);$v=$x->query('./s:v',$c)->item(0)?->textContent;
                    if($c->getAttribute('t')==='s')$v=$strings[(int)$v]??'';elseif($c->getAttribute('t')==='inlineStr'){$v='';foreach($x->query('./s:is//s:t',$c) as $t)$v.=$t->textContent;}
                    $cells[$col]=$v??'';if($x->query('./s:f',$c)->length&&$v===null)$formulas[]=$col;
                }
                if(!ctype_digit((string)($cells['A']??'')))continue;
                $hasHours=array_filter(array_intersect_key($cells,array_flip(['L',...range('P','Z')])),fn($v)=>trim($v)!==''&&!preg_match('/^[+-]?0+(?:[.,]0+)?$/D',trim($v)));
                if(trim($cells['K']??'')===''&&trim($cells['C']??'')===''&&!$hasHours&&!$formulas)continue;
                $sourceRows++;$rn=$row->getAttribute('r');
                try{
                    if(trim($cells['K']??'')==='')throw new Problem('Не указан преподаватель в строке нагрузки.');
                    if($formulas)throw new Problem('Формулы без сохранённого результата: '.implode(', ',$formulas).'. Пересчитайте книгу в Excel.');
                    $name=$this->norm($cells['K']);
                    // The supplied template appends these two known job titles to the exact name.
                    // Never use fuzzy surname matching: any other suffix remains an explicit error.
                    $name=preg_replace('/\s*\((?:ст\.\s*)?преподаватель\)$/u','',$name);
                    if(!isset($teachers[$name]))throw new Problem('Неизвестный преподаватель: '.$name);
                    $type=self::MAP[$this->norm($cells['H']??'')]??null;if(!$type)throw new Problem('Неизвестный вид работы: '.($cells['H']??''));
                    $course=$cells['D']??'';$semester=$cells['E']??'';$group=$cells['F']??'';
                    if(!ctype_digit($course)||!ctype_digit($semester)||!ctype_digit($group))throw new Problem('Не заполнены курс, семестр или группа.');
                    $gid="c{$course}s{$semester}g{$group}";if(!in_array($gid,$groups,true))throw new Problem('Неизвестная учебная группа: '.$gid);
                    $discipline=$this->norm($cells['C']??'');if($discipline==='')throw new Problem('Не заполнена дисциплина.');
                    $expected=self::cents($cells['L']??'');$sum=0;$rowPlans=[];
                    foreach($this->s->months() as $i=>$month){$col=chr(ord('P')+$i);$hours=self::cents($cells[$col]??'');$sum+=$hours;if($hours>0)$rowPlans[]=['teacher_id'=>$teachers[$name],'group_id'=>$gid,'discipline'=>$discipline,'month'=>$month,'type'=>$type,'hours_cent'=>$hours,'source'=>'Расчет учебной нагрузки!'.$col.$rn];}
                    if($sum!==$expected)throw new Problem('Месячная сумма '.Rules::format($sum).' не совпала с годовой '.Rules::format($expected).'.');
                    foreach($rowPlans as $p){$plans[]=$p;$monthly[$p['month']]+=$p['hours_cent'];}$total+=$sum;
                }catch(Problem $e){$errors[]='Строка '.$rn.': '.$e->getMessage();}
            }
            if($sourceRows===0)$errors[]='Не найдены строки нагрузки.';
            return ['rows'=>$sourceRows,'total_cent'=>$total,'plans'=>$plans,'teachers'=>array_keys($teachers),'monthly'=>array_map(fn($m,$h)=>['month'=>$m,'hours_cent'=>$h],array_keys($monthly),array_values($monthly)),'warnings'=>['Все месяцы, включая колонки «фактически», импортируются как предварительный план. Факт не создаётся.'],'errors'=>$errors];
        }finally{$z->close();}
    }
    public function preview(string $path,string $filename,array $actor):array {
        if(!$this->s->has($actor,'office','admin'))throw new Problem('Импорт доступен учебной части.',403);
        if(mb_strtolower(pathinfo($filename,PATHINFO_EXTENSION))!=='xlsx')throw new Problem('Выберите файл XLSX.');
        $result=$this->parse($path);$sha=hash_file('sha256',$path);$token=bin2hex(random_bytes(20));$dir=$this->s->config['private_dir'].'/imports';if(!is_dir($dir))mkdir($dir,0700,true);$dest=$dir.'/'.$token.'.blob';
        if(!copy($path,$dest))throw new Problem('Не удалось сохранить источник.',500);chmod($dest,0600);
        $result['duplicate']=(bool)$this->s->all('SELECT 1 FROM imports WHERE sha256=? AND committed_at IS NOT NULL',[$sha]);
        $result['filename']=mb_substr(basename($filename),0,200);$result['token']=$token;
        $this->s->db()->prepare('INSERT INTO imports(token,filename,sha256,payload,created_at,original_path) VALUES(?,?,?,?,?,?)')->execute([$token,$result['filename'],$sha,json_encode($result,JSON_UNESCAPED_UNICODE|JSON_THROW_ON_ERROR),$this->s->now(),$dest]);
        $visible=$result;unset($visible['plans']);return $visible;
    }
    public function commit(array $in,array $actor):array {
        if(!$this->s->has($actor,'office','admin'))throw new Problem('Импорт доступен учебной части.',403);
        if(!is_string($in['token']??null))throw new Problem('Выберите проверенный файл.');
        return $this->s->transaction(function()use($in,$actor){
            $r=$this->s->all('SELECT * FROM imports WHERE token=?',[$in['token']]);if(!$r)throw new Problem('Предпросмотр не найден.',404);$r=$r[0];$p=json_decode($r['payload'],true,flags:JSON_THROW_ON_ERROR);
            if($p['errors'])throw new Problem('Исправьте ошибки книги перед импортом.');
            if($r['committed_at']||$this->s->all('SELECT 1 FROM imports WHERE sha256=? AND committed_at IS NOT NULL',[$r['sha256']]))throw new Problem('Этот файл уже импортирован. Повторный импорт не создаёт дубликаты.',409,'duplicate');
            if($this->s->all('SELECT 1 FROM plans LIMIT 1'))throw new Problem('План уже загружен. В тестовой версии изменения вносятся в строки с причиной, повторная замена года отключена.',409,'existing_plan');
            foreach($p['plans'] as $row)$this->s->db()->prepare('INSERT INTO plans(teacher_id,group_id,discipline,month,type,hours_cent,source) VALUES(?,?,?,?,?,?,?)')->execute(array_values($row));
            $this->s->db()->prepare('UPDATE imports SET committed_at=? WHERE token=?')->execute([$this->s->now(),$in['token']]);
            $this->s->audit($actor,'import.commit',['filename'=>$r['filename'],'sha256'=>$r['sha256'],'source_rows'=>$p['rows'],'plan_rows'=>count($p['plans']),'total_cent'=>$p['total_cent']]);
            return ['filename'=>$r['filename'],'rows'=>$p['rows'],'total_cent'=>$p['total_cent'],'created_at'=>$this->s->now()];
        });
    }
}
