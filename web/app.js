'use strict';
const $ = id => document.getElementById(id);
const safe = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const won = n => Number(n).toLocaleString('ko-KR')+'원';
const kdate = () => new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Seoul'}).format(new Date());
const kinds = ['점심','저녁','야간'];
const tabs = {직원:['식사 신청','통근 신청','내 정산'],영양사:['조리 현황','식단 등록'],관리자:['운영 현황','식단 등록','통근 운영','월 정산','운영 설정','직원 관리']};
let rangeStart='', rangeEnd='';
let db, data, role='직원', tab='', busy=false, seq=0, timer;
const today=kdate();
$('day').value=today; $('month').value=today.slice(0,7);
function say(msg){ clearTimeout(timer); $('message').textContent=msg; timer=setTimeout(()=>$('message').textContent='',6500); }
function error(e){say(e.message || String(e));}
function config(){
 const {url,key}=window.FOODJOB;
 if(!url||!key)throw Error('설치 담당자가 config.js에 프로젝트 URL과 공개 키를 입력해야 합니다.');
 if(!url.startsWith('https://') || !(key.startsWith('sb_publishable_') || (key.startsWith('ey') && JSON.parse(atob(key.split('.')[1].replace(/-/g,'+').replace(/_/g,'/'))).role==='anon')))throw Error('프로젝트 HTTPS 주소와 publishable 또는 anon 공개 키를 확인하세요.');
 return supabase.createClient(url,key,{auth:{persistSession:false,autoRefreshToken:true,detectSessionInUrl:false}});
}
try{db=config();}catch(e){$('setupHint').textContent=e.message;}
$('roles').onclick=e=>{if(!e.target.dataset.role)return;role=e.target.dataset.role;for(const b of $('roles').children)b.classList.toggle('selected',b===e.target);};
$('signin').onsubmit=async e=>{
 e.preventDefault();if(busy)return;busy=true;
 try{if(!db)throw Error($('setupHint').textContent);
 const f=new FormData(e.target); const login=await db.auth.signInWithPassword({email:f.get('email').trim(),password:f.get('password')});
 if(login.error)throw Error('로그인에 실패했습니다. 이메일·비밀번호와 계정 활성화를 확인하세요.');
 const initial=await read(); if(initial.me.role!==role)throw Error('등록된 권한과 다릅니다. 해당 로그인 탭을 선택하세요.');
 data=initial;tab=tabs[role][0];$('login').hidden=true;$('portal').hidden=false;$('signin').reset();render();
 }catch(err){if(db)await db.auth.signOut({scope:'local'});error(err);}finally{busy=false;}
};
$('logout').onclick=async()=>{seq++;data=null;await db.auth.signOut({scope:'local'});$('portal').hidden=true;$('login').hidden=false;$('content').innerHTML='';$('identity').textContent='';};
async function read(){const d=$('day').value, period=$('month').value;if(!d||!period)throw Error('근무일과 조회 월을 선택하세요.');
 const {data:r,error:e}=await db.rpc('fj_read',{d,period:period+'-01'});if(e)throw e;
 for(const key of ['rules','prices','menus','todayMeals','monthly','counts','runs','rides','staff'])r[key]??=[];r.loadedDay=d;r.loadedMonth=period.slice(0,7);return r;
}
async function refresh(quiet=false){if(!data)return;const ticket=++seq;try{const r=await read();if(ticket!==seq||!data)return;data=r;render();return true;}catch(e){error(e);}}
for(const id of ['day','month','reload'])$(id)[id==='reload'?'onclick':'onchange']=()=>refresh();
$('nav').onclick=e=>{if(e.target.dataset.tab){tab=e.target.dataset.tab;render();}};
setInterval(()=>{if(data&&!busy&&!document.hidden&&['조리 현황','식사 신청','운영 현황'].includes(tab)&&!$('content').contains(document.activeElement))refresh(true);},15000);
const panel=(title,body)=>'<article><h2>'+safe(title)+'</h2>'+body+'</article>';
const table=(headers,rows)=>rows.length?'<div class="tablewrap"><table><thead><tr>'+headers.map(h=>'<th>'+safe(h)+'</th>').join('')+'</tr></thead><tbody>'+rows.map(r=>'<tr>'+r.map(v=>'<td>'+v+'</td>').join('')+'</tr>').join('')+'</tbody></table></div>':'<p class="subtle">표시할 내역이 없습니다.</p>';
const plain=(headers,rows)=>table(headers,rows.map(r=>r.map(safe)));
const metric=(name,value)=>'<div class="metric">'+safe(name)+'<strong>'+safe(value)+'</strong></div>';
const form=(act,fields,label)=>'<form class="row" data-act="'+act+'">'+fields+'<button class="primary">'+label+'</button></form>';
const input=(name,title,type='text',v='',extra='')=>'<label>'+title+'<input required name="'+name+'" type="'+type+'" value="'+safe(v)+'" '+extra+'></label>';
const select=(name,title,values)=>'<label>'+title+'<select name="'+name+'">'+values.map(v=>'<option>'+safe(v)+'</option>').join('')+'</select></label>';
const btn=(act,label,p={},disabled=false)=>'<button type="button" data-action="'+act+'" data-p="'+safe(JSON.stringify(p))+'" '+(disabled?'disabled':'')+'>'+safe(label)+'</button>';
const day=()=>$('day').value;
const own=(rows)=>rows.filter(r=>r.uid===data.me.id);
const deadline=(time)=>new Date(day()+'T'+time+'+09:00')<=new Date();
function week(){return panel('주간 식단',plain(['근무일','식구분','메뉴'],data.menus.map(m=>[m.day,m.kind,m.items.join(' · ')])));}
function meals(){return '<div class="grid">'+kinds.map(k=>{
 const menu=data.menus.find(m=>m.day===day()&&m.kind===k), rule=data.rules.find(m=>m.kind===k), req=own(data.todayMeals).find(m=>m.kind===k);
 const applied=req&&req.state!=='취소', cut=deadline(rule.cutoff), p={day:day(),kind:k};
 const price=data.prices.find(r=>r.kind===k&&r.since<=day());
 return '<article><span class="tag">'+safe(req?.state||'미신청')+'</span><h2>'+k+'</h2><p>'+safe(menu?.items.join(' · ')||'식단 미등록')+'</p><p class="subtle">마감 '+safe(rule.cutoff.slice(0,5))+' · 개인 '+won(applied?req.total-req.subsidy:price?price.total-price.subsidy:0)+'</p>'+btn(applied?'cancel':'meal',cut?'마감됨':applied?'신청 취소':'식사 신청',p,cut||!menu||req?.state==='실식')+'</article>';
 }).join('')+'</div>'+week();}
function ridePage(admin){const rows=data.runs.map(r=>{
 const matches=data.rides.filter(x=>x.route===r.route&&x.shift===r.shift),mine=matches.some(x=>x.uid===data.me.id);
 const p={day:day(),route:r.route,shift:r.shift};
 return [safe(r.shift),safe(r.route),safe(new Date(r.cutoff).toLocaleString('ko-KR',{timeZone:'Asia/Seoul'})),admin?safe(matches.length)+'명':mine?'신청':'미신청',admin?btn('removeRun','운행 삭제',p):btn(mine?'cancelRide':'ride',mine?'탑승 취소':'탑승 신청',p,new Date(r.cutoff)<=new Date())];
 });
 let out=panel('노선별 운행',table(['근무','노선','마감 (한국시간)',admin?'신청 인원':'내 상태','처리'],rows));
 if(admin){
 out+=panel('운행 등록',form('run',select('shift','운행 구분',['주간','야간'])+input('route','노선명','text','','list="routes"')+'<datalist id="routes">'+['창원1','창원2','마산','진해','김해/부산'].map(n=>'<option>'+n+'</option>').join('')+'</datalist>'+input('deadline','신청 마감 (한국시간)','datetime-local',day()+'T08:00'),'운행 저장'));
 out+=panel('탑승 명단',plain(['근무','노선','부서','사번','이름'],data.rides.map(r=>{const s=data.staff.find(x=>x.id===r.uid);return [r.shift,r.route,r.dept,s?.code,s?.name];})));
 }return out;}
function kitchen(){return '<div class="metrics">'+kinds.map(k=>metric(k+' 준비 인원',(data.counts.find(r=>r.kind===k)?.qty||0)+'명')).join('')+'</div>'+panel('마감 상태',plain(['식사','신청·취소 마감','집계 상태'],data.rules.map(r=>[r.kind,r.cutoff.slice(0,5),deadline(r.cutoff)?'마감 인원':'신청 접수 중'])))+week();}
function menuEdit(){return panel('근무일 식단 등록',form('menu',select('kind','식구분',kinds)+'<label>메뉴 (한 줄에 1개, 최대 10개)<textarea name="items" rows="4" required placeholder="잡곡밥&#10;된장국"></textarea></label>','식단 저장'))+week();}
function billable(r){return r.state==='실식'||((data.closed?.basis||data.basis)==='신청 포함'&&r.state==='신청');}
function total(rows,key){return rows.reduce((sum,r)=>sum+r[key],0);}
function settlement(admin){const rows=admin?data.monthly:own(data.monthly);const charged=rows.filter(billable);
 return '<div class="metrics">'+metric('실식 횟수',rows.filter(r=>r.state==='실식').length+'회')+metric('회사 부담',won(total(charged,'subsidy')))+metric('개인 공제',won(total(charged,'total')-total(charged,'subsidy')) )+'</div>'+panel('월별 정산 내역','<p>'+safe($('month').value)+' · '+(data.closed?'마감 확정':'예상 금액')+' · 정산 기준 '+safe(data.closed?.basis||data.basis)+'</p>'+plain(['날짜','사번','이름','끼니','상태','식단가','회사 부담','개인 공제'],rows.map(r=>[r.day,r.code,r.name,r.kind,r.state,won(r.total),won(billable(r)?r.subsidy:0),won(billable(r)?r.total-r.subsidy:0)]))+(admin?'<div class="row">'+btn('xlsx','엑셀 다운로드')+btn('close','월 마감',{day:$('month').value+'-01'},!!data.closed)+'</div>':''));}
function operations(){const groups=new Map();
 const mon=$('month').value;
 const last=new Date(Date.UTC(Number(mon.slice(0,4)),Number(mon.slice(5)),0)).toISOString().slice(0,10);
 if(!rangeStart.startsWith(mon)||!rangeEnd.startsWith(mon)){rangeStart=mon+'-01';rangeEnd=last;}
 const range=form('range',input('start','집계 시작일','date',rangeStart,'min="'+mon+'-01" max="'+last+'"')+
 input('end','집계 종료일','date',rangeEnd,'min="'+mon+'-01" max="'+last+'"'),'기간 조회');

 for(const r of data.monthly.filter(r=>r.state!=='취소'&&r.day>=rangeStart&&r.day<=rangeEnd)){const key=JSON.stringify([r.day,r.dept,r.shift]);if(!groups.has(key))groups.set(key,[r.day,r.dept,r.shift,0,0,0]);groups.get(key)[3+kinds.indexOf(r.kind)]++;}
 return kitchen()+panel('조회 월 · 부서 및 교대조 집계',range+plain(['날짜','부서','근무형태',...kinds],Array.from(groups.values())))+panel('근무일 실식 확인',table(['사번','이름','부서','식사','상태','처리'],data.todayMeals.filter(r=>r.state!=='취소').map(r=>[...([r.code,r.name,r.dept,r.kind,r.state].map(safe)),btn(r.state==='실식'?'undoActual':'actual',r.state==='실식'?'확정 취소':'실식 확정',{day:r.day,id:r.id},r.day>kdate())])));}
function settings(){return panel('끼니별 신청·취소 마감',plain(['끼니','마감 시각'],data.rules.map(r=>[r.kind,r.cutoff.slice(0,5)]))+form('rule',select('kind','끼니',kinds)+input('cutoff','새 마감 시각','time','09:00'),'마감 시각 저장'))+
 panel('단가 이력',plain(['적용일','끼니','단가','회사 부담','개인 부담'],data.prices.map(r=>[r.since,r.kind,won(r.total),won(r.subsidy),won(r.total-r.subsidy)]))+form('price',input('day','적용 시작일','date',day())+select('kind','끼니',kinds)+input('total','1식 단가','number','7000','min="0"')+input('subsidy','회사 부담','number','4000','min="0"'),'단가 저장'))+
 panel('월 정산 기준','<p>현재 기준 · '+safe(data.basis)+'</p>'+form('basis',select('basis','미마감 월에 적용',['실식','신청 포함']),'기준 저장'));}
function staff(){return panel('직원 등록 및 수정','<p class="subtle">Supabase 인증에 등록한 회사 이메일을 입력하세요. 기존 이메일로 저장하면 직원 정보가 갱신됩니다.</p>'+form('staff',input('email','인증 이메일','email')+input('code','사번')+input('name','이름')+input('dept','부서')+input('shift','근무형태 / 교대조')+select('role','권한',['직원','영양사','관리자']),'직원 저장'))+panel('직원 목록',plain(['사번','이름','부서','근무형태','권한'],data.staff.map(s=>[s.code,s.name,s.dept,s.shift,s.role])));}
function render(){const me=data.me;
 $('identity').textContent=me.name+' · '+me.role;$('roleText').textContent=me.dept+' / '+me.role;$('heading').textContent=tab;
 $('nav').innerHTML=tabs[me.role].map(n=>'<button data-tab="'+n+'" class="'+(tab===n?'active':'')+'">'+n+'</button>').join('');
 const pages={'식사 신청':meals,'통근 신청':()=>ridePage(false),'내 정산':()=>settlement(false),'조리 현황':kitchen,'식단 등록':menuEdit,'운영 현황':operations,'통근 운영':()=>ridePage(true),'월 정산':()=>settlement(true),'운영 설정':settings,'직원 관리':staff};
 $('content').innerHTML=pages[tab]();
}
function excel(){const rows=data.monthly.filter(billable), grouped=new Map();
 for(const r of rows){const key=r.uid;const g=grouped.get(key)||[r.code,r.name,0,0,0,0];g[2]++;g[3]+=r.total;g[4]+=r.subsidy;g[5]+=r.total-r.subsidy;grouped.set(key,g);}
 const wb=XLSX.utils.book_new();
 function sheet(name,aoa){XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet(aoa),name);}
 sheet('급여공제',[['사번','이름','정산 식수','식대 합계','회사 부담','급여 공제'],...grouped.values()]);
 sheet('일자별 상세',[['날짜','사번','이름','부서','근무형태','식사','상태','정산 식대','회사 부담','급여 공제'],...data.monthly.map(r=>[r.day,r.code,r.name,r.dept,r.shift,r.kind,r.state,billable(r)?r.total:0,billable(r)?r.subsidy:0,billable(r)?r.total-r.subsidy:0])]);
 sheet('회계 집계',[['정산 월','마감 상태','기준','식수','식대 총액','회사 부담','급여 공제'],[$('month').value,data.closed?'확정':'예상',data.closed?.basis||data.basis,rows.length,total(rows,'total'),total(rows,'subsidy'),total(rows,'total')-total(rows,'subsidy')]]);
 XLSX.writeFile(wb,'식수정산_'+$('month').value+'_'+(data.closed?'확정':'예상')+'.xlsx');
}
async function save(action,p){if(busy)return;
 if(data.loadedDay!==day()||data.loadedMonth!==$('month').value)return say('날짜를 다시 조회한 뒤 처리하세요.');
 if(action==='xlsx'){try{const r=await read();data=r;excel();render();}catch(e){error(e);}return;}
 if(action==='close'&&!confirm(p.day.slice(0,7)+' 정산을 마감하면 이 달의 내역을 수정할 수 없습니다. 계속할까요?'))return;
 if(action==='staff'&&p.role==='관리자'&&!confirm('이 계정에 전체 직원과 정산 정보 관리 권한을 부여할까요?'))return;
 busy=true;seq++;try{const {error:e}=await db.rpc('fj_write',{action,p});if(e)throw e;if(await refresh())say('저장했습니다.');}catch(e){error(e);}finally{busy=false;}}
$('content').onclick=e=>{const b=e.target.closest('button[data-action]');if(b)save(b.dataset.action,JSON.parse(b.dataset.p));};
$('content').onsubmit=e=>{e.preventDefault();const p={day:day(),...Object.fromEntries(new FormData(e.target))};
 if(e.target.dataset.act==='range'){if(p.start>p.end)return say('종료일을 확인하세요.');rangeStart=p.start;rangeEnd=p.end;render();return;}
 if(p.items){p.items=p.items.split(/\r?\n/).map(v=>v.trim()).filter(Boolean);if(!p.items.length||p.items.length>10)return say('메뉴를 1~10개 입력하세요.');}
 if(p.subsidy!==undefined&&Number(p.subsidy)>Number(p.total))return say('회사 부담금은 단가 이하여야 합니다.');
 save(e.target.dataset.act,p);};
