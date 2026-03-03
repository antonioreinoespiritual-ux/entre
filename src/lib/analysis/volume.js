export function normalizeVolumeUnit(unit) {
  return String(unit || '').trim().toLowerCase() || 'videos';
}

export function getVolumeField(unit) {
  const normalized = normalizeVolumeUnit(unit);
  const map = {
    views: 'views',
    clicks: 'clicks',
    ctr: 'ctr',
    cpc: 'cpc',
    initiate_checkout_rate: 'initiate_checkout_rate',
    view_content_rate: 'view_content_rate',
    lead_rate: 'lead_rate',
    purchase_rate: 'purchase_rate',
    videos: 'videos',
    initiatest: 'initiatest',
    duration_min: 'duracion_min',
    duracion_min: 'duracion_min',
    sessions: 'sessions',
  };
  return map[normalized] || 'videos';
}

function toNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function computeCurrentVolume(videos = [], unit = 'videos') {
  const field = getVolumeField(unit);
  if (field === 'videos') return videos.length;
  if (field === 'sessions') {
    const unique = new Set();
    videos.forEach((video) => {
      const id = video.external_id || video.session_id || video.ad_id || video.live_id;
      if (id) unique.add(String(id));
    });
    return unique.size || videos.length;
  }

  if (field === 'initiate_checkout_rate') {
    const totals = videos.reduce((acc, video) => {
      acc.views += toNumber(video.views);
      acc.initiateCheckouts += toNumber(video.initiate_checkouts);
      return acc;
    }, { views: 0, initiateCheckouts: 0 });
    return totals.views > 0 ? totals.initiateCheckouts / totals.views : 0;
  }

  if (field === 'view_content_rate') {
    const totals = videos.reduce((acc, video) => {
      acc.views += toNumber(video.views);
      acc.viewContent += toNumber(video.view_content);
      return acc;
    }, { views: 0, viewContent: 0 });
    return totals.views > 0 ? totals.viewContent / totals.views : 0;
  }

  if (field === 'lead_rate') {
    const totals = videos.reduce((acc, video) => {
      acc.views += toNumber(video.views);
      acc.leads += toNumber(video.formulario_lead);
      return acc;
    }, { views: 0, leads: 0 });
    return totals.views > 0 ? totals.leads / totals.views : 0;
  }

  if (field === 'purchase_rate') {
    const totals = videos.reduce((acc, video) => {
      acc.viewContent += toNumber(video.view_content);
      acc.purchase += toNumber(video.purchase);
      return acc;
    }, { viewContent: 0, purchase: 0 });
    return totals.viewContent > 0 ? totals.purchase / totals.viewContent : 0;
  }

  return videos.reduce((sum, video) => sum + toNumber(video[field]), 0);
}

export function buildVolumeSnapshot({ videos = [], minimum = 0, unit = 'videos', hypothesisId = '' } = {}) {
  const current = computeCurrentVolume(videos, unit);
  const min = toNumber(minimum);
  return {
    hypothesis_id: hypothesisId,
    unit: normalizeVolumeUnit(unit),
    minimum: min,
    current,
    count_videos: videos.length,
    meets_minimum: current >= min,
  };
}
