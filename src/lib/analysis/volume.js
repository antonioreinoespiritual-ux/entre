export function normalizeVolumeUnit(unit) {
  return String(unit || '').trim().toLowerCase() || 'videos';
}

export function getVolumeField(unit) {
  const normalized = normalizeVolumeUnit(unit);
  const map = {
    views: 'views',
    clicks: 'clicks',
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
