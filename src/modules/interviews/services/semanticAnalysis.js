const STOPWORDS = new Set([
  'de','la','que','el','en','y','a','los','del','se','las','por','un','para','con','no','una','su','al','lo','como','más','pero','sus','le','ya','o','este','sí','porque','esta','entre','cuando','muy','sin','sobre','también','me','hasta','hay','donde','quien','desde','todo','nos','durante','todos','uno','les','ni','contra','otros','ese','eso','ante','ellos','e','esto','mí','antes','algunos','qué','unos','yo','otro','otras','otra','él','tanto','esa','estos','mucho','quienes','nada','muchos','cual','poco','ella','estar','estas','algunas','algo','nosotros','mi','mis','tú','te','ti','tu','tus','ellas','nosotras','vosotros','vosotras','os','mío','mía','míos','mías','tuyo','tuya','tuyos','tuyas','esos','esas','estoy','estás','está','estamos','están','fue','fui','eran','ser','soy','eres','somos','son'
]);

const POSITIVE = ['fácil','rápido','útil','encanta','mejora','bien','genial','excelente','ahorro','resolver','solución','claro','positivo','interesa','comprar'];
const NEGATIVE = ['difícil','lento','frustrante','problema','caro','malo','confuso','dolor','estrés','preocupación','riesgo','no','nunca','imposible','complicado'];

const normalize = (text = '') => String(text).toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, '');
const splitSentences = (text = '') => String(text).split(/[.!?\n]+/).map((s) => s.trim()).filter(Boolean);

const tokenize = (text = '') => normalize(text)
  .replace(/[^a-z0-9\s]/g, ' ')
  .split(/\s+/)
  .filter((t) => t.length > 2 && !STOPWORDS.has(t));

const avg = (arr) => (arr.length ? Number((arr.reduce((a, b) => a + b, 0) / arr.length).toFixed(2)) : null);

const getDominantTerms = (tokens, size = 8) => {
  const freq = new Map();
  tokens.forEach((token) => freq.set(token, (freq.get(token) || 0) + 1));
  return [...freq.entries()].sort((a, b) => b[1] - a[1]).slice(0, size).map(([term, count]) => ({ term, count }));
};

const buildCorpus = (sessions = []) => {
  const rows = [];
  sessions.forEach((session) => {
    const responses = session.responses_json || {};
    Object.entries(responses).forEach(([questionId, value]) => {
      if (String(questionId).startsWith('__')) return;
      if (typeof value === 'string' && value.trim()) rows.push({
        session,
        questionId,
        text: value.trim(),
      });
      if (Array.isArray(value)) {
        const joined = value.join(' ').trim();
        if (joined) rows.push({ session, questionId, text: joined });
      }
    });
  });
  return rows;
};

const scoreSentiment = (text) => {
  const tokens = tokenize(text);
  const pos = tokens.filter((t) => POSITIVE.includes(t)).length;
  const neg = tokens.filter((t) => NEGATIVE.includes(t)).length;
  const polarity = pos - neg;
  const intensity = Math.min(5, Math.max(1, pos + neg || 1));
  return { polarity, intensity, pos, neg, tokens };
};

export const buildSemanticAnalysis = ({ sessions = [], audiencesById = {}, formsById = {}, clientsById = {} }) => {
  const corpus = buildCorpus(sessions);
  const allTokens = corpus.flatMap((row) => tokenize(row.text));
  const dominantTerms = getDominantTerms(allTokens, 18);

  const sentimentRows = corpus.map((row) => ({ ...row, ...scoreSentiment(row.text) }));
  const emotionalAvg = avg(sentimentRows.map((r) => r.intensity).filter(Boolean));

  const keywordSeeds = dominantTerms.slice(0, 6).map((item) => item.term);
  const clusters = keywordSeeds.map((seed) => {
    const rows = corpus.filter((row) => tokenize(row.text).includes(seed));
    const sessionIds = [...new Set(rows.map((row) => row.session.id))];
    const relatedSessions = sessionIds.map((id) => sessions.find((session) => session.id === id)).filter(Boolean);
    const problemScores = relatedSessions.map((s) => s.__problemScore).filter((v) => v != null);
    const solutionScores = relatedSessions.map((s) => s.__solutionScore).filter((v) => v != null);
    return {
      id: seed,
      name: seed.charAt(0).toUpperCase() + seed.slice(1),
      count: rows.length,
      representativePhrases: rows.slice(0, 3).map((row) => row.text),
      audiences: [...new Set(relatedSessions.map((s) => audiencesById[s.audience_id]?.name || s.audience_name || 'Sin audiencia'))],
      problemScore: avg(problemScores),
      solutionScore: avg(solutionScores),
      rows,
      relatedSessions,
      relatedClients: [...new Set(relatedSessions.map((s) => clientsById[s.client_id]?.name || s.client_name || 'Sin cliente'))],
    };
  }).filter((cluster) => cluster.count > 0);

  const themes = dominantTerms.slice(0, 10).map((item) => {
    const rows = corpus.filter((row) => tokenize(row.text).includes(item.term));
    const relatedSessions = [...new Set(rows.map((row) => row.session.id))].map((id) => sessions.find((session) => session.id === id)).filter(Boolean);
    return {
      id: item.term,
      name: item.term,
      keywords: tokenize(rows.slice(0, 20).map((row) => row.text).join(' ')).slice(0, 8),
      examples: rows.slice(0, 3).map((row) => row.text),
      frequency: rows.length,
      audiences: [...new Set(relatedSessions.map((s) => audiencesById[s.audience_id]?.name || s.audience_name || 'Sin audiencia'))],
      problemScore: avg(relatedSessions.map((s) => s.__problemScore).filter((v) => v != null)),
      solutionScore: avg(relatedSessions.map((s) => s.__solutionScore).filter((v) => v != null)),
      relatedSessions,
    };
  }).filter((theme) => theme.frequency > 0);

  const topicGroups = [
    { id: 'topic-pain', label: 'Dolor y fricción', seed: ['problema', 'dolor', 'frustrante', 'dificil', 'complicado'] },
    { id: 'topic-value', label: 'Valor y resultados', seed: ['valor', 'util', 'ahorro', 'mejora', 'rapido'] },
    { id: 'topic-buying', label: 'Adopción y pago', seed: ['comprar', 'pagar', 'interesa', 'precio', 'solucion'] },
  ];

  const topics = topicGroups.map((topic) => {
    const rows = corpus.filter((row) => {
      const tks = tokenize(row.text);
      return topic.seed.some((seed) => tks.includes(seed));
    });
    const relatedSessions = [...new Set(rows.map((row) => row.session.id))].map((id) => sessions.find((session) => session.id === id)).filter(Boolean);
    return {
      ...topic,
      keywords: getDominantTerms(rows.flatMap((row) => tokenize(row.text)), 6).map((i) => i.term),
      phrases: rows.slice(0, 4).map((row) => row.text),
      rows,
      relatedSessions,
      audiences: [...new Set(relatedSessions.map((s) => audiencesById[s.audience_id]?.name || s.audience_name || 'Sin audiencia'))],
    };
  }).filter((topic) => topic.rows.length > 0);

  const phrases = getDominantTerms(corpus.flatMap((row) => splitSentences(row.text).map((s) => normalize(s))), 20)
    .filter((item) => item.term.split(' ').length > 1 || item.term.length > 8)
    .slice(0, 12);

  const highProblemPhrases = corpus
    .filter((row) => (row.session.__problemScore || 0) >= 4)
    .flatMap((row) => splitSentences(row.text).slice(0, 1))
    .slice(0, 8);

  const highSolutionPhrases = corpus
    .filter((row) => (row.session.__solutionScore || 0) >= 4)
    .flatMap((row) => splitSentences(row.text).slice(0, 1))
    .slice(0, 8);

  const dashboard = {
    interviewsAnalyzed: sessions.length,
    openResponses: corpus.length,
    audiencesIncluded: [...new Set(sessions.map((s) => audiencesById[s.audience_id]?.name || s.audience_name).filter(Boolean))],
    formsIncluded: [...new Set(sessions.map((s) => formsById[s.form_id]?.title || s.form_title).filter(Boolean))],
    mainThemes: themes.slice(0, 5).map((theme) => theme.name),
    averageEmotionLevel: emotionalAvg,
  };

  return {
    dashboard,
    clusters,
    sentiment: {
      averagePolarity: avg(sentimentRows.map((r) => r.polarity)),
      averageIntensity: emotionalAvg,
      dominantEmotionalWords: getDominantTerms(sentimentRows.flatMap((row) => row.tokens.filter((t) => POSITIVE.includes(t) || NEGATIVE.includes(t))), 10),
      interviewsHighIntensity: [...new Set(sentimentRows.filter((row) => row.intensity >= 3).map((row) => row.session.id))].slice(0, 8)
        .map((id) => sessions.find((session) => session.id === id))
        .filter(Boolean),
      emotionVsProblem: sessions.map((session) => {
        const rows = sentimentRows.filter((row) => row.session.id === session.id);
        return {
          session,
          intensity: avg(rows.map((row) => row.intensity).filter(Boolean)) || 0,
          problemScore: session.__problemScore ?? null,
        };
      }),
    },
    themes,
    topics,
    marketLanguage: {
      repeatedPhrases: phrases,
      dominantEmotionalExpressions: sentimentRows
        .filter((row) => row.pos > 0 || row.neg > 0)
        .slice(0, 12)
        .map((row) => ({ phrase: splitSentences(row.text)[0] || row.text, polarity: row.polarity, session: row.session })),
      highProblemPhrases,
      highSolutionPhrases,
    },
    corpus,
  };
};
