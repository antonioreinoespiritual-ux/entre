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
