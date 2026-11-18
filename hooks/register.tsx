import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

const lastDoneAt = atom({ plugin: 'token-coach', key: 'lastDoneAt' } as const, 0)
const turns = atom({ plugin: 'token-coach', key: 'turns' } as const, 0)
const ttlMin = atom({ plugin: 'token-coach', key: 'ttlMin' } as const, 60)
const isDirector = atom({ plugin: 'token-coach', key: 'isDirector' } as const, false)

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
// Solo Opus dirige. Fable ya no dirige ni delega: recibe un aviso para cambiar de modelo.
const isLeadModel = (model?: string) => /opus/i.test(model ?? '') && !isFable(model)

// ---- Aviso de modelo y tips de ahorro ---------------------------------------
const FABLE_GUARD = `## Aviso de modelo (mod token-coach) — OBLIGATORIO
Esta sesión usa Fable, el modelo más caro. Regla de la casa: Opus es el modelo de trabajo (incluido el draft completo de un Reel); Sonnet para lo mecánico; Fable solo para decisiones creativas atascadas, estrategia o rediseñar un sistema.
- Si lo que pide el usuario es trabajo rutinario (editar un Reel, Notion, emails y marcas, métricas, carruseles, código normal, buscar, leer o resumir), empieza tu respuesta con UNA línea: "💡 Esto lo hace igual Opus (o Sonnet) y gasta mucho menos: cambia el modelo en el selector y repíteme el mensaje."
- Si además es un trabajo grande (más de unas pocas llamadas a herramientas), para ahí y pregunta "¿Sigo en Fable o cambias de modelo?" antes de gastar. Si es pequeño, o el usuario ya dijo que siga en Fable, hazlo sin repetir el aviso.
- No actúes de director ni delegues en subagentes para ahorrar: aquí el ahorro es cambiar de modelo.`

const TIPS = `## Tips de ahorro (mod token-coach)
Cuando aplique, añade al FINAL de tu respuesta una sola línea que empiece por "💡" (máximo una por respuesta; no repitas el mismo tip dos respuestas seguidas):
- El mensaje es una tarea nueva, sin relación con lo hecho en esta sesión, y la sesión ya tiene trabajo → "Tarea nueva: mejor ábrela en una sesión nueva; esta arrastra todo su contexto en cada mensaje."
- El usuario pega textos o resultados muy largos → "Pásame la ruta o el enlace en vez de pegar el texto: gasta menos."
- Varios Reels o piezas en la misma sesión → "Una pieza por sesión: sale más rápido y más barato."
Y tú: no pegues resultados largos en el chat, no releas lo que ya leíste y responde breve.`

const FABLE_NUDGE =
  'Recordatorio del mod token-coach: esta sesión está en Fable (el modelo más caro). Si la tarea es rutinaria, avisa en la primera línea de que Opus o Sonnet la hacen igual; si además es grande, pregunta antes de seguir. No dirijas ni delegues.'

const contextTip = (percent: number, n: number) =>
  percent >= 85 || (percent >= 70 && n > 40)
    ? `Aviso del mod token-coach: el contexto está al ${Math.round(percent)}%. Termina tu respuesta con la línea "💡 Esta sesión está muy llena: abre una sesión nueva para lo siguiente."`
    : percent >= 65
      ? `Aviso del mod token-coach: el contexto está al ${Math.round(percent)}%. Termina tu respuesta con la línea "💡 La sesión se está alargando: escribe /compact antes de seguir."`
      : null

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

// ---- Equipo: Opus dirige; Sonnet y Haiku ejecutan. Fable no dirige (v0.5.0) --------------------------
const REPORT = `Al terminar, responde SOLO con este informe (máx. 15 líneas):
HECHO: qué hiciste
RESULTADO: lo encontrado o creado (rutas, IDs de página, URLs; nunca contenidos completos)
FUENTES: para todo dato de la web o de un documento, su URL o ruta y una cita corta literal
VERIFICADO: cómo lo comprobaste, o "no verificado"
DUDAS: lo que no sabes, lo que supusiste y lo que decidiste por tu cuenta
Reglas: nunca inventes datos, cifras, emails, precios, fechas ni URLs; si no lo encuentras, dilo. Si el encargo es ambiguo o falta información, no adivines: haz lo seguro y explícalo en DUDAS.`

const RAPIDO_PROMPT = `Eres "rapido" (Haiku): rápido y literal. Haz exactamente el encargo, sin ampliar el alcance ni tocar nada que no se pida.
Tus puntos fuertes: buscar y leer archivos, extraer datos concretos, resumir, catalogar, listar, renombrar y cambios repetitivos con un patrón claro.
Tus límites, que debes respetar: no juzgas bien la calidad de fuentes ni la actualidad de un dato, y te saltas matices. Por eso:
- busca antes de leer y lee solo las partes necesarias;
- cita siempre la fuente exacta (ruta:línea, ID de página o URL) de cada dato;
- si un dato puede estar desactualizado, ser dudoso o contradecirse entre fuentes, márcalo en DUDAS en vez de elegir tú;
- no tomes decisiones de diseño, tono ni contenido creativo: si el encargo las pide, devuélvelo explicando por qué.

${REPORT}`

const MEDIO_PROMPT = `Eres "medio" (Sonnet): implementador cuidadoso y capaz.
Tus puntos fuertes: escribir y editar código, páginas de Notion, escenas de vídeo y borradores siguiendo un plan; investigar en la web comparando fuentes y comprobando que sean oficiales y recientes.
Tus límites: no cambias el enfoque decidido por el director; si ves un problema en él, sigue lo seguro y explícalo en DUDAS.
Tu encargo debe ser un paso acotado. Si resulta mucho más grande de lo previsto (más de unas 40 llamadas a herramientas) o empieza a exigir decisiones creativas o de enfoque que el plan no resuelve, para en un punto seguro e informa de lo hecho y de lo que falta, en vez de seguir: el director lo repartirá.
Antes de informar, comprueba tu trabajo: ejecuta o valida lo que construiste, relee el diff o la página resultante y confirma el criterio de "terminado". En investigación, prefiere fuentes oficiales y fechadas, y marca lo que no pudiste confirmar.

${REPORT}`

const EXPERTO_PROMPT = `Eres "experto" (Opus): recibes los encargos difíciles que el director no quiere dejar a un modelo menor: montar o rehacer una pieza completa (un Reel, una skill, una app), auditar un trabajo, depurar un fallo sin pista clara, o cualquier tarea larga con decisiones propias.
Tienes criterio y puedes decidir cómo hacerlo dentro del objetivo y las reglas del encargo. La decisión creativa final (gancho, tono, mensaje) y todo lo que se publica, se envía o cuesta dinero siguen siendo del director: propón y explica, no lo des por cerrado.
Antes de informar, comprueba tu trabajo de verdad: ejecuta, renderiza o valida lo que construiste y confirma el criterio de "terminado". Di con claridad qué quedó sin verificar.

${REPORT}`

type Lead = 'Fable' | 'Opus'
const leadOf = (...models: (string | undefined)[]): Lead =>
  models.some(m => /fable/i.test(m ?? '')) ? 'Fable' : 'Opus'

const orchestration = (lead: Lead) => `## Modo director (mod token-coach) — OBLIGATORIO
Eres el director (${lead}) y tu contexto es caro. Por defecto DELEGAS la ejecución; tú pones el criterio y garantizas la calidad final.

### Qué haces tú siempre
- Entender el objetivo, decidir el enfoque y dividir el trabajo.
- Las decisiones que exigen criterio: arquitectura, decisiones creativas (gancho, tono, ritmo de un Reel, mensaje a una marca), lo que cuesta dinero o se publica o envía.
- Revisar con criterio cada entrega e integrar el resultado final.
- Tareas cortas (hasta unas 6 llamadas a herramientas) o conversar sin herramientas: hazlas tú. Cada subagente arranca leyendo decenas de miles de tokens, así que delegar algo pequeño cuesta más que hacerlo.

### A quién delegar
"token-coach:rapido" (Haiku): unas 20 veces más barato que Sonnet, literal, poco criterio. Es la primera opción para leer y extraer.
- SÍ: buscar y leer archivos; leer, listar o extraer datos de Notion, emails o documentos; resumir o catalogar material; transcribir; renombrar; cambios repetitivos con patrón claro; búsqueda web mecánica (abrir una URL conocida, encontrar un dato puntual y verificable).
- NO: investigación web con criterio, comparar fuentes, nada creativo, nada que se publique o envíe, ediciones con decisiones.

"token-coach:medio" (Sonnet): capaz y cuidadoso, para UN paso acotado de tu plan.
- SÍ: implementar un paso concreto de código o edición con el plan ya decidido; crear o editar páginas de Notion y borradores; montar una escena o un bloque de vídeo; investigación web con criterio (novedades, tendencias, marcas, precios: fuentes oficiales y fechadas); refactors acotados.
- NO: una pieza entera (un Reel completo, una skill completa, una auditoría), decidir el enfoque, arquitectura, la decisión creativa final, bugs raros sin pista.
- Tamaño: un encargo a "medio" debe caber en unas 40 llamadas a herramientas. Si es más grande, pártelo en varios encargos seguidos o paralelos con archivos distintos; un subagente muy largo relee todo su contexto en cada paso y deja de ahorrar.
${
  lead === 'Fable'
    ? `
"token-coach:experto" (Opus): la mitad de caro que tú y con criterio propio. Es para lo difícil que no debe ir a Sonnet.
- SÍ: montar o rehacer una pieza completa (un Reel, una skill, una app) a partir de tus decisiones; auditar o revisar a fondo un trabajo; depurar un fallo sin pista clara; tareas largas con muchas decisiones pequeñas.
- NO: lo mecánico (va a "rapido") ni los pasos acotados y claros (van a "medio"); la decisión creativa final sigue siendo tuya.

Ante la duda entre "rapido" y "medio", elige "medio". Ante la duda entre "medio" y "experto", elige "experto": rehacer un trabajo flojo de Sonnet sale más caro que la diferencia de precio.`
    : `
Lo difícil (una pieza completa, una auditoría, un bug sin pista, una tarea larga con muchas decisiones) no se delega a "medio": hazlo tú, o pártelo en pasos acotados y delega solo esos pasos. No uses "token-coach:experto": es Opus, igual que tú.

Ante la duda entre "rapido" y "medio", elige "medio": un error de Haiku sale más caro de arreglar que la diferencia de precio.`
}

### Cómo encargar
Objetivo, contexto mínimo necesario, rutas/IDs/URLs exactos, qué NO tocar y criterio de "terminado" claro y comprobable. Lanza en paralelo los encargos independientes en un solo mensaje; dos agentes nunca editan lo mismo.

### Revisión con criterio (siempre, antes de dar nada por bueno)
1. ¿Cumple el criterio de "terminado" y el objetivo real del usuario, no solo la letra del encargo?
2. Comprueba tú lo crítico, sin rehacer el trabajo: abre el diff o el archivo, ejecuta o valida, mira la página creada, abre 1-2 URLs citadas para confirmar datos clave. Desconfía de cifras, fechas, emails y precios sin fuente.
3. Lee DUDAS: resuelve tú lo que exige criterio.
4. Si falta calidad, escribe al MISMO agente con SendMessage: qué falla, por qué y qué esperas exactamente. Repite hasta que esté al nivel (máx. 3 rondas).
5. Si Haiku falla dos veces en lo mismo, reencarga a "medio". Si Sonnet falla dos veces, ${lead === 'Fable' ? 'reencarga a "experto" o hazlo tú' : 'hazlo tú'}.
Nunca entregues al usuario algo que no hayas revisado. Si algo no pudiste verificar, díselo.

### Ahorro
No releas lo que ya leíste, no pegues resultados largos en el chat, pide a los agentes rutas e IDs en vez de contenidos y responde al usuario de forma breve.`

const nudge = (lead: Lead) =>
  `Recordatorio del mod token-coach: aplica el Modo director. Lo corto (hasta unas 6 llamadas a herramientas) hazlo tú. Lo demás repártelo: rapido = Haiku, leer y extraer; medio = Sonnet, un paso acotado del plan (máx. unas 40 llamadas)${
    lead === 'Fable'
      ? '; experto = Opus, piezas completas, auditorías y bugs difíciles'
      : '; lo difícil hazlo tú o pártelo en pasos'
  }. Revisa cada entrega antes de darla por buena.`

let submitAt = 0

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.agent.register({
      name: 'rapido',
      description: 'Haiku, esfuerzo bajo: buscar y leer archivos, extraer datos de Notion/emails/documentos, resumir, catalogar, cambios repetitivos y búsquedas web puntuales',
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

  // Regla fija en el system prompt del chat principal (Opus/Fable con Agent).
  on('prompt.compose', async ($, e, next) => {
    const res = await next(e)
    const tips = { id: 'token-coach:tips', text: TIPS, scope: 'session' as const }
    if (isFable(e.model) || isFable(e.promptModel)) {
      await update($, isDirector, () => false)
      return { sections: [...res.sections, { id: 'token-coach:modelo', text: FABLE_GUARD, scope: 'session' as const }, tips] }
    }
    const isLead = (isLeadModel(e.model) || isLeadModel(e.promptModel)) && e.tools.includes('Agent')
    if (!isLead) return { sections: [...res.sections, tips] }
    await update($, isDirector, () => true)
    return {
      sections: [...res.sections, { id: 'token-coach:director', text: orchestration('Opus'), scope: 'session' as const }, tips],
    }
  })

  // Recordatorio corto e invisible en cada prompt: es lo que hace que delegue sin pedírselo.
  on('prompt.submit', async ($, e, next) => {
    submitAt = await $.clock.now()
    if (e.command || e.isMeta) return next(e)
    const model = await $.session.model()
    const extra: string[] = []
    if (isFable(model)) extra.push(FABLE_NUDGE)
    else if (isLeadModel(model)) extra.push(nudge('Opus'))
    try {
      const raw = await $.session.usage()
      const tip = contextTip(raw.context?.percent ?? 0, await read($, turns))
      if (tip) extra.push(tip)
    } catch {}
    if (!extra.length) return next(e)
    return next({ ...e, context: [...(e.context ?? []), ...extra] })
  })

  on('turn.complete', async ($, e, next) => {
    if (!e.agentId) {
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
      await update($, turns, n => n + 1)
    }
    return next(e)
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
    const director = (await read($, isDirector)) && isLeadModel(model)

    const left = ttl * MIN - (t - done)
    const isWarm = done > 0 && left > 0

    let tip: { word: string; color: string } | null = null
    if (percent >= 85 || (percent >= 70 && n > 40)) tip = { word: 'chat nuevo', color: C.pink }
    else if (percent >= 65) tip = { word: 'compacta', color: C.peach }
    else if (done > 0 && !isWarm && tokens > 60000) tip = { word: 'compacta antes', color: C.sky }

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
        {director && <Text color={C.lav}>director ✓</Text>}
        {isFable(model) && <Text color={C.pink}>Fable: ¿hace falta? Opus gasta menos</Text>}
        {tip && <Text color={tip.color}>{tip.word}</Text>}
      </Box>
    )
  })
}
