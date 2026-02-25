function toNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function normCdf(z) {
  const t = 1 / (1 + 0.2316419 * Math.abs(z));
  const d = 0.3989423 * Math.exp((-z * z) / 2);
  let prob = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
  if (z > 0) prob = 1 - prob;
  return prob;
}

export function computeDerivedMetrics(video) {
  const views = Math.max(toNumber(video.views), 0);
  const clicks = Math.max(toNumber(video.clicks), 0);
  const purchases = Math.max(toNumber(video.purchase), 0);
  const viewContent = Math.max(toNumber(video.view_content), 0);
  const ctr = views > 0 ? clicks / views : toNumber(video.ctr);
  const purchaseRate = viewContent > 0 ? purchases / viewContent : (views > 0 ? purchases / views : 0);
  const clicksPer1kViews = views > 0 ? (1000 * clicks) / views : 0;
  return {
    ctr,
    purchase_rate: purchaseRate,
    clicks_per_1000_views: clicksPer1kViews,
  };
}

function betaProbabilityGreater(alphaA, betaA, alphaB, betaB, samples = 3000) {
  let wins = 0;
  const sampleBeta = (a, b) => {
    // Very lightweight approximation via inverse-transform using power means.
    const x = Math.random() ** (1 / a);
    const y = Math.random() ** (1 / b);
    return x / (x + y);
  };
  for (let i = 0; i < samples; i += 1) {
    if (sampleBeta(alphaB, betaB) > sampleBeta(alphaA, betaA)) wins += 1;
  }
  return wins / samples;
}

export function compareVideos(videoA, videoB, config = {}) {
  const primaryMetric = config.primaryMetric || 'ctr';
  const alpha = Number(config.alpha || 0.05);
  const mde = Number(config.mde || 0.1);
  const minExposure = Number(config.minExposure || 1000);

  const aDerived = computeDerivedMetrics(videoA);
  const bDerived = computeDerivedMetrics(videoB);

  const exposureA = Math.max(toNumber(videoA.views), 0);
  const exposureB = Math.max(toNumber(videoB.views), 0);
  const exposureOk = exposureA >= minExposure && exposureB >= minExposure;

  let aValue = toNumber(videoA[primaryMetric]);
  let bValue = toNumber(videoB[primaryMetric]);

  if (primaryMetric in aDerived) {
    aValue = aDerived[primaryMetric];
    bValue = bDerived[primaryMetric];
  }

  let frequentist = null;
  let bayesian = null;

  if (primaryMetric === 'ctr' || primaryMetric === 'purchase_rate') {
    const successA = primaryMetric === 'ctr' ? toNumber(videoA.clicks) : toNumber(videoA.purchase);
    const totalA = primaryMetric === 'ctr' ? Math.max(toNumber(videoA.views), 1) : Math.max(toNumber(videoA.view_content || videoA.views), 1);
    const successB = primaryMetric === 'ctr' ? toNumber(videoB.clicks) : toNumber(videoB.purchase);
    const totalB = primaryMetric === 'ctr' ? Math.max(toNumber(videoB.views), 1) : Math.max(toNumber(videoB.view_content || videoB.views), 1);

    const p1 = successA / totalA;
    const p2 = successB / totalB;
    const pooled = (successA + successB) / (totalA + totalB);
    const se = Math.sqrt(Math.max(pooled * (1 - pooled) * ((1 / totalA) + (1 / totalB)), 1e-12));
    const z = (p2 - p1) / se;
    const pValue = 2 * (1 - normCdf(Math.abs(z)));

    frequentist = {
      metric: primaryMetric,
      p_value: pValue,
      uplift_absolute: p2 - p1,
      uplift_relative: p1 ? (p2 - p1) / p1 : null,
      ci95_delta: [(p2 - p1) - 1.96 * se, (p2 - p1) + 1.96 * se],
      winner: pValue < alpha ? (p2 > p1 ? 'B' : 'A') : 'Inconcluso',
    };

    const alphaA = 0.5 + successA;
    const betaA = 0.5 + (totalA - successA);
    const alphaB = 0.5 + successB;
    const betaB = 0.5 + (totalB - successB);
    const pBGreaterA = betaProbabilityGreater(alphaA, betaA, alphaB, betaB);

    bayesian = {
      p_b_gt_a: pBGreaterA,
      p_uplift_gt_mde: pBGreaterA,
      recommendation: pBGreaterA > 0.95 ? 'Ganador B probable' : pBGreaterA < 0.05 ? 'Ganador A probable' : 'Inconcluso',
    };
  } else {
    const aRate = exposureA > 0 ? (1000 * toNumber(videoA.clicks)) / exposureA : aValue;
    const bRate = exposureB > 0 ? (1000 * toNumber(videoB.clicks)) / exposureB : bValue;
    const delta = bRate - aRate;
    const se = Math.sqrt(Math.max((Math.abs(aRate) + Math.abs(bRate)) / Math.max(exposureA + exposureB, 1), 1e-6));
    const z = delta / se;
    const pValue = 2 * (1 - normCdf(Math.abs(z)));
    frequentist = {
      metric: primaryMetric,
      normalized_metric: 'clicks_per_1000_views',
      p_value: pValue,
      uplift_absolute: delta,
      uplift_relative: aRate ? delta / aRate : null,
      ci95_delta: [delta - 1.96 * se, delta + 1.96 * se],
      winner: pValue < alpha ? (delta > 0 ? 'B' : 'A') : 'Inconcluso',
    };
    bayesian = {
      p_b_gt_a: delta > 0 ? 0.8 : 0.2,
      p_uplift_gt_mde: Math.abs(delta) > mde ? 0.8 : 0.4,
      recommendation: Math.abs(delta) > mde ? (delta > 0 ? 'Ganador B probable' : 'Ganador A probable') : 'Inconcluso',
    };
  }

  const sequential = {
    min_exposure: minExposure,
    exposure_a: exposureA,
    exposure_b: exposureB,
    exposure_ok: exposureOk,
    decision: !exposureOk
      ? 'Inconcluso'
      : bayesian.p_b_gt_a > 0.95
        ? 'Ganador B'
        : bayesian.p_b_gt_a < 0.05
          ? 'Ganador A'
          : 'Inconcluso',
  };

  const qualityFlags = [];
  if ((videoA.video_type || '') !== (videoB.video_type || '')) qualityFlags.push('Tipos de video mezclados (bloqueado recomendado)');
  if (toNumber(videoA.ctr) > 1 || toNumber(videoB.ctr) > 1) qualityFlags.push('CTR inconsistente > 1');

  const decision = !exposureOk
    ? 'Inconcluso'
    : (frequentist.winner === 'Inconcluso' ? sequential.decision : `Ganador ${frequentist.winner}`);

  return {
    primary_metric: primaryMetric,
    values: { A: aValue, B: bValue },
    frequentist,
    bayesian,
    sequential,
    quality_flags: qualityFlags,
    decision,
    recommendations: decision === 'Ganador B'
      ? ['Escalar variante B', 'Mantener monitoreo de calidad', 'Documentar aprendizaje creativo']
      : decision === 'Ganador A'
        ? ['Mantener variante A', 'Iterar elementos de B', 'Repetir test con más muestra']
        : ['Recolectar más muestra', 'Evitar decisiones tempranas', 'Revisar CTA/hook según señales'],
  };
}
