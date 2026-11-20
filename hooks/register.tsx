import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import type { DayStats } from '../types'

const lastDoneAt = atom({ plugin: 'token-coach', key: 'lastDoneAt' } as const, 0)
const turns = atom({ plugin: 'token-coach', key: 'turns' } as const, 0)
const ttlMin = atom({ plugin: 'token-coach', key: 'ttlMin' } as const, 60)
const isDirector = atom({ plugin: 'token-coach', key: 'isDirector' } as const, false)
// v0.6: medición del bucle principal (no de los subagentes)
const turnCalls = atom({ plugin: 'token-coach', key: 'turnCalls' } as const, 0)
const turnMech = atom({ plugin: 'token-coach', key: 'turnMech' } as const, 0)
const turnDeleg = atom({ plugin: 'token-coach', key: 'turnDeleg' } as const, 0)
const turnNudgedAt = atom({ plugin: 'token-coach', key: 'turnNudgedAt' } as const, 0)
const turnTools = atom({ plugin: 'token-coach', key: 'turnTools' } as const, {} as Record<string, number>)
const sessCalls = atom({ plugin: 'token-coach', key: 'sessCalls' } as const, 0)
const sessMech = atom({ plugin: 'token-coach', key: 'sessMech' } as const, 0)
const sessRoutine = atom({ plugin: 'token-coach', key: 'sessRoutine' } as const, 0)
const sessDeleg = atom({ plugin: 'token-coach', key: 'sessDeleg' } as const, 0)
// Gasto aproximado por familia de modelo, en "tokens de entrada equivalentes".
const spend = atom({ plugin: 'token-coach', key: 'spend' } as const, {} as Record<string, number>)
// Último turno en que salió cada tipo de tip (para no repetir).
const tipTurn = atom({ plugin: 'token-coach', key: 'tipTurn' } as const, {} as Record<string, number>)
// Cosas vistas al enviar el prompt que se avisan al terminar el turno.
const pending = atom({ plugin: 'token-coach', key: 'pending' } as const, {} as Record<string, number>)

// ---- Paleta suave ----------------------------------------------------------
const C = {
  mint: '#7EE0B5',
  sky: '#7CC7FF',
  lav: '#B8A1FF',
  peach: '#FFB38A',
  pink: '#FF8FB8',
  sun: '#FFD97A',
  mute: '#8C8AA3',
}

const MIN = 60 * 1000
const isFable = (model?: string) => /fable/i.test(model ?? '')
const isOpus = (model?: string) => /opus/i.test(model ?? '') && !isFable(model)
const isSonnet = (model?: string) => /sonnet/i.test(model ?? '')
const family = (model?: string) =>
  isFable(model) ? 'Fable' : isOpus(model) ? 'Opus' : isSonnet(model) ? 'Sonnet' : /haiku/i.test(model ?? '') ? 'Haiku' : 'otro'

// ---- Qué cuenta como trabajo mecánico --------------------------------------
// Herramientas de gestión: no cuentan como trabajo.
const BOOKKEEPING = /^(mcp__ccd_|ToolSearch$|Skill$|SendMessage$|Agent$|Task$|TaskStop$|ReadNotifications$|AskUserQuestion$|EnterPlanMode$|ExitPlanMode$)/
// Leer, buscar y listar: lo que Haiku hace igual.
const READ_TOOLS = /^(Read|Grep|Glob|WebFetch|WebSearch|NotebookRead)$/
const READ_MCP = /(fetch|search|query|list|get|read|view|find|download|page_text|screenshot)/i
const READ_BASH = /^\s*(cd [^;&]+(&&|;)\s*)?(cat|ls|head|tail|grep|rg|find|wc|sed -n|file|stat|du|tree|jq)\b/
// Herramientas de trabajo rutinario (Notion, correo, redes): candidatas a Sonnet o Haiku.
const ROUTINE_MCP = /^(notion-|.*_(thread|threads|message|draft|label)s?$|read_file_content|search_files|get_file_metadata|posts_|accounts_|analytics_|comments_|messages_|getScheduledPosts|createScheduledPost|updateScheduledPost|getAnalytics|COMPOSIO_)/i

const isMechanical = (tool: string, input: any) => {
  if (READ_TOOLS.test(tool)) return true
  if (tool === 'Bash') return READ_BASH.test(String(input?.command ?? ''))
  if (tool.startsWith('mcp__')) return READ_MCP.test(tool.split('__').pop() ?? '')
  return false
}
// Repetir estas es normal al trabajar; la regla de "repetitivo" mira sobre todo Notion, correo y redes.
const NOT_REPEAT = /^(Read|Grep|Glob|Bash|Edit|Write|MultiEdit|NotebookEdit|WebFetch|WebSearch)$/
const shortTool = (tool: string) => (tool.startsWith('mcp__') ? tool.split('__').pop() ?? tool : tool)

// ---- Textos para el modelo --------------------------------------------------
const FABLE_GUARD = `## Aviso de modelo (mod token-coach) — OBLIGATORIO
Esta sesión usa Fable, el modelo más caro. Regla de la casa: Opus es el modelo de trabajo (incluido el draft completo de un Reel); Sonnet para lo mecánico; Fable solo para decisiones creativas atascadas, estrategia o rediseñar un sistema.
- Si lo que pide el usuario es trabajo rutinario (editar un Reel, Notion, emails y marcas, métricas, carruseles, código normal, buscar, leer o resumir), empieza tu respuesta con UNA línea: "💡 Esto lo hace igual Opus (o Sonnet) y gasta mucho menos: cambia el modelo en el selector y repíteme el mensaje."
- Si además es un trabajo grande (más de unas pocas llamadas a herramientas), para ahí y pregunta "¿Sigo en Fable o cambias de modelo?" antes de gastar. Si es pequeño, o el usuario ya dijo que siga en Fable, hazlo sin repetir el aviso.
- No actúes de director ni delegues en subagentes para ahorrar: aquí el ahorro es cambiar de modelo.`

// Los tips medibles (contexto, delegación, gasto) los pone el mod al final del turno sin gastar tokens.
// Aquí solo quedan los que exigen juicio del modelo.
const TIPS = `## Tips de ahorro (mod token-coach)
El mod ya avisa solo de contexto lleno, caché frío, falta de delegación y gasto por modelo. Tú añade al FINAL de tu respuesta una sola línea que empiece por "💡" solo en estos casos (máximo una; no repitas el mismo dos respuestas seguidas):
- El mensaje es una tarea nueva, sin relación con lo hecho en esta sesión, y la sesión ya tiene trabajo → "Tarea nueva: mejor ábrela en una sesión nueva; esta arrastra todo su contexto en cada mensaje."
- Varios Reels o piezas en la misma sesión → "Una pieza por sesión: sale más rápido y más barato."
- Lo que pide es rutinario (Notion, correo, métricas, agendar, leer o resumir) y esta sesión está en Opus → "Esto lo hace igual Sonnet y gasta bastante menos: cambia el modelo en el selector para lo que sigue."
Y tú: no pegues resultados largos en el chat, no releas lo que ya leíste y responde breve.`

const FABLE_NUDGE =
  'Recordatorio del mod token-coach: esta sesión está en Fable (el modelo más caro). Si la tarea es rutinaria, avisa en la primera línea de que Opus o Sonnet la hacen igual; si además es grande, pregunta antes de seguir. No dirijas ni delegues.'

const REPORT = `Al terminar, responde SOLO con este informe (máx. 15 líneas):
HECHO: qué hiciste
RESULTADO: lo encontrado o creado (rutas, IDs de página, URLs; nunca contenidos completos)
FUENTES: para todo dato de la web o de un documento, su URL o ruta y una cita corta literal
VERIFICADO: cómo lo comprobaste, o "no verificado"
DUDAS: lo que no sabes, lo que supusiste y lo que decidiste por tu cuenta
Reglas: nunca inventes datos, cifras, emails, precios, fechas ni URLs; si no lo encuentras, dilo. Si el encargo es ambiguo o falta información, no adivines: haz lo seguro y explícalo en DUDAS.`

const RAPIDO_PROMPT = `Eres "rapido" (Haiku): rápido y literal. Haz exactamente el encargo, sin ampliar el alcance ni tocar nada que no se pida.
Tus puntos fuertes: buscar y leer archivos, extraer datos concretos, resumir, catalogar, listar, renombrar y trabajo repetitivo con un patrón claro (actualizar muchas páginas de Notion iguales, copiar cifras, aplicar el mismo cambio a una lista).
Tus límites, que debes respetar: no juzgas bien la calidad de fuentes ni la actualidad de un dato, y te saltas matices. Por eso:
- busca antes de leer y lee solo las partes necesarias;
- en una lista, haz TODOS los elementos y di al final cuántos hiciste y cuáles fallaron;
- cita siempre la fuente exacta (ruta:línea, ID de página o URL) de cada dato;
- si un dato puede estar desactualizado, ser dudoso o contradecirse entre fuentes, márcalo en DUDAS en vez de elegir tú;
- no tomes decisiones de diseño, tono ni contenido creativo: si el encargo las pide, devuélvelo explicando por qué.

${REPORT}`

const MEDIO_PROMPT = `Eres "medio" (Sonnet): implementador cuidadoso y capaz.
Tus puntos fuertes: escribir y editar código, páginas de Notion, escenas de vídeo y borradores siguiendo un plan; investigar en la web comparando fuentes y comprobando que sean oficiales y recientes.
Tus límites: no cambias el enfoque decidido por el director; si ves un problema en él, sigue lo seguro y explícalo en DUDAS.
Tu encargo debe ser un paso acotado. Si resulta mucho más grande de lo previsto (más de unas 40 llamadas a herramientas) o empieza a exigir decisiones creativas o de enfoque que el plan no resuelve, para en un punto seguro e informa de lo hecho y de lo que falta, en vez de seguir: el director lo repartirá.
Si dentro de tu encargo hay una parte repetitiva y larga (la misma operación 10 o más veces), puedes pasársela a "token-coach:rapido" con la lista y el patrón exactos, y revisar su informe.
Antes de informar, comprueba tu trabajo: ejecuta o valida lo que construiste, relee el diff o la página resultante y confirma el criterio de "terminado". En investigación, prefiere fuentes oficiales y fechadas, y marca lo que no pudiste confirmar.

${REPORT}`

const DIRECTOR = `## Modo director (mod token-coach) — OBLIGATORIO
Eres el director (Opus) y tu contexto es caro: cada llamada que haces tú relee toda la conversación. Por defecto DELEGAS la ejecución; tú pones el criterio y garantizas la calidad final. El mod cuenta tus llamadas y te avisará si haces tú trabajo mecánico.

### Qué haces tú siempre
- Entender el objetivo, decidir el enfoque y dividir el trabajo.
- Las decisiones que exigen criterio: arquitectura, decisiones creativas (gancho, tono, ritmo de un Reel, mensaje a una marca), lo que cuesta dinero o se publica o envía.
- Revisar con criterio cada entrega e integrar el resultado final.
- Tareas cortas (hasta unas 6 llamadas a herramientas en TODO el turno) o conversar sin herramientas: hazlas tú. Si al planear ves que pasarás de 6, delega desde el principio, no a mitad.

### Repetitivo o largo → "rapido" (Haiku), sin excepción
- La misma operación 5 o más veces (actualizar N páginas de Notion, leer N archivos o emails, renombrar, copiar cifras, aplicar un cambio a una lista): no la hagas tú. Prepara la lista completa (IDs, rutas) y el patrón exacto, encárgala a "token-coach:rapido" y revisa su informe con 1-2 muestras.
- Explorar para entender (leer más de 3-4 archivos o páginas): pregúntale a "rapido" lo concreto y pide ruta:línea y un resumen, no el contenido.
- Si cada elemento exige criterio propio (redactar, decidir), es de "medio", no de "rapido".

### A quién delegar
"token-coach:rapido" (Haiku): el más barato, literal, poco criterio. Primera opción para leer, extraer y repetir.
- SÍ: buscar y leer archivos; leer, listar o extraer datos de Notion, emails o documentos; resumir o catalogar material; transcribir; renombrar; cambios repetitivos con patrón claro; búsqueda web mecánica (abrir una URL conocida, encontrar un dato puntual y verificable).
- NO: investigación web con criterio, comparar fuentes, nada creativo, nada que se publique o envíe, ediciones con decisiones.

"token-coach:medio" (Sonnet): capaz y cuidadoso, para UN paso acotado de tu plan.
- SÍ: implementar un paso concreto de código o edición con el plan ya decidido; crear o editar páginas de Notion y borradores; montar una escena o un bloque de vídeo; investigación web con criterio (novedades, tendencias, marcas, precios: fuentes oficiales y fechadas); refactors acotados.
- NO: una pieza entera (un Reel completo, una skill completa, una auditoría), decidir el enfoque, arquitectura, la decisión creativa final, bugs raros sin pista.
- Tamaño: un encargo a "medio" debe caber en unas 40 llamadas a herramientas. Si es más grande, pártelo en varios encargos seguidos o paralelos con archivos distintos.

Lo difícil (una pieza completa, una auditoría, un bug sin pista, una tarea larga con muchas decisiones) no se delega a "medio": hazlo tú, o pártelo en pasos acotados y delega solo esos pasos.
Ante la duda entre "rapido" y "medio": si hay un patrón claro y comprobable, "rapido"; si hay que decidir, "medio".

### Cómo encargar
Objetivo, contexto mínimo necesario, rutas/IDs/URLs exactos, qué NO tocar y criterio de "terminado" claro y comprobable. Lanza en paralelo los encargos independientes en un solo mensaje; dos agentes nunca editan lo mismo.

### Revisión con criterio (siempre, antes de dar nada por bueno)
1. ¿Cumple el criterio de "terminado" y el objetivo real del usuario, no solo la letra del encargo?
2. Comprueba tú lo crítico, sin rehacer el trabajo: abre el diff o el archivo, ejecuta o valida, mira la página creada, abre 1-2 URLs citadas para confirmar datos clave. Desconfía de cifras, fechas, emails y precios sin fuente.
3. Lee DUDAS: resuelve tú lo que exige criterio.
4. Si falta calidad, escribe al MISMO agente con SendMessage: qué falla, por qué y qué esperas exactamente. Repite hasta que esté al nivel (máx. 3 rondas).
5. Si Haiku falla dos veces en lo mismo, reencarga a "medio". Si Sonnet falla dos veces, hazlo tú.
Nunca entregues al usuario algo que no hayas revisado. Si algo no pudiste verificar, díselo.

### Ahorro
No releas lo que ya leíste, no pegues resultados largos en el chat, pide a los agentes rutas e IDs en vez de contenidos y responde al usuario de forma breve.`

const SONNET_MODE = `## Modo ahorro en Sonnet (mod token-coach)
Trabajas tú, pero lo repetitivo y largo va a "token-coach:rapido" (Haiku, mucho más barato):
- La misma operación 5 o más veces (actualizar N páginas de Notion, leer N archivos o emails, renombrar, copiar cifras): prepara la lista completa (IDs, rutas) y el patrón exacto, encárgala a "rapido" y revisa su informe con 1-2 muestras.
- Lo corto, lo que exige criterio y lo que se publica o envía lo haces tú.`

const DIRECTOR_NUDGE =
  'Recordatorio del mod token-coach: aplica el Modo director. Lo corto (hasta unas 6 llamadas en todo el turno) hazlo tú. Lo repetitivo (la misma operación 5+ veces) y las lecturas largas van a rapido (Haiku) con lista y patrón; los pasos acotados con criterio, a medio (Sonnet); lo difícil hazlo tú o pártelo. Revisa cada entrega.'

// Aviso a mitad de turno, pegado al resultado de la herramienta: el modelo lo lee antes de su siguiente paso.
const midTurnNudge = (opus: boolean, mech: number, tool?: { name: string; n: number }) =>
  tool
    ? `token-coach: ya llevas ${tool.n} llamadas a ${shortTool(tool.name)} en este turno. Es trabajo repetitivo: no sigas tú. Pásale el resto a token-coach:rapido de una vez (lista completa de IDs o rutas + el cambio exacto) y revisa su informe con 1-2 muestras.`
    : `token-coach: en este turno llevas ${mech} llamadas de leer, buscar o extraer hechas por ti (${opus ? 'Opus' : 'Sonnet'}) y ninguna delegada. Lo que falte de ese tipo encárgalo ahora a token-coach:rapido (Haiku)${opus ? ', o a token-coach:medio si exige criterio' : ''}, pidiendo rutas, IDs y un resumen. Sigue tú solo con lo que exige criterio.`

// ---- Utilidades -------------------------------------------------------------
const k = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(n >= 100000 ? 0 : 1)}k` : `${n}`)
const mmss = (ms: number) => {
  const s = Math.max(0, Math.round(ms / 1000))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}
const untilText = (ms: number) => {
  const m = Math.max(0, Math.round(ms / 60000))
  return m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}m`
}
const heat = (pct: number) => (pct < 50 ? C.mint : pct < 75 ? C.sun : pct < 90 ? C.peach : C.pink)
const day = (t: number) => new Date(t).toISOString().slice(0, 10)
// Precio relativo aproximado de cada tipo de token frente a uno de entrada normal.
const weight = (u: any) =>
  (u?.input_tokens ?? 0) +
  1.25 * (u?.cache_creation_input_tokens ?? 0) +
  0.1 * (u?.cache_read_input_tokens ?? 0) +
  5 * (u?.output_tokens ?? 0)
// Peso relativo de cada familia (Opus como referencia = 1). Aproximado, solo para repartir porcentajes.
const PRICE: Record<string, number> = { Fable: 2, Opus: 1, Sonnet: 0.6, Haiku: 0.2, otro: 0.6 }

let submitAt = 0

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.agent.register({
      name: 'rapido',
      description: 'Haiku, esfuerzo bajo: buscar y leer archivos, extraer datos de Notion/emails/documentos, resumir, catalogar y trabajo repetitivo con patrón claro (la misma operación muchas veces) y búsquedas web puntuales',
      prompt: RAPIDO_PROMPT,
      model: 'claude-haiku-5-5',
      effort: 'low',
    })
    await $.agent.register({
      name: 'medio',
      description: 'Sonnet, esfuerzo medio: implementar siguiendo un plan (código, Notion, vídeo, borradores) e investigación web con criterio',
      prompt: MEDIO_PROMPT,
      model: 'claude-sonnet-5-5',
      effort: 'medium',
    })
    // Redibuja la banda para que el contador del caché avance.
    $.clock.every(5000, () => $.ui.invalidate('ui.render'))
    return next(e)
  })

  // Reglas fijas en el system prompt del chat principal.
  on('prompt.compose', async ($, e, next) => {
    const res = await next(e)
    const tips = { id: 'token-coach:tips', text: TIPS, scope: 'session' as const }
    if (isFable(e.model) || isFable(e.promptModel)) {
      await update($, isDirector, () => false)
      return { sections: [...res.sections, { id: 'token-coach:modelo', text: FABLE_GUARD, scope: 'session' as const }, tips] }
    }
    const hasAgent = e.tools.includes('Agent')
    if ((isOpus(e.model) || isOpus(e.promptModel)) && hasAgent) {
      await update($, isDirector, () => true)
      return { sections: [...res.sections, { id: 'token-coach:director', text: DIRECTOR, scope: 'session' as const }, tips] }
    }
    await update($, isDirector, () => false)
    if ((isSonnet(e.model) || isSonnet(e.promptModel)) && hasAgent)
      return { sections: [...res.sections, { id: 'token-coach:sonnet', text: SONNET_MODE, scope: 'session' as const }, tips] }
    return { sections: [...res.sections, tips] }
  })

  // Recordatorio corto en cada prompt + lo que se avisará al final del turno.
  on('prompt.submit', async ($, e, next) => {
    submitAt = await $.clock.now()
    if (e.command || e.isMeta) return next(e)
    const model = await $.session.model()
    const extra: string[] = []
    if (isFable(model)) extra.push(FABLE_NUDGE)
    else if (isOpus(model)) extra.push(DIRECTOR_NUDGE)
    try {
      const raw = await $.session.usage()
      const tokens = raw.context?.tokens ?? 0
      const done = await read($, lastDoneAt)
      const ttl = await read($, ttlMin)
      const cold = done > 0 && submitAt - done > ttl * MIN
      const p: Record<string, number> = {}
      if (cold && tokens > 60000) p.cold = tokens
      if ((e.text ?? '').length > 6000) p.pasted = e.text.length
      await update($, pending, () => p)
    } catch {}
    if (!extra.length) return next(e)
    return next({ ...e, context: [...(e.context ?? []), ...extra] })
  })

  // Cada turno del bucle principal empieza con los contadores a cero.
  on('turn.start', async ($, e, next) => {
    if (!e.agentId) {
      await update($, turnCalls, () => 0)
      await update($, turnMech, () => 0)
      await update($, turnDeleg, () => 0)
      await update($, turnNudgedAt, () => 0)
      await update($, turnTools, () => ({}))
    }
    return next(e)
  })

  // Cuenta cada llamada del bucle principal y, si hace trabajo mecánico sin delegar, se lo dice al modelo a mitad de turno.
  on('tool.call', async ($, e, next) => {
    if (e.agentId) return next(e)
    const tool = String(e.tool)
    if (tool === 'Agent' || tool === 'Task') {
      await update($, turnDeleg, n => n + 1)
      await update($, sessDeleg, n => n + 1)
      return next(e)
    }
    if (BOOKKEEPING.test(tool)) return next(e)

    const mech = isMechanical(tool, e)
    await update($, turnCalls, n => n + 1)
    await update($, sessCalls, n => n + 1)
    const tools = await update($, turnTools, m => ({ ...m, [tool]: (m[tool] ?? 0) + 1 }))
    const m = mech ? await update($, turnMech, n => n + 1) : await read($, turnMech)
    if (mech) await update($, sessMech, n => n + 1)
    if (mech || (tool.startsWith('mcp__') && ROUTINE_MCP.test(tool.split('__').pop() ?? ''))) await update($, sessRoutine, n => n + 1)

    const ran = await next(e)
    if ('deny' in ran && ran.deny !== undefined) return ran
    try {
      const model = await $.session.model()
      const lead = isOpus(model) || isSonnet(model)
      if (!lead || (await read($, turnDeleg)) > 0) return ran
      const same = tools[tool] ?? 0
      const nudged = await read($, turnNudgedAt)
      let msg: string | null = null
      if (!NOT_REPEAT.test(tool) && (same === 5 || same === 12)) msg = midTurnNudge(isOpus(model), m, { name: tool, n: same })
      else if (mech && m >= 8 && m - nudged >= 8) msg = midTurnNudge(isOpus(model), m)
      if (!msg) return ran
      await update($, turnNudgedAt, () => m)
      return { ...ran, context: [...(ran.context ?? []), msg] }
    } catch {
      return ran
    }
  })

  on('turn.complete', async ($, e, next) => {
    const res = await next(e)
    try {
      // Gasto por familia de modelo, del bucle principal y de cada subagente.
      if (e.usage) {
        const fam = family(e.usage.model)
        const w = weight(e.usage) * (PRICE[fam] ?? 1)
        await update($, spend, s => ({ ...s, [fam]: (s[fam] ?? 0) + w }))
      }
      if (e.agentId) return res

      const t = await $.clock.now()
      // Aprende la duración real del caché: tras una pausa de más de 5 min,
      // si el modelo aún leyó del caché, este dura 1 h; si no, 5 min.
      const prev = await read($, lastDoneAt)
      const gap = submitAt - prev
      if (prev > 0 && submitAt > 0 && gap > 5 * MIN && gap < 60 * MIN && e.usage) {
        const hit = e.usage.cache_read_input_tokens > 2000
        await update($, ttlMin, () => (hit ? 60 : 5))
      }
      await update($, lastDoneAt, () => t)
      const n = await update($, turns, x => x + 1)
      if (e.isAborted) return res

      const model = e.usage?.model ?? (await $.session.model())
      const calls = await read($, turnCalls)
      const mech = await read($, turnMech)
      const deleg = await read($, turnDeleg)
      const tools = await read($, turnTools)
      const top = Object.entries(tools).filter(([name]) => !NOT_REPEAT.test(name)).sort((a, b) => b[1] - a[1])[0]

      // Estadística entre sesiones (últimos 14 días) para el resumen semanal.
      const days = ((await $.store.get('days')) as Record<string, DayStats> | undefined) ?? {}
      const today = day(t)
      const d = days[today] ?? { big: 0, bigNoDeleg: 0, opusTurns: 0 }
      if (isOpus(model)) {
        d.opusTurns++
        if (calls >= 10) {
          d.big++
          if (deleg === 0) d.bigNoDeleg++
        }
      }
      days[today] = d
      for (const key of Object.keys(days)) if (Date.parse(key) < t - 14 * 24 * 60 * MIN) delete days[key]
      await $.store.set('days', days)

      const tip = await pickTip($, { n, t, model, calls, mech, deleg, top, days, today })
      if (tip) {
        await update($, tipTurn, s => ({ ...s, [tip.kind]: n }))
        await $.session.append({ message: { type: 'system', content: [{ type: 'text', text: `💡 token-coach · ${tip.text}` }] } })
      }
    } catch {}
    return res
  })

  // ---- Banda encima del prompt: una sola fila --------------------------------
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)

    const raw = await $.session.usage()
    const model = await $.session.model()
    const five = raw.rateLimits?.find((r: any) => r.kind === 'five_hour')
    const percent = raw.context?.percent ?? 0
    const tokens = raw.context?.tokens ?? 0
    const t = await $.clock.now()

    const { Box, Text } = $.ui.resolve(e)
    const done = await read($, lastDoneAt)
    const n = await read($, turns)
    const ttl = await read($, ttlMin)
    const calls = await read($, sessCalls)
    const s = await read($, spend)
    const total = Object.values(s).reduce((a, b) => a + b, 0)
    const lead = family(model)
    const helped = total > 0 ? Math.round((100 * (total - (s[lead] ?? 0))) / total) : 0

    const left = ttl * MIN - (t - done)
    const isWarm = done > 0 && left > 0

    let tip: { word: string; color: string } | null = null
    if (percent >= 85 || (percent >= 70 && n > 40)) tip = { word: 'chat nuevo', color: C.pink }
    else if (percent >= 65) tip = { word: 'compacta', color: C.peach }
    else if (done > 0 && !isWarm && tokens > 60000) tip = { word: 'compacta antes', color: C.sky }

    const showHelp = (isOpus(model) || isSonnet(model)) && calls >= 6
    const helpColor = helped >= 20 ? C.mint : helped >= 5 ? C.sun : C.pink

    return (
      <Box flexDirection="row" paddingX={1} gap={2}>
        <Text color={heat(percent)}>contexto {Math.round(percent)}%</Text>
        <Text color={isWarm || !done ? C.mint : C.sky}>
          {isWarm ? `caché ● ${mmss(left)}` : done ? 'caché ❄ frío' : 'caché ○'}
        </Text>
        <Text color={C.mute}>envía ~{k(tokens)} tok</Text>
        {five?.resetsAt && (
          <Text color={C.sky}>reinicio en {untilText(Date.parse(five.resetsAt) - t)}</Text>
        )}
        {showHelp && <Text color={helpColor}>delegado {helped}%</Text>}
        {isFable(model) && <Text color={C.pink}>Fable: ¿hace falta? Opus gasta menos</Text>}
        {tip && <Text color={tip.color}>{tip.word}</Text>}
      </Box>
    )
  })
}

// ---- Tips al usuario al final del turno -------------------------------------
// Salen como aviso en el chat: el usuario los ve y el modelo no los lee (no gastan tokens).
type TipCtx = {
  n: number
  t: number
  model: string
  calls: number
  mech: number
  deleg: number
  top?: [string, number]
  days: Record<string, DayStats>
  today: string
}

async function pickTip($: any, c: TipCtx): Promise<{ kind: string; text: string } | null> {
  const last = await read($, tipTurn)
  // Cada tipo de tip descansa unos turnos; "once" = una vez por sesión.
  const ok = (kind: string, cooldown: number | 'once') =>
    last[kind] === undefined || (cooldown !== 'once' && c.n - last[kind] >= cooldown)
  const opus = isOpus(c.model)
  const sonnet = isSonnet(c.model)
  const p = await read($, pending)
  const raw = await $.session.usage()
  const percent = raw.context?.percent ?? 0
  const ctxTokens = raw.context?.tokens ?? 0

  // 1. Contexto muy lleno
  if (percent >= 85 && ok('full', 4))
    return { kind: 'full', text: `El contexto está al ${Math.round(percent)}%: abre una sesión nueva para lo siguiente. Cada mensaje aquí relee ~${k(ctxTokens)} tokens.` }
  if (percent >= 65 && percent < 85 && ok('compact', 6))
    return { kind: 'compact', text: `El contexto está al ${Math.round(percent)}%: escribe /compact antes de seguir (o abre una sesión nueva si cambias de tema).` }

  // 2. Trabajo repetitivo hecho por el modelo caro
  if ((opus || sonnet) && c.deleg === 0 && c.top && c.top[1] >= 6 && ok('repeat', 3))
    return {
      kind: 'repeat',
      text: `${c.top[1]}× ${shortTool(c.top[0])} en ${family(c.model)} este turno. Para lo repetitivo dile «pásaselo a Haiku (rapido) con la lista»: Haiku lo hace igual por una fracción.`,
    }

  // 3. Turno grande sin delegar
  if (opus && c.calls >= 10 && c.deleg === 0 && ok('nodeleg', 3))
    return {
      kind: 'nodeleg',
      text: `Este turno: ${c.calls} llamadas hechas por Opus y 0 delegadas (${c.mech} de leer o buscar). Lo mecánico lo hace Haiku y los pasos claros Sonnet; pídele «delega lo mecánico».`,
    }

  // 4. Sesión de trabajo rutinario en Opus
  const sc = await read($, sessCalls)
  const routine = await read($, sessRoutine)
  if (opus && c.n >= 3 && sc >= 20 && routine / sc >= 0.7 && ok('routine', 'once'))
    return {
      kind: 'routine',
      text: `El ${Math.round((100 * routine) / sc)}% de esta sesión es leer o tocar Notion, correo y redes. Eso lo hace igual Sonnet gastando bastante menos: cambia el modelo en el selector para lo que sigue.`,
    }

  // 5. Caché frío con contexto grande
  if (p.cold && ok('cold', 4))
    return { kind: 'cold', text: `Pasó tiempo y este mensaje releyó ~${k(p.cold)} tokens sin caché. Para un tema nuevo, una sesión nueva sale mucho más barata; para seguir, /compact primero.` }

  // 6. Texto largo pegado
  if (p.pasted && ok('pasted', 3))
    return { kind: 'pasted', text: `Pegaste ~${k(p.pasted)} caracteres: se releen en cada mensaje. La próxima vez pásame la ruta o el enlace.` }

  // 7. Reparto del gasto: casi todo en el modelo caro
  const s = await read($, spend)
  const total = Object.values(s).reduce((a: number, b: number) => a + b, 0)
  const sessDelegN = await read($, sessDeleg)
  if (opus && sc >= 30 && total > 0 && ok('split', 10)) {
    const opusPct = Math.round((100 * (s.Opus ?? 0)) / total)
    if (opusPct >= 90)
      return {
        kind: 'split',
        text: `El ${opusPct}% del gasto de esta sesión es Opus (${sc} llamadas, ${sessDelegN} encargos a subagentes). Lo mecánico debería ir a Haiku y los pasos claros a Sonnet.`,
      }
  }

  // 8. Contexto fijo grande al empezar
  if (c.n === 1 && ctxTokens >= 60000 && ok('base', 'once')) {
    const shown = await $.store.get('baseTipDay')
    if (shown !== c.today) {
      await $.store.set('baseTipDay', c.today)
      return { kind: 'base', text: `Esta sesión arrancó con ~${k(ctxTokens)} tokens antes de tu primer mensaje (skills, conectores, instrucciones). Apagar plugins y conectores que no usas lo baja en todas las sesiones.` }
    }
  }

  // 9. Resumen de la semana, una vez al día
  if (c.n === 1 && ok('week', 'once')) {
    const shown = await $.store.get('weekTipDay')
    const big = Object.values(c.days).reduce((a, d) => a + d.big, 0)
    const noDeleg = Object.values(c.days).reduce((a, d) => a + d.bigNoDeleg, 0)
    if (shown !== c.today && big >= 5) {
      await $.store.set('weekTipDay', c.today)
      return {
        kind: 'week',
        text: `Últimos 14 días: ${noDeleg} de ${big} turnos grandes en Opus (10+ llamadas) sin delegar nada${noDeleg / big > 0.4 ? '. Ahí está el mayor ahorro: lo mecánico a Haiku' : '. Vas bien'}.`,
      }
    }
  }
  return null
}
