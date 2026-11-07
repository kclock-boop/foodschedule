-- 새 Supabase 프로젝트의 SQL Editor에서 전체를 한 번 실행하세요.
begin;
create schema fj;
revoke all on schema fj from public, anon, authenticated;
create table fj.staff(
 id uuid primary key references auth.users(id), code text unique not null, name text not null,
 dept text not null, shift text not null, role text not null check(role in ('직원','영양사','관리자'))
);
create table fj.rules(kind text primary key, cutoff time not null);
insert into fj.rules values ('점심','09:00'),('저녁','14:00'),('야간','14:00');
create table fj.price(kind text references fj.rules, since date not null, total int not null check(total>=0),
 subsidy int not null check(subsidy between 0 and total),primary key(kind,since));
insert into fj.price values ('점심','2000-01-01',7000,4000),('저녁','2000-01-01',7000,4000),('야간','2000-01-01',8000,5000);
create table fj.menu(day date,kind text references fj.rules, items text[] not null check(cardinality(items) between 1 and 10),primary key(day,kind));
create table fj.meals(id bigint generated always as identity primary key, uid uuid references fj.staff, day date not null, kind text references fj.rules,
 state text check(state in ('신청','취소','실식')), total int not null, subsidy int not null,
 code text not null,name text not null,dept text not null,shift text not null, unique(uid,day,kind));
create index on fj.meals(day);
create table fj.runs(day date,shift text check(shift in ('주간','야간')),route text,
 cutoff timestamptz not null,primary key(day,shift,route));
create table fj.rides(uid uuid references fj.staff, day date,shift text,route text,dept text not null,
 primary key(uid,day,shift),foreign key(day,shift,route) references fj.runs);
create table fj.closed(month date primary key,basis text check(basis in ('실식','신청 포함')),closed_at timestamptz default now(),closed_by uuid references fj.staff);
create table fj.settings(id boolean primary key default true check(id),basis text not null check(basis in ('실식','신청 포함')));
insert into fj.settings values(true,'실식');
do $$ declare t text; begin
 for t in select tablename from pg_tables where schemaname='fj' loop
 execute format('alter table fj.%I enable row level security',t);
 end loop;
end $$;

-- 단일 쓰기 경로. 월별 잠금으로 신청·실식·마감 사이의 경쟁을 방지한다.
create function public.fj_write(action text,p jsonb) returns void language plpgsql security definer set search_path='' as $$
declare
 s fj.staff; r fj.price; m fj.meals; vday date := (p->>'day')::date; k text:=p->>'kind'; cutoff_at timestamptz;
 mon date:=date_trunc('month',vday)::date; today date:=(clock_timestamp() at time zone 'Asia/Seoul')::date;
 items text[]; n int; vroute text:=trim(p->>'route'); sh text:=p->>'shift'; b text; target uuid;
begin
 select * into strict s from fj.staff where id=auth.uid();
 if action in ('rule','basis','price','run','removeRun','close','staff','actual','undoActual') and s.role<>'관리자' then raise exception '관리자 권한이 필요합니다'; end if;
 if action='menu' and s.role not in ('영양사','관리자') then raise exception '식단 등록 권한이 필요합니다'; end if;
 if vday is not null then
 perform pg_advisory_xact_lock(18450,mon-date '2000-01-01');
 if exists(select from fj.closed where month=mon) then raise exception '마감된 월입니다'; end if;
 end if;
 case action
 when 'meal','cancel' then
 select (vday + cutoff) at time zone 'Asia/Seoul' into strict cutoff_at from fj.rules where kind=k;
 if clock_timestamp()>=cutoff_at then raise exception '신청·취소 마감 시간이 지났습니다'; end if;
 select * into m from fj.meals where uid=s.id and day=vday and kind=k;
 if m.state='실식' then raise exception '실식 확정 건입니다'; end if;
 if action='cancel' then
 update fj.meals set state='취소' where uid=s.id and day=vday and kind=k and state='신청';
 else
 if not exists(select from fj.menu where day=vday and kind=k) then raise exception '등록된 식단이 없습니다'; end if;
 if m.state='신청' then return; end if;
 select * into strict r from fj.price where kind=k and since<=vday order by since desc limit 1;
 insert into fj.meals(uid,day,kind,state,total,subsidy,code,name,dept,shift) values(s.id,vday,k,'신청',r.total,r.subsidy,s.code,s.name,s.dept,s.shift)
 on conflict(uid,day,kind) do update set state='신청',total=excluded.total,subsidy=excluded.subsidy,dept=excluded.dept,shift=excluded.shift;
 end if;
 when 'actual','undoActual' then
 if vday>today then raise exception '미래 날짜의 실식을 확정할 수 없습니다'; end if;
 update fj.meals set state=case when action='actual' then '실식' else '신청' end
 where id=(p->>'id')::bigint and day=vday and state=case when action='actual' then '신청' else '실식' end;
 if not found then raise exception '상태가 바뀌었습니다. 다시 조회하세요'; end if;
 when 'menu' then
 select array_agg(trim(value)) into items from jsonb_array_elements_text(p->'items') where trim(value)<>'';
 insert into fj.menu values(vday,k,items) on conflict(day,kind) do update set items=excluded.items;
 when 'rule' then
 update fj.rules set cutoff=(p->>'cutoff')::time where kind=k;
 when 'basis' then update fj.settings set basis=p->>'basis';
 when 'price' then
 insert into fj.price values(k,vday,(p->>'total')::int,(p->>'subsidy')::int)
 on conflict(kind,since) do update set total=excluded.total,subsidy=excluded.subsidy;
 when 'run' then
 if coalesce(vroute,'')='' then raise exception '노선을 입력하세요'; end if;
 insert into fj.runs values(vday,sh,vroute,((p->>'deadline')::timestamp at time zone 'Asia/Seoul'))
 on conflict(day,shift,route) do update set cutoff=excluded.cutoff;
 when 'removeRun' then
 if exists(select from fj.rides where day=vday and shift=sh and route=vroute) then raise exception '탑승 신청이 있어 삭제할 수 없습니다'; end if;
 delete from fj.runs where day=vday and shift=sh and route=vroute;
 when 'ride','cancelRide' then
 if exists(select from fj.rides a join fj.runs z using(day,shift,route) where a.uid=s.id and a.day=vday and a.shift=sh and z.cutoff<=clock_timestamp()) then raise exception '기존 노선의 마감 시간이 지났습니다'; end if;
 if action='cancelRide' then delete from fj.rides where uid=s.id and day=vday and shift=sh;
 else
 select cutoff into strict cutoff_at from fj.runs where day=vday and shift=sh and route=vroute;
 if clock_timestamp()>=cutoff_at then raise exception '탑승 마감 시간이 지났습니다'; end if;
 insert into fj.rides values(s.id,vday,sh,vroute,s.dept) on conflict(uid,day,shift) do update set route=excluded.route,dept=excluded.dept;
 end if;
 when 'close' then
 if mon+interval '1 month'>today then raise exception '종료된 달만 마감할 수 있습니다'; end if;
 select basis into b from fj.settings;
 insert into fj.closed(month,basis,closed_by) values(mon,b,s.id);
 when 'staff' then
 select id into target from auth.users where lower(email)=lower(trim(p->>'email'));
 if target is null then raise exception '인증 사용자 이메일을 먼저 등록하세요'; end if;
 if target=s.id then raise exception '본인 계정은 이 화면에서 변경할 수 없습니다'; end if;
 if exists(select from fj.staff where id=target and role='관리자') then raise exception '기존 관리자 변경은 DB 담당자가 처리하세요'; end if;
 if coalesce(trim(p->>'code'),'')='' or coalesce(trim(p->>'name'),'')='' or coalesce(trim(p->>'dept'),'')='' or coalesce(trim(sh),'')='' then raise exception '직원 정보를 모두 입력하세요'; end if;
 insert into fj.staff values(target,trim(p->>'code'),trim(p->>'name'),trim(p->>'dept'),sh,p->>'role')
 on conflict(id) do update set code=excluded.code,name=excluded.name,dept=excluded.dept,shift=excluded.shift,role=excluded.role;
 else raise exception '알 수 없는 작업입니다';
 end case;
exception when no_data_found then raise exception '계정 등록 또는 적용할 설정을 확인하세요';
end $$;

create function public.fj_read(d date,period date) returns jsonb language plpgsql security definer set search_path='' as $$
declare s fj.staff; mon date:=date_trunc('month',period)::date; lastday date:=(mon+interval '1 month')::date;
 monday date:=date_trunc('week',d)::date; result jsonb;
begin
 select * into s from fj.staff where id=auth.uid();
 if not found then raise exception '담당자에게 직원 권한 등록을 요청하세요'; end if;
 select jsonb_build_object(
 'me',to_jsonb(s),'rules',(select jsonb_agg(t) from fj.rules t),
 'prices',(select jsonb_agg(t order by since desc) from fj.price t),
 'basis',(select basis from fj.settings),'closed',(select to_jsonb(t) from fj.closed t where month=mon),
 'menus',(select jsonb_agg(t order by day) from fj.menu t where day between monday and monday+6),
 'todayMeals',(select jsonb_agg(t) from fj.meals t where day=d and (uid=s.id or s.role='관리자')),
 'monthly',(select jsonb_agg(t order by day,code,kind) from fj.meals t where day>=mon and day<lastday and (uid=s.id or s.role='관리자')),
 'counts',(select jsonb_agg(t) from (select kind,count(*)::int as qty from fj.meals where day=d and state<>'취소' and s.role in ('관리자','영양사') group by kind)t),
 'runs',(select jsonb_agg(t order by shift,route) from fj.runs t where day=d),
 'rides',(select jsonb_agg(t) from fj.rides t where day=d and (uid=s.id or s.role='관리자')),
 'staff',(select jsonb_agg(t order by code) from fj.staff t where s.role='관리자')
 ) into result; return result;
end $$;
revoke all on function public.fj_read(date,date),public.fj_write(text,jsonb) from public,anon;
grant execute on function public.fj_read(date,date),public.fj_write(text,jsonb) to authenticated;
commit;
