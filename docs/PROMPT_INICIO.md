# Prompts para Claude Code

## 1. Antes de pegar el prompt (una sola vez)

1. Instala: Node.js 22 LTS, pnpm 9+, Git, Docker Desktop, Supabase CLI y Claude Code actualizado (`claude update`).
2. Crea el repositorio privado en GitHub (p. ej. `izao`), clónalo y descomprime este kit en la raíz (deben quedar `CLAUDE.md`, `.claude/` y `docs/`).
3. `supabase login` (abre el navegador; así Claude Code puede enlazar el proyecto sin que pegues llaves).
4. Crea `.env.local` en la raíz copiando las variables de la sección 28 de la especificación y llena solo: `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY`, `DATABASE_URL` y una `APP_ENCRYPTION_KEY` generada con `openssl rand -base64 32`. Claude Code no puede leer ese archivo (está bloqueado en `.claude/settings.json`).
5. Configura el MCP de Contabo siguiendo `tools/contabo-mcp/README.md` (llave SSH, `setup-vps.sh` en el VPS, `.env` del MCP, `npm install && npm run build && npm run check`).
6. Abre la terminal en la carpeta del repo y arranca el líder con el modelo más fuerte:
   ```bash
   claude --model opus
   ```
   La primera vez, acepta confiar en la carpeta (necesario para que carguen los agentes y el MCP del proyecto). Ejecuta `/mcp` y confirma que `contabo` aparece conectado.

## 2. Prompt de arranque (pégalo completo)

```text
Eres el LÍDER técnico del proyecto Izao Perfumería. Vas a construirlo con un equipo de agentes.

1. Lee completos, en este orden: CLAUDE.md, docs/ESPECIFICACION.md y docs/EQUIPO.md. Revisa también la lista de agentes en .claude/agents/ y de skills en .claude/skills/.
2. Antes de escribir código, responde con:
   a) Un resumen de máximo 15 líneas de lo que entendiste del proyecto.
   b) Las dudas o contradicciones que encuentres en la especificación (si no hay, dilo).
   c) El plan de la Oleada 0 (Cimientos) dividido en tareas pequeñas con: id, título, agente dueño, sección de la especificación, skill a cargar, archivos que toca, dependencias y criterio de aceptación verificable.
   Espera mi aprobación.
3. Cuando apruebe, crea un equipo de agentes (agent team) para la Oleada 0 con los compañeros izao-infra, izao-db e izao-datos, usando sus definiciones de .claude/agents/ (cada definición ya fija su modelo; no lo cambies). Nombra a cada compañero igual que su agente. Carga las tareas en la lista compartida con sus dependencias.
4. Reglas de trabajo para todo el proyecto:
   - Tú coordinas: no implementes código de las zonas de otros agentes. Solo escribes en docs/ y archivos raíz.
   - Cada tarea termina con pruebas en verde, commit solo de los archivos propios y revisión de izao-revisor (como subagente). No cierres tareas con hallazgos críticos o altos abiertos.
   - Máximo 4 compañeros activos a la vez.
   - Si un compañero se bloquea dos veces por la misma causa, intervén o pregúntame.
   - El VPS se opera solo con el MCP contabo y sus reglas de CLAUDE.md (inventario primero, snapshot antes de cambios difíciles de revertir, nunca tocar otros proyectos, lo bloqueado me lo pides a mí). Nunca crees pedidos reales en MasterShop ni hagas operaciones destructivas en el proyecto remoto de Supabase sin mi aprobación explícita en ese momento.
   - Donde la especificación diga [COMPLETAR], pregúntame; donde diga [VERIFICAR], el agente dueño consulta la documentación oficial y lo registra en docs/DECISIONES.md.
5. Al cerrar la oleada: verifica uno a uno los criterios de aceptación de F0 (sección 30), escribe docs/fases/oleada-0.md (hecho, decisiones, pendientes), apaga a los compañeros y propónme el plan de la Oleada 1 con el mismo formato del punto 2c. No avances sin mi aprobación.
```

## 3. Prompt para cada oleada siguiente

Cuando el líder entregue el plan de la siguiente oleada y lo revises:

```text
Aprobado el plan de la Oleada N. Crea el equipo con los compañeros indicados en docs/EQUIPO.md para esta oleada, usando sus definiciones de .claude/agents/ sin cambiar sus modelos. Mismas reglas de trabajo. Al cerrar, verifica los criterios de aceptación de las fases de la oleada, escribe docs/fases/oleada-N.md y propónme la siguiente.
```

Si quieres cambiar algo del plan, dilo en el mismo mensaje antes de "Aprobado".

## 4. Prompts útiles durante el trabajo

- Ver avance: `Muéstrame el estado de la lista de tareas y qué hace cada compañero.`
- El líder empezó a programar: `Espera a que tus compañeros terminen sus tareas; tú solo coordinas.`
- Revisión extra antes de cerrar una oleada: `Pide a izao-revisor una revisión completa de todo lo hecho en esta oleada contra la especificación y crea tareas para cada hallazgo crítico o alto.`
- Retomar en otra sesión (los compañeros no se restauran al reanudar): `Lee docs/fases/ y la lista de tareas, resume dónde quedamos y vuelve a crear el equipo de la oleada actual para continuar.`

## 5. Modelos (ya configurados, no tienes que pegar nada más)

Cada agente de `.claude/agents/` tiene su modelo en el campo `model`:

| Modelo | Agentes |
|---|---|
| `opus` | Líder (por `claude --model opus`), `izao-db`, `izao-pagos`, `izao-logistica`, `izao-revisor` |
| `sonnet` | `izao-tienda`, `izao-admin`, `izao-agente-windows`, `izao-infra`, `izao-qa` |
| `haiku` | `izao-datos` |

Claude Code usa el modelo de la definición cuando el líder crea el compañero con ese tipo de agente. Para que esto funcione **no** configures `CLAUDE_CODE_SUBAGENT_MODEL_FORCE`. Si algún día quieres bajar costos, cambia `opus` por `sonnet` en `izao-logistica` primero; deja en `opus` a `izao-pagos`, `izao-db` y `izao-revisor`.

Los equipos de agentes son una función experimental de Claude Code; `.claude/settings.json` ya la activa con `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1`. Consumen bastantes más tokens que una sola sesión: por eso el plan limita el equipo a 4 compañeros activos.
