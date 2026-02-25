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
