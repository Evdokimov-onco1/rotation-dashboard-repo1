<?php
declare(strict_types=1);
namespace Teaching;

final class Auth {
    public function __construct(private Service $s) {}
    public function user():?array {
        if(empty($_SESSION['uid']))return null;
        if(($_SESSION['last']??0)<time()-7200){$_SESSION=[];return null;}
        $r=$this->s->all('SELECT id,name,roles,teacher_id FROM users WHERE id=? AND active=1',[(int)$_SESSION['uid']]);
        if(!$r){$_SESSION=[];return null;}
        $_SESSION['last']=time();$u=$r[0];$u['roles']=json_decode($u['roles'],true,flags:JSON_THROW_ON_ERROR);return $u;
    }
    public function csrf():string {return $_SESSION['csrf']??=bin2hex(random_bytes(32));}
    public function checkCsrf(string $token):void {if($token===''||!hash_equals($this->csrf(),$token))throw new Problem('Сессия формы устарела. Обновите страницу.',403,'csrf');}
    public function login(array $in):array {
        $login=$in['login']??'';$password=$in['password']??'';
        if(!is_string($login)||!is_string($password)||strlen($login)>100||strlen($password)>1000)throw new Problem('Неверный логин или пароль.',401,'login');
        $login=mb_strtolower(trim($login));$ip=$_SERVER['REMOTE_ADDR']??'cli';$buckets=[hash('sha256','login|'.$login),hash('sha256','ip|'.$ip)];
        return $this->s->transaction(function()use($login,$password,$buckets){
            $db=$this->s->db();$db->prepare('DELETE FROM login_attempts WHERE at<?')->execute([time()-900]);
            foreach($buckets as $i=>$b){$count=$this->s->all('SELECT COUNT(*) n FROM login_attempts WHERE bucket=?',[$b])[0]['n'];if($count>=($i===0?8:40))return ['limited'=>true];}
            $r=$this->s->all('SELECT * FROM users WHERE login=? AND active=1',[$login]);
            // Equal-cost password verification for nonexistent and existing usernames.
            $hash=$r[0]['password_hash']??'$2y$10$1rXiGfR5mELMZ5RFQxTudeU.2tWZVMqvrJjoZslD2MevnXwWu44EG';
            if(!$r||!password_verify($password,$hash)){
                if(!$r)password_verify($password,$hash);
                foreach($buckets as $b)$db->prepare('INSERT INTO login_attempts(bucket,at) VALUES(?,?)')->execute([$b,time()]);
                return ['invalid'=>true];
            }
            foreach($buckets as $b)$db->prepare('DELETE FROM login_attempts WHERE bucket=?')->execute([$b]);
            session_regenerate_id(true);$_SESSION=['uid'=>(int)$r[0]['id'],'last'=>time(),'csrf'=>bin2hex(random_bytes(32))];
            $user=$this->user();$this->s->audit($user,'login',[]);return ['user'=>$user,'csrf'=>$this->csrf()];
        });
    }
    public function logout():array {$_SESSION=[];session_regenerate_id(true);return ['user'=>null,'csrf'=>$this->csrf()];}
}
