# entre

Migración base para usar backend con **MySQL** en lugar de Supabase, manteniendo una API de consultas parecida para no romper la lógica existente.

## Ejecutar frontend

```bash
npm run dev
```

## Ejecutar backend MySQL

1. Copia variables de entorno:

```bash
cp .env.example .env
```

2. Ajusta credenciales de MySQL en `.env`.

3. Inicia backend:

```bash
npm run backend:dev
```

Healthcheck:

```bash
curl http://localhost:4000/api/health
```

## Adapter de migración

Se agregó `createMysqlSupabaseAdapter(pool)` para facilitar el reemplazo de consultas tipo Supabase:

```js
const db = createMysqlSupabaseAdapter(pool);
const { data, error } = await db.from('users').select('*').eq('id', 1).single();
```

Operaciones soportadas:

- `select()` + `eq()` + `single()`
- `insert()`
- `update()` + `eq()`
- `delete()` + `eq()`
