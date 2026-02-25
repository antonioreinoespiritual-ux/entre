# entre

Aplicación migrada para usar **backend propio con SQLite (mysqlite)** en lugar de Supabase.

## 1) Variables de entorno

```bash
cp .env.example .env
```

Ajusta la ruta de SQLite en `.env` (`SQLITE_PATH` o `MYSQLITE_PATH`). El backend carga `.env` automáticamente al arrancar.

## 2) Ejecutar backend

```bash
npm run backend:dev
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

Si no haces login manual, el frontend crea/inicia automáticamente una sesión demo para que puedas crear proyectos/campañas de inmediato. Puedes fijar esas credenciales con `VITE_DEMO_EMAIL` y `VITE_DEMO_PASSWORD`; si esas credenciales fallan, el cliente genera una cuenta demo nueva de fallback automáticamente.

## 4) Actualización masiva de videos (JSON)

En la lista de videos ahora existe el botón **“Actualización masiva”**.

### Formato JSON soportado

```json
{
  "updates": [
    { "video_id": "<id>", "fields": { "views": 1200, "clicks": 45, "ctr": 0.0375 } },
    { "record_id": "<id>", "fields": { "views": 1200 } },
    { "session_id": "s-001", "video_name": "Organic A / Variante 1", "fields": { "clicks": 12 } }
  ]
}
```

Prioridad de resolución: `video_id/record_id -> session_id -> video_name/record_name/name`.

### Prueba manual rápida con curl

1. Crear cuenta y guardar token.
2. Crear proyecto/campaña/audiencia/video (vía `/api/db/query`).
3. Ejecutar batch:

```bash
curl -X POST http://localhost:4000/api/videos/bulk-update \
  -H "Authorization: Bearer <TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{
    "updates": [
      {"video_id":"<VIDEO_ID>","fields":{"views":"1200","clicks":"45","ctr":"0.0375"}},
      {"session_id":"s-001","video_name":"Organic A / Variante 1","fields":{"lead_form":4,"context":"desde curl"}}
    ]
  }'
```

4. Verificar que el video cambió (por ejemplo con `POST /api/db/query` sobre tabla `videos`).
