-- Authentication > Users에서 계정을 만든 뒤 아래 이메일, 사번, 이름을 수정하세요.
do $$
declare
 admin_email text := 'admin@example.com';
 admin_code text := 'A001';
 admin_name text := '관리담당';
 account_id uuid;
begin
 select id into account_id from auth.users where lower(email)=lower(admin_email);
 if account_id is null then raise exception '이메일에 해당하는 인증 계정이 없습니다'; end if;
 if exists(select from fj.staff where role='관리자') then raise exception '최초 관리자가 이미 등록되었습니다'; end if;
 insert into fj.staff(id,code,name,dept,shift,role)
 values(account_id,admin_code,admin_name,'관리팀','주간','관리자');
end $$;
