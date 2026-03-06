const STOPWORDS = new Set([
  'de','la','que','el','en','y','a','los','del','se','las','por','un','para','con','no','una','su','al','lo','como','más','pero','sus','le','ya','o','este','sí','porque','esta','entre','cuando','muy','sin','sobre','también','me','hasta','hay','donde','quien','desde','todo','nos','durante','todos','uno','les','ni','contra','otros','ese','eso','ante','ellos','e','esto','mí','antes','algunos','qué','unos','yo','otro','otras','otra','él','tanto','esa','estos','mucho','quienes','nada','muchos','cual','poco','ella','estar','estas','algunas','algo','nosotros','mi','mis','tú','te','ti','tu','tus','ellas','nosotras','vosotros','vosotras','os','mío','mía','míos','mías','tuyo','tuya','tuyos','tuyas','esos','esas','estoy','estás','está','estamos','están','fue','fui','eran','ser','soy','eres','somos','son'
]);

const CODEBOOK = [
  { slug: 'problema_intenso', name: 'Problema intenso', category: 'tipo_problema', description: 'La persona expresa dolor fuerte o impacto relevante.' },
  { slug: 'problema_frecuente', name: 'Problema frecuente', category: 'tipo_problema', description: 'El problema aparece de forma repetida.' },
  { slug: 'frustracion', name: 'Frustración', category: 'emocion', description: 'Carga emocional negativa frente al problema.' },
  { slug: 'miedo_perdida', name: 'Miedo a perder', category: 'emocion', description: 'Temor a perder tiempo, dinero o resultado.' },
  { slug: 'busqueda_activa', name: 'Búsqueda activa de solución', category: 'comportamiento', description: 'Ya intentó resolver con alternativas.' },
  { slug: 'barrera_precio', name: 'Barrera de precio', category: 'comportamiento', description: 'El costo aparece como freno para adoptar solución.' },
  { slug: 'aceptacion_solucion', name: 'Aceptación de solución', category: 'intento_solucion', description: 'Muestra disposición clara a usar la solución.' },
  { slug: 'valor_percibido', name: 'Valor percibido alto', category: 'intento_solucion', description: 'Reconoce beneficio tangible de la solución.' },
  { slug: 'urgencia_accion', name: 'Urgencia de acción', category: 'interpretacion', description: 'Necesidad de resolver pronto.' },
  { slug: 'lenguaje_emocional', name: 'Lenguaje emocional', category: 'interpretacion', description: 'Uso de expresiones emocionales explícitas.' },
];

const CLUSTER_DEFS = [
  { slug: 'dolor_operativo', name: 'Dolor operativo', description: 'Narrativa de fricción y desgaste diario.', codeSlugs: ['problema_intenso', 'problema_frecuente', 'frustracion'] },
  { slug: 'ansiedad_riesgo', name: 'Ansiedad y riesgo', description: 'Narrativa de miedo y consecuencias por no resolver.', codeSlugs: ['miedo_perdida', 'urgencia_accion', 'lenguaje_emocional'] },
  { slug: 'busqueda_solucion', name: 'Búsqueda de solución', description: 'Narrativa de experimentación activa e intención de adopción.', codeSlugs: ['busqueda_activa', 'aceptacion_solucion', 'valor_percibido'] },
  { slug: 'friccion_compra', name: 'Fricción de compra', description: 'Narrativa de barreras para adoptar la solución.', codeSlugs: ['barrera_precio', 'busqueda_activa'] },
];

const EMOTIONAL_TOKENS = ['frustrante', 'estres', 'ansiedad', 'miedo', 'agobio', 'preocupacion', 'molesto', 'odio', 'cansado'];

const TOKEN_CODE_RULES = [
  { code: 'problema_intenso', tokens: ['grave', 'fuerte', 'dolor', 'critico', 'complicado', 'imposible', 'bloquea'] },
  { code: 'problema_frecuente', tokens: ['siempre', 'todos', 'cada', 'seguido', 'frecuente', 'repite'] },
  { code: 'frustracion', tokens: ['frustra', 'frustrante', 'cansa', 'molesta', 'agota'] },
  { code: 'miedo_perdida', tokens: ['miedo', 'perder', 'riesgo', 'fallar', 'equivocarme'] },
  { code: 'busqueda_activa', tokens: ['probe', 'intent', 'busque', 'compar', 'alternativa', 'herramienta'] },
  { code: 'barrera_precio', tokens: ['caro', 'precio', 'pagar', 'costo', 'presupuesto'] },
  { code: 'aceptacion_solucion', tokens: ['usaria', 'quiero', 'interesa', 'me sirve', 'me ayudaria'] },
  { code: 'valor_percibido', tokens: ['valor', 'beneficio', 'ahorro', 'rapido', 'resultado'] },
  { code: 'urgencia_accion', tokens: ['urgente', 'ya', 'pronto', 'hoy'] },
  { code: 'lenguaje_emocional', tokens: EMOTIONAL_TOKENS },
];

const normalize = (text = '') => String(text)
  .toLowerCase()
  .normalize('NFD')
  .replace(/\p{Diacritic}/gu, '');

const tokenize = (text = '') => normalize(text)
  .replace(/[^a-z0-9\s]/g, ' ')
  .split(/\s+/)
  .filter((token) => token.length > 2 && !STOPWORDS.has(token));

const splitSentences = (text = '') => String(text)
  .split(/[.!?\n]+/)
  .map((s) => s.trim())
  .filter(Boolean);

const avg = (list = []) => {
  if (!list.length) return null;
  return Number((list.reduce((a, b) => a + b, 0) / list.length).toFixed(2));
};

const uniq = (list) => [...new Set(list)];

const toMapById = (list, key = 'id') => Object.fromEntries(list.map((item) => [String(item[key]), item]));

const getDominantTerms = (rows = [], limit = 10) => {
  const freq = new Map();
  rows.forEach((row) => {
    tokenize(row).forEach((token) => freq.set(token, (freq.get(token) || 0) + 1));
  });
  return [...freq.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([term, count]) => ({ term, count }));
};

const buildInterviewSources = ({ sessions = [], audiencesById = {}, formsById = {}, clientsById = {} }) => sessions.map((session) => {
  const responses = session.responses_json || {};
  const responseTexts = Object.entries(responses)
    .filter(([key, value]) => !String(key).startsWith('__') && (typeof value === 'string' || Array.isArray(value)))
    .map(([questionId, value]) => ({
      questionId,
      text: Array.isArray(value) ? value.join(' ') : String(value || ''),
    }))
    .filter((row) => row.text.trim().length > 0);

  const fullTranscript = [
    String(session.transcript || '').trim(),
    ...responseTexts.map((row) => row.text.trim()),
  ].filter(Boolean).join('\n');

  return {
    id: session.id,
    session,
    clientName: clientsById[String(session.client_id)]?.name || session.client_name || 'Sin cliente',
    audienceName: audiencesById[String(session.audience_id)]?.name || session.audience_name || 'Sin audiencia',
    formName: formsById[String(session.form_id)]?.title || session.form_title || 'Sin formulario',
    interviewer: session.interviewer_name || 'Entrevistador no definido',
    date: session.created_at,
    context: session.problem_context || responses.__interview_context || '',
    transcript: fullTranscript,
    responseTexts,
  };
});

const buildAutoFragments = (interviews = []) => {
  const fragments = [];
  interviews.forEach((interview) => {
    let position = 1;

    interview.responseTexts.forEach((response) => {
      splitSentences(response.text).forEach((sentence, idx) => {
        if (sentence.length < 18) return;
        fragments.push({
          id: `auto_${interview.id}_${response.questionId}_${idx}`,
          interview_id: interview.id,
          text: sentence,
          position,
          originRef: `respuesta:${response.questionId}#${idx + 1}`,
          sourceType: 'auto',
        });
        position += 1;
      });
    });

    if (!interview.responseTexts.length) {
      splitSentences(interview.transcript).forEach((sentence, idx) => {
        if (sentence.length < 18) return;
        fragments.push({
          id: `auto_${interview.id}_transcript_${idx}`,
          interview_id: interview.id,
          text: sentence,
          position,
          originRef: `transcripcion#${idx + 1}`,
          sourceType: 'auto',
        });
        position += 1;
      });
    }
  });
  return fragments;
};

const inferCodesForFragment = (fragment) => {
  const text = normalize(fragment.text);
  const tokens = tokenize(fragment.text);
  const matched = TOKEN_CODE_RULES
    .filter((rule) => rule.tokens.some((token) => text.includes(token) || tokens.some((tk) => tk.includes(token))))
    .map((rule) => rule.code);

  if (!matched.length && fragment.text.length > 45) {
    matched.push('problema_intenso');
  }

  return uniq(matched);
};

const scoreEmotion = (text) => {
  const normalized = normalize(text);
  const emotionalHits = EMOTIONAL_TOKENS.filter((token) => normalized.includes(token)).length;
  const polarity = emotionalHits ? -Math.min(3, emotionalHits) : 0;
  const intensity = Math.min(5, Math.max(1, emotionalHits + 1));
  return { polarity, intensity };
};

const buildSemanticMap = ({ clusters = [], codebook = [], codeToFragments = {} }) => {
  const codeIndex = toMapById(codebook, 'slug');
  const nodes = [
    ...clusters.map((cluster) => ({ id: `cluster:${cluster.slug}`, label: cluster.name, kind: 'cluster', weight: cluster.fragmentCount })),
    ...codebook.map((code) => ({ id: `code:${code.slug}`, label: code.name, kind: 'code', weight: (codeToFragments[code.slug] || []).length })),
  ];

  const edges = [];
  clusters.forEach((cluster) => {
    cluster.codeSlugs.forEach((codeSlug) => {
      if (!codeIndex[codeSlug]) return;
      edges.push({
        from: `cluster:${cluster.slug}`,
        to: `code:${codeSlug}`,
        weight: (codeToFragments[codeSlug] || []).length,
      });
    });
  });

  return { nodes, edges };
};

export const defaultSemanticCodebook = CODEBOOK;
export const defaultSemanticClusters = CLUSTER_DEFS;

export const buildSemanticAnalysis = ({
  sessions = [],
  audiencesById = {},
  formsById = {},
  clientsById = {},
  manualFragments = [],
  customCodebook = [],
  codeAssignments = {},
  clusterNameOverrides = {},
}) => {
  const interviews = buildInterviewSources({ sessions, audiencesById, formsById, clientsById });
  const autoFragments = buildAutoFragments(interviews);
  const normalizedManualFragments = manualFragments.map((fragment) => ({ ...fragment, sourceType: 'manual' }));
  const fragments = [...autoFragments, ...normalizedManualFragments];

  const codebook = uniq([...CODEBOOK, ...customCodebook].map((item) => item.slug)).map((slug) => {
    const fromCustom = customCodebook.find((item) => item.slug === slug);
    const fromDefault = CODEBOOK.find((item) => item.slug === slug);
    return fromCustom || fromDefault;
  }).filter(Boolean);

  const fragmentsWithCodes = fragments.map((fragment) => {
    const inferred = inferCodesForFragment(fragment);
    const manual = codeAssignments[fragment.id] || [];
    const codeSlugs = uniq([...inferred, ...manual]).filter((slug) => codebook.some((code) => code.slug === slug));
    const emotion = scoreEmotion(fragment.text);
    return {
      ...fragment,
      codeSlugs,
      ...emotion,
    };
  });

  const fragmentsByInterview = interviews.reduce((acc, interview) => {
    acc[interview.id] = fragmentsWithCodes.filter((fragment) => String(fragment.interview_id) === String(interview.id));
    return acc;
  }, {});

  const codeToFragments = codebook.reduce((acc, code) => {
    acc[code.slug] = fragmentsWithCodes.filter((fragment) => fragment.codeSlugs.includes(code.slug));
    return acc;
  }, {});

  const codes = codebook.map((code) => {
    const attachedFragments = codeToFragments[code.slug] || [];
    const interviewIds = uniq(attachedFragments.map((fragment) => fragment.interview_id));
    return {
      ...code,
      fragmentCount: attachedFragments.length,
      interviewCount: interviewIds.length,
      fragments: attachedFragments,
      interviewIds,
    };
  });

  const clusters = CLUSTER_DEFS.map((cluster) => {
    const namedCluster = {
      ...cluster,
      name: clusterNameOverrides[cluster.slug] || cluster.name,
    };
    const relatedFragments = fragmentsWithCodes.filter((fragment) => fragment.codeSlugs.some((slug) => cluster.codeSlugs.includes(slug)));
    const interviewIds = uniq(relatedFragments.map((fragment) => fragment.interview_id));
    const relatedInterviews = interviews.filter((interview) => interviewIds.includes(interview.id));
    return {
      ...namedCluster,
      fragmentCount: relatedFragments.length,
      interviewCount: interviewIds.length,
      audiences: uniq(relatedInterviews.map((interview) => interview.audienceName)),
      dominantCodes: cluster.codeSlugs
        .map((slug) => ({ slug, count: (codeToFragments[slug] || []).length }))
        .sort((a, b) => b.count - a.count),
      fragments: relatedFragments,
      interviews: relatedInterviews,
    };
  }).filter((cluster) => cluster.fragmentCount > 0);

  const saturationByAudience = uniq(interviews.map((interview) => interview.audienceName)).map((audienceName) => {
    const audienceInterviews = interviews.filter((interview) => interview.audienceName === audienceName);
    const audienceInterviewIds = audienceInterviews.map((interview) => interview.id);
    const audienceFragments = fragmentsWithCodes.filter((fragment) => audienceInterviewIds.includes(fragment.interview_id));
    const clusterCounts = clusters
      .map((cluster) => ({ slug: cluster.slug, count: cluster.fragments.filter((fragment) => audienceInterviewIds.includes(fragment.interview_id)).length }))
      .filter((item) => item.count > 0)
      .sort((a, b) => b.count - a.count);
    const repeatedCodes = getDominantTerms(audienceFragments.flatMap((fragment) => fragment.codeSlugs), 6);

    return {
      audienceName,
      interviews: audienceInterviews.length,
      fragments: audienceFragments.length,
      repeatedClusters: clusterCounts.slice(0, 4),
      repeatedCodes,
      hasSaturationSignal: audienceInterviews.length >= 5 && clusterCounts[0]?.count >= 4,
    };
  });

  const distribution = clusters
    .map((cluster) => ({
      slug: cluster.slug,
      name: cluster.name,
      interviews: cluster.interviewCount,
      fragments: cluster.fragmentCount,
      audiences: cluster.audiences,
    }))
    .sort((a, b) => b.fragments - a.fragments);

  const semanticMap = buildSemanticMap({ clusters, codebook, codeToFragments });

  const output = {
    dominantProblems: codes.filter((code) => code.category === 'tipo_problema' || code.category === 'interpretacion').sort((a, b) => b.fragmentCount - a.fragmentCount).slice(0, 5),
    dominantEmotions: codes.filter((code) => code.category === 'emocion').sort((a, b) => b.fragmentCount - a.fragmentCount).slice(0, 5),
    recurrentBehaviors: codes.filter((code) => code.category === 'comportamiento').sort((a, b) => b.fragmentCount - a.fragmentCount).slice(0, 5),
    marketNarratives: distribution.slice(0, 5),
  };

  return {
    interviews,
    fragments: fragmentsWithCodes,
    codes,
    clusters,
    distribution,
    semanticMap,
    saturationByAudience,
    output,
    dashboard: {
      interviewsAnalyzed: interviews.length,
      fragmentsAnalyzed: fragmentsWithCodes.length,
      codedFragments: fragmentsWithCodes.filter((fragment) => fragment.codeSlugs.length > 0).length,
      clustersDetected: clusters.length,
      audiencesIncluded: uniq(interviews.map((interview) => interview.audienceName)),
      formsIncluded: uniq(interviews.map((interview) => interview.formName)),
    },
    traceability: {
      fragmentsByInterview,
      codeToFragments,
    },
  };
};
