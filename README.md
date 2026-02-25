# entre

Aplicación migrada para usar **backend propio con MySQL** en lugar de Supabase.

## 1) Variables de entorno

```bash
cp .env.example .env
```

Ajusta credenciales de MySQL en `.env`.

## 2) Ejecutar backend

```bash
npm run backend:dev
```

Healthcheck:

```bash
curl http://localhost:4000/api/health
```

El backend crea automáticamente las tablas necesarias (`users`, `projects`, `campaigns`, `audiences`, `hypotheses`, `videos`) al iniciar.

## 3) Ejecutar frontend

```bash
npm run dev
```

El frontend ahora usa `VITE_BACKEND_URL` y un cliente compatible con la API usada antes de Supabase (`auth`, `from(...).select/insert/update/delete.eq().order().single()`).
