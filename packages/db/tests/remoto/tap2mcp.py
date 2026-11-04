"""Convierte una o varias pruebas pgTAP en un único script para execute_sql del MCP.
Cada resultado va a la tabla temporal tap; al final un raise exception 'RESUMEN' deshace todo y muestra el resumen."""
import re, sys

PGTAP = re.compile(r'^\s*select\s+(\*\s+from\s+finish|plan|ok|is|isnt|throws_ok|throws_like|lives_ok|results_eq|'
                   r'set_eq|bag_eq|policies_are|matches|has_column|col_default_is|has_index|has_function|has_table|'
                   r'col_is_null|col_not_null|cmp_ok|hasnt_\w+|has_\w+|is_empty|isnt_empty|row_eq|pass|fail|diag|'
                   r'col_type_is|function_returns|is_definer|isnt_definer|unalike|alike|doesnt_match|\w+_are|\w+_is)\b',
                   re.I | re.S)


def statements(sql):
    out, buf, i, n = [], [], 0, len(sql)
    dollar = None
    quote = False
    while i < n:
        c = sql[i]
        if dollar:
            if sql.startswith(dollar, i):
                buf.append(dollar); i += len(dollar); dollar = None; continue
        elif quote:
            if c == "'":
                quote = False
        else:
            if c == '-' and sql.startswith('--', i):
                j = sql.find('\n', i); j = n if j < 0 else j
                i = j; continue
            if c == "'":
                quote = True
            m = re.match(r'\$[A-Za-z_]*\$', sql[i:])
            if m:
                dollar = m.group(0); buf.append(dollar); i += len(dollar); continue
            if c == ';':
                s = ''.join(buf).strip()
                if s: out.append(s)
                buf = []; i += 1; continue
        buf.append(c); i += 1
    s = ''.join(buf).strip()
    if s: out.append(s)
    return out


def convert(path):
    sql = open(path, encoding='utf-8').read()
    res = []
    for s in statements(sql):
        low = s.lower()
        if low in ('begin', 'rollback', 'commit'):
            continue
        if PGTAP.match(s):
            s = 'insert into tap(l) ' + s
        res.append(s + ';')
    return res


import os
pre = open(os.path.join(os.path.dirname(__file__), 'pre.sql'), encoding='utf-8').read()
body = []
for p in sys.argv[1:]:
    k = p.split('/')[-1][:2]
    body.append('savepoint f;')
    body += convert(p)
    body += ["reset role;", f"select pg_temp.guardar('{k}');", "rollback to savepoint f;", f"select pg_temp.anotar('{k}');"]
tail = ["""do $r$ declare v text; begin
select string_agg(format('%s ok=%s bad=%s plan=%s first_bad=%s', f, ok, bad, plan, first_bad), ' | ' order by f) into v from pg_temp.res;
raise exception 'RESUMEN %', v; end $r$;"""]
print(pre + chr(10).join(body + tail))
