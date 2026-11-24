with
ext as (select objid from pg_depend where deptype='e'),
ns as (select oid, nspname from pg_namespace where nspname in ('public')),
rels as (
  select c.oid, c.relname, c.relkind, c.relrowsecurity, c.relforcerowsecurity, c.reloptions, c.relacl::text acl
  from pg_class c join ns on ns.oid=c.relnamespace
  where c.relkind in ('r','p','v','m','S') and c.oid not in (select objid from ext)
)
select jsonb_build_object(
 'enums', (select jsonb_agg(jsonb_build_object('n', t.typname, 'v', (select jsonb_agg(enumlabel order by enumsortorder) from pg_enum where enumtypid=t.oid))) from pg_type t join ns on ns.oid=t.typnamespace where t.typtype='e' and t.oid not in (select objid from ext)),
 'domains', (select jsonb_agg(jsonb_build_object('n', t.typname, 'base', format_type(t.typbasetype, t.typtypmod), 'notnull', t.typnotnull, 'def', t.typdefault, 'checks', (select jsonb_agg(pg_get_constraintdef(oid)) from pg_constraint where contypid=t.oid))) from pg_type t join ns on ns.oid=t.typnamespace where t.typtype='d' and t.oid not in (select objid from ext)),
 'composites', (select jsonb_agg(jsonb_build_object('n', t.typname, 'cols', (select jsonb_agg(jsonb_build_object('c',a.attname,'t',format_type(a.atttypid,a.atttypmod)) order by a.attnum) from pg_attribute a where a.attrelid=t.typrelid and a.attnum>0 and not a.attisdropped))) from pg_type t join ns on ns.oid=t.typnamespace join pg_class c on c.oid=t.typrelid where t.typtype='c' and c.relkind='c' and t.oid not in (select objid from ext)),
 'sequences', (select jsonb_agg(jsonb_build_object('n', r.relname, 'owned', (select jsonb_build_object('t', c2.relname, 'c', a.attname, 'dep', d.deptype) from pg_depend d join pg_class c2 on c2.oid=d.refobjid join pg_attribute a on a.attrelid=d.refobjid and a.attnum=d.refobjsubid where d.objid=r.oid and d.classid='pg_class'::regclass and d.refclassid='pg_class'::regclass limit 1), 'acl', r.acl)) from rels r where r.relkind='S'),
 'tables', (select jsonb_agg(jsonb_build_object('n', r.relname, 'kind', r.relkind, 'rls', r.relrowsecurity, 'force', r.relforcerowsecurity, 'acl', r.acl,
     'cols', (select jsonb_agg(jsonb_build_object('c', a.attname, 't', format_type(a.atttypid, a.atttypmod), 'nn', a.attnotnull, 'def', pg_get_expr(ad.adbin, ad.adrelid), 'id', a.attidentity, 'gen', a.attgenerated, 'acl', a.attacl::text) order by a.attnum) from pg_attribute a left join pg_attrdef ad on ad.adrelid=a.attrelid and ad.adnum=a.attnum where a.attrelid=r.oid and a.attnum>0 and not a.attisdropped),
     'cons', (select jsonb_agg(jsonb_build_object('n', co.conname, 'type', co.contype, 'def', pg_get_constraintdef(co.oid)) order by co.contype, co.conname) from pg_constraint co where co.conrelid=r.oid)
   ) order by r.relname) from rels r where r.relkind in ('r','p')),
 'views', (select jsonb_agg(jsonb_build_object('n', r.relname, 'kind', r.relkind, 'opt', r.reloptions, 'acl', r.acl, 'def', pg_get_viewdef(r.oid, false),
     'deps', (select jsonb_agg(distinct c2.relname) from pg_rewrite rw join pg_depend d on d.objid=rw.oid and d.classid='pg_rewrite'::regclass join pg_class c2 on c2.oid=d.refobjid where rw.ev_class=r.oid and d.refobjid<>r.oid and c2.relkind in ('v','m'))
   ) order by r.relname) from rels r where r.relkind in ('v','m')),
 'functions', (select jsonb_agg(jsonb_build_object('n', p.proname, 'args', pg_get_function_identity_arguments(p.oid), 'def', pg_get_functiondef(p.oid), 'acl', p.proacl::text, 'secdef', p.prosecdef) order by p.proname, p.oid) from pg_proc p join ns on ns.oid=p.pronamespace where p.prokind in ('f','p') and p.oid not in (select objid from ext)),
 'indexes', (select jsonb_agg(pg_get_indexdef(i.indexrelid) order by 1) from pg_index i join rels r on r.oid=i.indrelid where not exists (select 1 from pg_constraint co where co.conindid=i.indexrelid and co.contype in ('p','u','x'))),
 'triggers', (select jsonb_agg(pg_get_triggerdef(t.oid) order by 1) from pg_trigger t join rels r on r.oid=t.tgrelid where not t.tgisinternal),
 'policies', (select jsonb_agg(jsonb_build_object('s', n.nspname, 't', c.relname, 'n', p.polname, 'perm', p.polpermissive, 'cmd', p.polcmd, 'roles', (select jsonb_agg(case when x=0 then 'public' else pg_get_userbyid(x) end) from unnest(p.polroles) x), 'using', pg_get_expr(p.polqual, p.polrelid), 'check', pg_get_expr(p.polwithcheck, p.polrelid)) order by n.nspname, c.relname, p.polname) from pg_policy p join pg_class c on c.oid=p.polrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname in ('public','storage')),
 'storage_rls', (select jsonb_agg(jsonb_build_object('t', c.relname, 'rls', c.relrowsecurity)) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='storage' and c.relkind='r'),
 'cron', (select jsonb_agg(p.proname) from pg_proc p where false),
 'schema_acl', (select nspacl::text from pg_namespace where nspname='public'),
 'defacl', (select jsonb_agg(jsonb_build_object('role', pg_get_userbyid(defaclrole), 'type', defaclobjtype, 'acl', defaclacl::text)) from pg_default_acl d join pg_namespace n on n.oid=d.defaclnamespace where n.nspname='public')
)::text;
