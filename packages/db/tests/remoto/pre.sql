begin;
create temp table tap(id bigserial, l text);
grant all on tap to public;
grant all on sequence tap_id_seq to public;
create temp table res(f text, ok int, bad int, plan int, first_bad int);
create temp sequence q_ok; create temp sequence q_bad; create temp sequence q_plan; create temp sequence q_first;
create function pg_temp.guardar(f text) returns void language plpgsql as $g$ begin
  perform setval('pg_temp.q_ok', 1 + (select count(*) from pg_temp.tap where l ~ '^ok'));
  perform setval('pg_temp.q_bad', 1 + (select count(*) from pg_temp.tap where l ~ '^not ok'));
  perform setval('pg_temp.q_plan', 1 + coalesce((select max(substring(l from '^1\.\.([0-9]+)')::int) from pg_temp.tap), 0));
  perform setval('pg_temp.q_first', 1 + coalesce((select min(substring(l from '^not ok ([0-9]+)')::int) from pg_temp.tap), 0));
end $g$;
create function pg_temp.anotar(f text) returns void language plpgsql as $g$ begin
  insert into pg_temp.res select f, (select last_value from pg_temp.q_ok) - 1, (select last_value from pg_temp.q_bad) - 1,
    (select last_value from pg_temp.q_plan) - 1, (select last_value from pg_temp.q_first) - 1;
end $g$;
