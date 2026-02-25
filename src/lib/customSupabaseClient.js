const apiBaseUrl = import.meta.env.VITE_BACKEND_URL || 'http://localhost:4000';
const sessionStorageKey = 'mysql_backend_session';
const demoEmailStorageKey = 'mysql_backend_demo_email';

const authSubscribers = new Set();
let ensureSessionPromise = null;

function getDemoCredentials() {
  const configuredEmail = import.meta.env.VITE_DEMO_EMAIL;
  const configuredPassword = import.meta.env.VITE_DEMO_PASSWORD || 'demo123456';

  if (configuredEmail) {
    return { email: configuredEmail, password: configuredPassword };
  }

  const cachedEmail = localStorage.getItem(demoEmailStorageKey);
  if (cachedEmail) {
    return { email: cachedEmail, password: configuredPassword };
  }

  const generatedEmail = `demo-${crypto.randomUUID()}@local.entre`;
  localStorage.setItem(demoEmailStorageKey, generatedEmail);
  return { email: generatedEmail, password: configuredPassword };
}

function parseRelations(selectText = '') {
  const normalized = String(selectText).replace(/\s+/g, ' ');
  const relations = [];

  if (normalized.includes('campaigns:campaigns(count)')) relations.push({ alias: 'campaigns', table: 'campaigns', type: 'count', foreignKey: 'project_id' });
  if (normalized.includes('campaigns:campaigns(*)')) relations.push({ alias: 'campaigns', table: 'campaigns', type: 'rows', foreignKey: 'project_id' });
  if (normalized.includes('audiences:audiences(count)')) relations.push({ alias: 'audiences', table: 'audiences', type: 'count', foreignKey: 'campaign_id' });
  if (normalized.includes('audiences:audiences(*)')) relations.push({ alias: 'audiences', table: 'audiences', type: 'rows', foreignKey: 'campaign_id' });
  if (normalized.includes('hypotheses:hypotheses(count)')) relations.push({ alias: 'hypotheses', table: 'hypotheses', type: 'count', foreignKey: 'campaign_id' });
  if (normalized.includes('hypotheses:hypotheses(*)')) relations.push({ alias: 'hypotheses', table: 'hypotheses', type: 'rows', foreignKey: 'campaign_id' });
  if (normalized.includes('videos:videos(*)')) relations.push({ alias: 'videos', table: 'videos', type: 'rows', foreignKey: 'audience_id' });
  if (normalized.includes('clients:clients(*)')) relations.push({ alias: 'clients', table: 'clients', type: 'rows', foreignKey: 'audience_id' });

  return relations;
}

function getStoredSession() {
  try {
    const raw = localStorage.getItem(sessionStorageKey);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function setStoredSession(session) {
  if (session) {
    localStorage.setItem(sessionStorageKey, JSON.stringify(session));
  } else {
    localStorage.removeItem(sessionStorageKey);
  }
}

async function request(path, options = {}) {
  const session = getStoredSession();
  const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
  if (session?.access_token) {
    headers.Authorization = `Bearer ${session.access_token}`;
  }

  const response = await fetch(`${apiBaseUrl}${path}`, {
    ...options,
    headers,
  });

  const json = await response.json();
  if (!response.ok) {
    throw new Error(json.error || 'Request failed');
  }
  return json;
}

async function enrichWithRelations(rows, relations) {
  if (!relations.length) return rows;

  return Promise.all(
    rows.map(async (row) => {
      const enriched = { ...row };
      for (const relation of relations) {
        if (relation.table === 'clients') {
          enriched[relation.alias] = [];
          continue;
        }

        const result = await request('/api/db/query', {
          method: 'POST',
          body: JSON.stringify({
            table: relation.table,
            operation: 'select',
            filters: [{ field: relation.foreignKey, value: row.id }],
          }),
        });

        const childRows = result.data || [];
        enriched[relation.alias] = relation.type === 'count' ? [{ count: childRows.length }] : childRows;
      }
      return enriched;
    }),
  );
}

function createQueryBuilder(table) {
  const state = {
    table,
    operation: 'select',
    payload: null,
    filters: [],
    orderBy: null,
    single: false,
    selectText: '*',
  };

  const builder = {
    select(columns = '*') {
      state.selectText = columns;
      return builder;
    },
    insert(payload) {
      state.operation = 'insert';
      state.payload = payload;
      return builder;
    },
    update(payload) {
      state.operation = 'update';
      state.payload = payload;
      return builder;
    },
    delete() {
      state.operation = 'delete';
      return builder;
    },
    eq(field, value) {
      state.filters.push({ field, value });
      return builder;
    },
    order(column, { ascending = true } = {}) {
      state.orderBy = { column, ascending };
      return builder;
    },
    single() {
      state.single = true;
      return builder;
    },
    async execute() {
      try {
        const response = await request('/api/db/query', {
          method: 'POST',
          body: JSON.stringify({
            table: state.table,
            operation: state.operation,
            payload: state.payload,
            filters: state.filters,
            orderBy: state.orderBy,
          }),
        });

        let data = response.data || [];
        if (state.operation === 'select') {
          data = await enrichWithRelations(data, parseRelations(state.selectText));
        }

        return {
          data: state.single ? data[0] || null : data,
          error: null,
        };
      } catch (error) {
        return { data: null, error };
      }
    },
    then(resolve, reject) {
      return builder.execute().then(resolve, reject);
    },
  };

  return builder;
}

async function ensureSession() {
  const existingSession = getStoredSession();
  if (existingSession?.access_token) return existingSession;

  if (!ensureSessionPromise) {
    ensureSessionPromise = (async () => {
      const credentials = getDemoCredentials();

      try {
        const signin = await fetch(`${apiBaseUrl}/api/auth/signin`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(credentials),
        });

        if (signin.ok) {
          const json = await signin.json();
          setStoredSession(json.session);
          return json.session;
        }
      } catch {
        // Keep fallback to signup.
      }

      const signup = await fetch(`${apiBaseUrl}/api/auth/signup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(credentials),
      });

      if (!signup.ok) {
        const payload = await signup.json().catch(() => ({}));
        throw new Error(payload.error || 'Unable to create demo session');
      }

      const signupJson = await signup.json();
      setStoredSession(signupJson.session);
      return signupJson.session;
    })().finally(() => {
      ensureSessionPromise = null;
    });
  }

  return ensureSessionPromise;
}

export const supabase = {
  auth: {
    async getSession() {
      let session = getStoredSession();
      if (!session?.access_token) {
        try {
          session = await ensureSession();
        } catch {
          return { data: { session: null }, error: null };
        }
      }
      try {
        const { user } = await request('/api/auth/me', { method: 'GET' });
        return { data: { session: { ...session, user } }, error: null };
      } catch {
        setStoredSession(null);
        return { data: { session: null }, error: null };
      }
    },
    async getUser() {
      const { data } = await this.getSession();
      return { data: { user: data.session?.user || null }, error: null };
    },
    onAuthStateChange(callback) {
      authSubscribers.add(callback);
      return {
        data: {
          subscription: {
            unsubscribe: () => authSubscribers.delete(callback),
          },
        },
      };
    },
    async signUp({ email, password }) {
      try {
        const { session } = await request('/api/auth/signup', {
          method: 'POST',
          body: JSON.stringify({ email, password }),
        });

        setStoredSession(session);
        authSubscribers.forEach((cb) => cb('SIGNED_IN', session));
        return { data: { session }, error: null };
      } catch (error) {
        return { data: null, error };
      }
    },
    async signInWithPassword({ email, password }) {
      try {
        const { session } = await request('/api/auth/signin', {
          method: 'POST',
          body: JSON.stringify({ email, password }),
        });

        setStoredSession(session);
        authSubscribers.forEach((cb) => cb('SIGNED_IN', session));
        return { data: { session }, error: null };
      } catch (error) {
        return { data: null, error };
      }
    },
    async signOut() {
      try {
        await request('/api/auth/signout', { method: 'POST' });
      } catch {
        // Continue local signout.
      }
      setStoredSession(null);
      authSubscribers.forEach((cb) => cb('SIGNED_OUT', null));
      return { error: null };
    },
  },
  from(table) {
    return createQueryBuilder(table);
  },
};
