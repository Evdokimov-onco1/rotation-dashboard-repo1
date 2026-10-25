<?php
declare(strict_types=1);
namespace Teaching;
use DOMDocument;
use DOMElement;
use DOMXPath;
use ZipArchive;

final class Report {
    private const W='http://schemas.openxmlformats.org/wordprocessingml/2006/main';
    private const COLUMNS=['lecture','seminar','practical','practice','consultation','control','pass','exam'];
    public function __construct(private Service $s){}
    private function accessible(int $id,array $actor):array {
        $r=$this->s->row('reports',$id);
        if(!$this->s->has($actor,'office','admin','approver') && (!$this->s->has($actor,'teacher')||(int)($r['teacher_id']??0)!==(int)$actor['teacher_id']))throw new Problem('Этот отчёт недоступен.',403,'forbidden');
        return $r;
    }
    public function download(int $id,array $actor):array {
        $r=$this->accessible($id,$actor);$path=$this->s->config['private_dir'].'/reports/'.$r['filename'].'.blob';
        if(!is_file($path)||!hash_equals($r['sha256'],hash_file('sha256',$path)))throw new Problem('Файл отчёта недоступен или изменён. Создайте новую версию.',409,'report_integrity');
        return ['path'=>$path,'filename'=>$r['filename']];
    }
    public function dispatch(string $action,array $in,array $actor):array {
        if($action==='report.snapshot')return json_decode($this->accessible((int)($in['id']??0),$actor)['snapshot'],true,flags:JSON_THROW_ON_ERROR);
        if($action!=='report.create')throw new Problem('Неизвестное действие.',404);
        if(!$this->s->has($actor,'office','admin','approver','teacher'))throw new Problem('Недостаточно прав.',403);
        $month=$in['month']??'';if(!is_string($month))throw new Problem('Укажите месяц.');$this->s->month($month);
        $teacher=!empty($in['teacher_id'])?(int)$in['teacher_id']:null;$group=!empty($in['group_id'])?(string)$in['group_id']:null;
        if(!$this->s->has($actor,'office','admin','approver')){if($teacher!==null&&$teacher!==(int)$actor['teacher_id'])throw new Problem('Доступна только собственная выгрузка.',403);$teacher=(int)$actor['teacher_id'];}
        if($teacher)$this->s->row('teachers',$teacher);if($group)$this->s->row('groups',$group);
        if(!is_bool($in['draft']??null))throw new Problem('Выберите проект или закрытый отчёт.');$draft=$in['draft'];$createdFile=null;
        try{return $this->s->transaction(function()use($month,$teacher,$group,$draft,$actor,&$createdFile){
            $args=[$month];$filter='month=?';if($teacher){$filter.=' AND teacher_id=?';$args[]=$teacher;}if($group){$filter.=' AND group_id=?';$args[]=$group;}
            $claims=$this->s->all("SELECT * FROM claims WHERE status='approved' AND $filter ORDER BY teacher_id,id",$args);
            $plan=$this->s->all('SELECT * FROM plans WHERE '.$filter,$args);
            $teachers=$teacher?[$this->s->row('teachers',$teacher)]:$this->s->all('SELECT * FROM teachers ORDER BY name');
            $groups=$group?[$this->s->row('groups',$group)]:$this->s->all('SELECT * FROM groups ORDER BY course,semester,id');
            $activeGroups=array_unique(array_column([...$claims,...$plan],'group_id'));
            if(!$group&&$activeGroups)$groups=array_values(array_filter($groups,fn($g)=>in_array($g['id'],$activeGroups,true)));
            $closings=[];
            foreach($teachers as $t){$c=$this->s->all('SELECT * FROM closures WHERE teacher_id=? AND month=?',[$t['id'],$month]);if(!$draft&&!$c)throw new Problem('Для выгрузки закрытого отчёта закройте месяц каждого включённого преподавателя или выберите «Проект».',409,'unclosed_report');if($c)$closings[]=$c[0];}
            $blocks=[];$total=0;
            foreach($groups as $g){$rows=[];$totals=array_fill_keys(self::COLUMNS,0);
                foreach($teachers as $t){$hours=array_fill_keys(self::COLUMNS,0);$ids=[];
                    foreach($claims as $c)if((int)$c['teacher_id']===(int)$t['id']&&$c['group_id']===$g['id']){$column=match($c['type']){'preexam'=>'consultation','graded_pass'=>'pass','state_exam'=>'exam',default=>$c['type']};$hours[$column]+=(int)$c['hours_cent'];$ids[]=$c['id'];}
                    foreach($hours as $key=>$value)$totals[$key]+=$value;
                    $rows[]=['teacher_id'=>$t['id'],'teacher'=>$t['name'],'hours'=>$hours,'total_cent'=>array_sum($hours),'claim_ids'=>$ids];
                }$blocks[]=['group'=>$g,'rows'=>$rows,'totals'=>$totals,'total_cent'=>array_sum($totals)];$total+=array_sum($totals);
            }
            $revision=1+(int)$this->s->all('SELECT COALESCE(MAX(revision),0) n FROM reports WHERE month=?',[$month])[0]['n'];
            $snapshot=['month'=>$month,'group_id'=>$group,'teacher_id'=>$teacher,'draft'=>$draft,'preview'=>true,'created_at'=>$this->s->now(),'created_by'=>$actor['name'],'revision'=>$revision,'norm_version'=>'preview-1','template_sha256'=>hash_file('sha256',$this->s->config['template']),'blocks'=>$blocks,'total_cent'=>$total,'claims'=>$claims,'closures'=>$closings];
            $filename='nagruzka-'.$month.'-r'.$revision.'-'.bin2hex(random_bytes(4)).'.docx';
            $this->s->db()->prepare('INSERT INTO reports(month,group_id,teacher_id,created_by,created_at,revision,draft,filename,snapshot) VALUES(?,?,?,?,?,?,?,?,?)')->execute([$month,$group,$teacher,$actor['id'],$this->s->now(),$revision,$draft?1:0,$filename,json_encode($snapshot,JSON_UNESCAPED_UNICODE|JSON_THROW_ON_ERROR)]);
            $id=(int)$this->s->db()->lastInsertId();$dir=$this->s->config['private_dir'].'/reports';if(!is_dir($dir))mkdir($dir,0700,true);$createdFile=$dir.'/'.$filename.'.blob';
            $this->render($snapshot,$createdFile);chmod($createdFile,0600);$sha=hash_file('sha256',$createdFile);
            $this->s->db()->prepare('UPDATE reports SET sha256=? WHERE id=?')->execute([$sha,$id]);
            $this->s->audit($actor,'report.create',['id'=>$id,'sha256'=>$sha,'total_cent'=>$total,'draft'=>$draft,'preview'=>true]);
            return ['id'=>$id,'filename'=>$filename];
        });}catch(\Throwable $e){if($createdFile&&is_file($createdFile))unlink($createdFile);throw $e;}
    }
    private function setText(DOMElement $parent,string $value,DOMXPath $xp):void {
        $doc=$parent->ownerDocument;$p=$parent->localName==='p'?$parent:$xp->query('./w:p',$parent)->item(0);
        if(!$p){$p=$doc->createElementNS(self::W,'w:p');$parent->appendChild($p);}
        $rPr=$xp->query('./w:r/w:rPr',$p)->item(0)?->cloneNode(true);
        foreach(iterator_to_array($p->childNodes) as $node)if(!($node instanceof DOMElement&&$node->localName==='pPr'))$p->removeChild($node);
        $r=$doc->createElementNS(self::W,'w:r');if($rPr)$r->appendChild($rPr);$t=$doc->createElementNS(self::W,'w:t');$t->setAttribute('xml:space','preserve');$t->appendChild($doc->createTextNode($value));$r->appendChild($t);$p->appendChild($r);
        if($parent!==$p)foreach(iterator_to_array($parent->childNodes) as $node)if($node instanceof DOMElement&&$node->localName==='p'&&$node!==$p)$parent->removeChild($node);
    }
    public function render(array $snapshot,string $dest):void {
        if(!copy($this->s->config['template'],$dest))throw new Problem('Не удалось подготовить бланк.',500);
        $z=new ZipArchive();if($z->open($dest)!==true)throw new Problem('Не удалось открыть бланк.',500);$doc=new DOMDocument();$doc->loadXML($z->getFromName('word/document.xml'),LIBXML_NONET);$xp=new DOMXPath($doc);$xp->registerNamespace('w',self::W);
        $body=$xp->query('//w:body')->item(0);$paragraphs=$xp->query('./w:p',$body);
        $names=['01'=>'январь','02'=>'февраль','03'=>'март','04'=>'апрель','05'=>'май','06'=>'июнь','07'=>'июль','08'=>'август','09'=>'сентябрь','10'=>'октябрь','11'=>'ноябрь','12'=>'декабрь'];
        $period=$names[substr($snapshot['month'],5,2)].' '.substr($snapshot['month'],0,4).' г.';
        $this->setText($paragraphs->item(1),'Период: '.$period,$xp);$this->setText($paragraphs->item(3),'Ординатура по специальности 31.08.57 «Онкология»',$xp);
        $note=$doc->createElementNS(self::W,'w:p');$this->setText($note,'ПРОЕКТ · ТЕСТОВАЯ ВЕРСИЯ · не является утверждённым отчётом. Версия '.$snapshot['revision'].', '.$snapshot['created_at'].'. Только подтверждённые записи.',$xp);$body->insertBefore($note,$paragraphs->item(2));
        $template=$xp->query('./w:tbl',$body)->item(0);if(!$template)throw new Problem('В бланке не найдена таблица.',500);
        $tr=$xp->query('./w:tr',$template);$head=$tr->item(0)->cloneNode(true);$semester=$tr->item(1)->cloneNode(true);$line=$tr->item(2)->cloneNode(true);$totalLine=$tr->item($tr->length-1)->cloneNode(true);
        foreach($snapshot['blocks'] as $blockIndex=>$block){
            if($blockIndex>0){
                $heading=$doc->createElementNS(self::W,'w:p');$ppr=$doc->createElementNS(self::W,'w:pPr');
                $ppr->appendChild($doc->createElementNS(self::W,'w:pageBreakBefore'));$ppr->appendChild($doc->createElementNS(self::W,'w:keepNext'));$heading->appendChild($ppr);
                $this->setText($heading,'Период: '.$period.' · ПРОЕКТ · Учёт учебной нагрузки ППС',$xp);$body->insertBefore($heading,$template);
            }
            $table=$template->cloneNode(true);foreach(iterator_to_array($xp->query('./w:tr',$table)) as $n)$table->removeChild($n);
            $header=$head->cloneNode(true);$pr=$xp->query('./w:trPr',$header)->item(0);if(!$pr){$pr=$doc->createElementNS(self::W,'w:trPr');$header->insertBefore($pr,$header->firstChild);}$pr->appendChild($doc->createElementNS(self::W,'w:tblHeader'));$table->appendChild($header);
            $sem=$semester->cloneNode(true);$this->setText($xp->query('./w:tc',$sem)->item(0),'ординаторы '.$block['group']['course'].' года обучения (семестр '.$block['group']['semester'].') · '.$block['group']['label'],$xp);$table->appendChild($sem);
            foreach($block['rows'] as $i=>$row){$r=$line->cloneNode(true);$cells=$xp->query('./w:tc',$r);$values=[($i+1).'.',$row['teacher']];foreach(self::COLUMNS as $col)$values[]=Rules::format($row['hours'][$col]);$values[]=Rules::format($row['total_cent']);foreach($values as $j=>$v)$this->setText($cells->item($j),$v,$xp);$table->appendChild($r);}
            $r=$totalLine->cloneNode(true);$cells=$xp->query('./w:tc',$r);$values=['Всего (по типам занятий)'];foreach(self::COLUMNS as $col)$values[]=Rules::format($block['totals'][$col]);$values[]=Rules::format($block['total_cent']);foreach($values as $j=>$v)$this->setText($cells->item($j),$v,$xp);$table->appendChild($r);
            foreach($xp->query('./w:tr',$table) as $tableRow){$rowPr=$xp->query('./w:trPr',$tableRow)->item(0);if(!$rowPr){$rowPr=$doc->createElementNS(self::W,'w:trPr');$tableRow->insertBefore($rowPr,$tableRow->firstChild);}$rowPr->appendChild($doc->createElementNS(self::W,'w:cantSplit'));}
            $body->insertBefore($table,$template);$body->insertBefore($doc->createElementNS(self::W,'w:p'),$template);
        }$body->removeChild($template);
        $z->addFromString('word/document.xml',$doc->saveXML());$z->close();
    }
}
