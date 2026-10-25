"""Local test credentials only. Never run this suite against the production rotation API."""
import urllib.request, urllib.error, http.cookiejar, json

BASE='http://127.0.0.1:8317/api.php?action='
jar=http.cookiejar.CookieJar(); client=urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar))
def request(action, data=None, csrf=None):
    req=urllib.request.Request(BASE+action, data=None if data is None else json.dumps(data).encode(), headers={'Content-Type':'application/json',**({'X-CSRF-Token':csrf} if csrf else {})})
    try:
        res=client.open(req); return res.status,json.loads(res.read())
    except urllib.error.HTTPError as e:
        return e.code,json.loads(e.read())

status,r=request('bootstrap'); assert status==200 and r['data']['user'] is None
csrf=r['data']['csrf']; assert len(csrf)==64
status,_=request('login',{'login':'review','password':'local-test-password-2026'});assert status==403
status,r=request('login',{'login':'review','password':'bad'},csrf);assert status==401
status,r=request('login',{'login':'review','password':'local-test-password-2026'},csrf);assert status==200
status,r=request('bootstrap');csrf=r['data']['csrf'];data=r['data'];assert sum(x['hours_cent'] for x in data['plans'])==147900 and data['claims']==[]
assert all(c.name=='TEACHINGPREVIEWSESS' for c in jar)
status,_=request('report.create',{'month':'2026-10','teacher_id':2,'group_id':'c1s1g1','draft':True},csrf);assert status==200
status,_=request('logout',{},csrf);assert status==200
status,r=request('bootstrap');csrf=r['data']['csrf'];assert r['data']['user'] is None
status,_=request('report.download&id=1');assert status==401
status,_=request('login',{'login':'teacher','password':'local-test-password-2026'},csrf);assert status==200
status,r=request('bootstrap');csrf=r['data']['csrf'];assert all(p['teacher_id']==2 for p in r['data']['plans'])
status,_=request('claim.save',{'teacher_id':1,'group_id':'c1s1g1','type':'practical','month':'2026-10','quantity':'4','discipline':'test','notes':''},csrf);assert status==403
status,_=request('month.close',{'teacher_id':2,'month':'2026-10'},csrf);assert status==403
status,_=request('plan.save',{'id':1,'version':1,'hours_cent':100,'reason':'test'},csrf);assert status==403
status,_=request('report.snapshot&id=1');assert status==200
status,_=request('logout',{},csrf);assert status==200
print('HTTP: auth, CSRF, cookie separation, 1479h plan/zero fact, export and teacher access passed')
