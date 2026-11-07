# token-coach

Mod para Claude Code que ayuda a ahorrar tokens:

- **Banda minimalista sobre el prompt:** % de contexto, tiempo restante del caché, tokens que leerá el próximo mensaje, cuándo se reinicia el límite de 5 h y avisos de `compacta` / `chat nuevo`.
- **Modo director:** con Opus en el chat principal, delega lo mecánico a `token-coach:rapido` (Haiku) y lo intermedio a `token-coach:medio` (Sonnet), revisa su trabajo y entrega una sola respuesta.
- **Panel de agentes:** se abre solo mientras hay agentes trabajando (`/agentes` para abrirlo a mano).

## Instalar

En una sesión de Claude Code en terminal:

```
/plugin install token-coach --marketplace Rafa4You9/token-coach
```

Responde `y` para añadir el marketplace y elige el alcance (usuario). Reinicia Claude Code.

Actualizar a la última versión: `/plugin marketplace update token-coach`.
