# token-coach

Mod para Claude Code que ayuda a ahorrar tokens:

- **Banda minimalista sobre el prompt:** % de contexto, tiempo restante del caché, tokens que leerá el próximo mensaje, cuándo se reinicia el límite de 5 h y avisos de `compacta` / `chat nuevo`.
- **Modo director:** con Opus o Fable en el chat principal, delega lo mecánico a `token-coach:rapido` (Haiku) y los pasos acotados a `token-coach:medio` (Sonnet, máx. unas 40 llamadas por encargo); con Fable, lo difícil va a `token-coach:experto` (Opus). Lo corto (hasta unas 6 llamadas) lo hace el director. Revisa cada entrega y entrega una sola respuesta. La banda muestra `director ✓` cuando está activo.

## Instalar

En una sesión de Claude Code en terminal:

```
/plugin install token-coach --marketplace Rafa4You9/token-coach
```

Responde `y` para añadir el marketplace y elige el alcance (usuario). Reinicia Claude Code.

Actualizar a la última versión: `/plugin marketplace update token-coach`.
