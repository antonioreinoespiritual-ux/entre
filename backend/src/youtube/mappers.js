export function mapYouTubeChannel(item = {}) {
  return {
    id: item.id || '',
    title: item?.snippet?.title || '',
    description: item?.snippet?.description || '',
    customUrl: item?.snippet?.customUrl || '',
    publishedAt: item?.snippet?.publishedAt || null,
    thumbnails: item?.snippet?.thumbnails || {},
    country: item?.snippet?.country || '',
    viewCount: Number(item?.statistics?.viewCount || 0),
    subscriberCount: Number(item?.statistics?.subscriberCount || 0),
    videoCount: Number(item?.statistics?.videoCount || 0),
  };
}

export function mapYouTubeVideo(item = {}) {
  return {
    id: item.id || item?.id?.videoId || '',
    title: item?.snippet?.title || '',
    description: item?.snippet?.description || '',
    channelId: item?.snippet?.channelId || '',
    channelTitle: item?.snippet?.channelTitle || '',
    publishedAt: item?.snippet?.publishedAt || null,
    thumbnails: item?.snippet?.thumbnails || {},
    duration: item?.contentDetails?.duration || '',
    viewCount: Number(item?.statistics?.viewCount || 0),
    likeCount: Number(item?.statistics?.likeCount || 0),
    commentCount: Number(item?.statistics?.commentCount || 0),
  };
}

export function mapYouTubePlaylist(item = {}) {
  return {
    id: item.id || '',
    title: item?.snippet?.title || '',
    description: item?.snippet?.description || '',
    channelId: item?.snippet?.channelId || '',
    channelTitle: item?.snippet?.channelTitle || '',
    publishedAt: item?.snippet?.publishedAt || null,
    thumbnails: item?.snippet?.thumbnails || {},
    itemCount: Number(item?.contentDetails?.itemCount || 0),
  };
}

export function mapYouTubeCommentThread(item = {}) {
  const top = item?.snippet?.topLevelComment?.snippet || {};
  return {
    id: item.id || '',
    videoId: item?.snippet?.videoId || '',
    channelId: top.channelId || '',
    authorDisplayName: top.authorDisplayName || '',
    authorChannelId: top?.authorChannelId?.value || '',
    textDisplay: top.textDisplay || '',
    textOriginal: top.textOriginal || '',
    likeCount: Number(top.likeCount || 0),
    publishedAt: top.publishedAt || null,
    updatedAt: top.updatedAt || null,
    replyCount: Number(item?.snippet?.totalReplyCount || 0),
  };
}

export function mapYouTubeComment(item = {}) {
  const snippet = item?.snippet || {};
  return {
    id: item.id || '',
    parentId: snippet.parentId || '',
    authorDisplayName: snippet.authorDisplayName || '',
    authorChannelId: snippet?.authorChannelId?.value || '',
    textDisplay: snippet.textDisplay || '',
    textOriginal: snippet.textOriginal || '',
    likeCount: Number(snippet.likeCount || 0),
    publishedAt: snippet.publishedAt || null,
    updatedAt: snippet.updatedAt || null,
  };
}
