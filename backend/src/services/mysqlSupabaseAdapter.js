/**
 * Small adapter to ease migration from Supabase query calls to MySQL.
 * Supported chain: from(table).select(columns?).eq(field, value).single()
 * Also supports insert/update/delete with eq filter.
 */
function quoteIdent(name) {
  return String(name)
    .split('.')
    .map((part) => `\`${part.replaceAll('`', '``')}\``)
    .join('.');
}

export function createMysqlSupabaseAdapter(pool) {
  const run = async (query, params = []) => {
    try {
      const [rows] = await pool.query(query, params);
      return { data: rows, error: null };
    } catch (error) {
      return { data: null, error };
    }
  };

  const buildWhere = (filters) => {
    if (!filters.length) {
      return { sql: '', values: [] };
    }

    const sql = ` WHERE ${filters.map(({ field }) => `${quoteIdent(field)} = ?`).join(' AND ')}`;
    const values = filters.map(({ value }) => value);
    return { sql, values };
  };

  return {
    from(table) {
      const state = { table, filters: [], operation: 'select', payload: null, columns: '*' };

      const api = {
        select(columns = '*') {
          state.operation = 'select';
          state.columns = columns;
          return api;
        },
        insert(payload) {
          state.operation = 'insert';
          state.payload = payload;
          return api;
        },
        update(payload) {
          state.operation = 'update';
          state.payload = payload;
          return api;
        },
        delete() {
          state.operation = 'delete';
          return api;
        },
        eq(field, value) {
          state.filters.push({ field, value });
          return api;
        },
        async single() {
          const result = await api.execute();
          if (result.error) return result;
          const data = Array.isArray(result.data) ? result.data[0] ?? null : result.data;
          return { data, error: null };
        },
        async execute() {
          const { sql: whereSql, values: whereValues } = buildWhere(state.filters);
          const quotedTable = quoteIdent(state.table);

          if (state.operation === 'select') {
            return run(`SELECT ${state.columns} FROM ${quotedTable}${whereSql}`, whereValues);
          }

          if (state.operation === 'insert') {
            const payload = Array.isArray(state.payload) ? state.payload[0] : state.payload;
            const fields = Object.keys(payload || {});
            const placeholders = fields.map(() => '?').join(', ');
            const values = fields.map((field) => payload[field]);
            const query = `INSERT INTO ${quotedTable} (${fields.map((f) => quoteIdent(f)).join(', ')}) VALUES (${placeholders})`;
            return run(query, values);
          }

          if (state.operation === 'update') {
            const fields = Object.keys(state.payload || {});
            const setSql = fields.map((f) => `${quoteIdent(f)} = ?`).join(', ');
            const setValues = fields.map((f) => state.payload[f]);
            const query = `UPDATE ${quotedTable} SET ${setSql}${whereSql}`;
            return run(query, [...setValues, ...whereValues]);
          }

          if (state.operation === 'delete') {
            return run(`DELETE FROM ${quotedTable}${whereSql}`, whereValues);
          }

          return { data: null, error: new Error(`Unsupported operation: ${state.operation}`) };
        },
        then(resolve, reject) {
          return api.execute().then(resolve, reject);
        },
      };

      return api;
    },
  };
}

export { quoteIdent };
