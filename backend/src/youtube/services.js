import { youtubeApiRequest } from './client.js';
import {
  mapYouTubeChannel,
  mapYouTubeVideo,
  mapYouTubePlaylist,
  mapYouTubeCommentThread,
  mapYouTubeComment,
} from './mappers.js';

function withParts(params = {}, defaultPart) {
  return {
    ...params,
    part: params.part || defaultPart,
  };
}

export async function listYouTubeChannels({ config, auth, params }) {
  const response = await youtubeApiRequest({
    baseUrl: config.apiBaseUrl,
    path: '/channels',
    params: withParts(params, 'snippet,statistics,contentDetails'),
    accessToken: auth?.accessToken,
    apiKey: auth?.apiKey,
  });
  return {
    ...response,
    data: {
      nextPageToken: response?.data?.nextPageToken || null,
      prevPageToken: response?.data?.prevPageToken || null,
      items: (response?.data?.items || []).map(mapYouTubeChannel),
    },
  };
}

export async function listYouTubeVideos({ config, auth, params }) {
  const response = await youtubeApiRequest({
    baseUrl: config.apiBaseUrl,
    path: '/videos',
    params: withParts(params, 'snippet,statistics,contentDetails'),
    accessToken: auth?.accessToken,
    apiKey: auth?.apiKey,
  });
  return {
    ...response,
    data: {
      nextPageToken: response?.data?.nextPageToken || null,
      prevPageToken: response?.data?.prevPageToken || null,
      items: (response?.data?.items || []).map(mapYouTubeVideo),
    },
  };
}

export async function listYouTubePlaylists({ config, auth, params }) {
  const response = await youtubeApiRequest({
    baseUrl: config.apiBaseUrl,
    path: '/playlists',
    params: withParts(params, 'snippet,contentDetails'),
    accessToken: auth?.accessToken,
    apiKey: auth?.apiKey,
  });
  return {
    ...response,
    data: {
      nextPageToken: response?.data?.nextPageToken || null,
      prevPageToken: response?.data?.prevPageToken || null,
      items: (response?.data?.items || []).map(mapYouTubePlaylist),
    },
  };
}

export async function listYouTubeCommentThreads({ config, auth, params }) {
  const response = await youtubeApiRequest({
    baseUrl: config.apiBaseUrl,
    path: '/commentThreads',
    params: withParts(params, 'snippet,replies'),
    accessToken: auth?.accessToken,
    apiKey: auth?.apiKey,
  });
  return {
    ...response,
    data: {
      nextPageToken: response?.data?.nextPageToken || null,
      prevPageToken: response?.data?.prevPageToken || null,
      items: (response?.data?.items || []).map(mapYouTubeCommentThread),
    },
  };
}

export async function listYouTubeComments({ config, auth, params }) {
  const response = await youtubeApiRequest({
    baseUrl: config.apiBaseUrl,
    path: '/comments',
    params: withParts(params, 'snippet'),
    accessToken: auth?.accessToken,
    apiKey: auth?.apiKey,
  });
  return {
    ...response,
    data: {
      nextPageToken: response?.data?.nextPageToken || null,
      prevPageToken: response?.data?.prevPageToken || null,
      items: (response?.data?.items || []).map(mapYouTubeComment),
    },
  };
}
