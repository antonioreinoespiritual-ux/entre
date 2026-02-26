# entre

Aplicación migrada para usar **backend propio con SQLite (mysqlite)** en lugar de Supabase.

## 1) Variables de entorno

```bash
cp .env.example .env
```

Ajusta la ruta de SQLite en `.env` (`SQLITE_PATH` o `MYSQLITE_PATH`) y `CORS_ORIGIN` (lista separada por comas para tus orígenes locales). El backend carga `.env` automáticamente al arrancar.

## 2) Ejecutar backend

```bash
npm run backend:dev
# desarrollo con autoreload (opcional)
npm run backend:watch
# o
node --env-file=.env backend/src/server.js
```

Healthcheck:

```bash
curl http://localhost:4000/api/health
```

El backend crea automáticamente la base y las tablas necesarias (`users`, `projects`, `campaigns`, `audiences`, `hypotheses`, `videos`) al iniciar.

## 3) Ejecutar frontend

```bash
npm run dev
```

El frontend usa `VITE_BACKEND_URL` y un cliente compatible con la API usada antes de Supabase (`auth`, `from(...).select/insert/update/delete.eq().order().single()`).

Ahora el flujo es 100% UI: usa `/signup` para crear cuenta y `/login` para iniciar sesión. Las rutas de proyectos están protegidas y redirigen a login si no hay sesión.


## Troubleshooting rápido

- Si quieres limpiar sesión, ejecuta esto en la **consola del navegador** (no en Terminal):

```js
localStorage.removeItem('mysql_backend_session');
```

- `ECANCELED` con `node --watch` es un problema intermitente del watcher en algunos entornos. Usa `npm run backend:dev` (sin watch) para evitarlo.


## Modelo de datos

Jerarquía actual: `Project -> Campaign -> (Audiences, Hypotheses) -> Videos (dentro de Hypothesis)`.

## Actualización masiva de videos

En la pantalla **Lista de videos** (detalle de hipótesis) existe el botón **Actualización masiva** para pegar JSON, validar y aplicar en lote.

### JSON soportado

Variante A (recomendada):

```json
{
  "updates": [
    { "video_id": "<id>", "fields": { "views": 1200, "clicks": 45, "ctr": 0.0375 } }
  ]
}
```

Variante B (compatibilidad):

```json
{
  "updates": [
    { "record_id": "<id>", "fields": { "views": "1200" } }
  ]
}
```

Variante C (fallback por identificadores):

```json
{
  "updates": [
    { "session_id": "s-001", "video_name": "Organic A / Variante 1", "fields": { "clicks": 12 } }
  ]
}
```

### Flujo manual (curl)

1) Crear cuenta / iniciar sesión y obtener token:

```bash
curl -s -X POST http://localhost:4000/api/auth/signin \
  -H 'Content-Type: application/json' \
  -d '{"email":"tu@email.com","password":"tu_password"}'
```

2) Ejecutar bulk update:

```bash
curl -s -X POST http://localhost:4000/api/videos/bulk-update \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer <TOKEN>' \
  -d '{"updates":[{"video_id":"<VIDEO_ID>","fields":{"views":"1200","clicks":50,"ctr":0.0416}}]}'
```

3) Validar cambios consultando la tabla con `/api/db/query` o desde la UI.

El endpoint siempre filtra por `user_id` del bearer token, usa transacción y prioriza identificadores en orden: `video_id -> session_id -> video_name`.
