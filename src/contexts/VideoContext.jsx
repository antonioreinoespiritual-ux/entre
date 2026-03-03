import React, { createContext, useContext, useState, useCallback } from 'react';
import { supabase } from '@/lib/customSupabaseClient';
import { useToast } from '@/components/ui/use-toast';
import { useAuth } from '@/contexts/SupabaseAuthContext';

const VideoContext = createContext();

export const useVideos = () => {
  const context = useContext(VideoContext);
  if (!context) {
    throw new Error('useVideos must be used within VideoProvider');
  }
  return context;
};

const backendBaseUrl = () => import.meta.env.VITE_BACKEND_URL || 'http://localhost:4000';
const sessionToken = () => {
  const session = JSON.parse(localStorage.getItem('mysql_backend_session') || 'null');
  return session?.access_token || '';
};

export const VideoProvider = ({ children }) => {
  const [videos, setVideos] = useState([]);
  const [loading, setLoading] = useState(false);
  const { toast } = useToast();
  const { currentUser } = useAuth();

  const fetchVideos = useCallback(async (hypothesisId, options = {}) => {
    if (!currentUser || !hypothesisId) return [];
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (options.video_type) params.set('video_type', options.video_type);
      const suffix = params.toString() ? `?${params.toString()}` : '';
      const response = await fetch(`${backendBaseUrl()}/api/hypotheses/${hypothesisId}/videos${suffix}`, {
        headers: { Authorization: `Bearer ${sessionToken()}` },
      });
      const json = await response.json();
      if (!response.ok) throw new Error(json.error || 'Failed to fetch videos');

      const data = Array.isArray(json.data) ? json.data : [];
      setVideos(data);
      return data;
    } catch (error) {
      toast({ title: 'Error', description: `Failed to fetch videos: ${error.message}`, variant: 'destructive' });
      return [];
    } finally {
      setLoading(false);
    }
  }, [toast, currentUser]);

  const fetchCampaignVideos = useCallback(async (campaignId, options = {}) => {
    if (!currentUser || !campaignId) return { data: [], campaign: null };
    const params = new URLSearchParams();
    if (options.video_type) params.set('video_type', options.video_type);
    if (options.search) params.set('search', options.search);
    if (options.session_id) params.set('session_id', options.session_id);
    if (options.usage) params.set('usage', options.usage);
    const suffix = params.toString() ? `?${params.toString()}` : '';
    const response = await fetch(`${backendBaseUrl()}/api/campaigns/${campaignId}/videos${suffix}`, {
      headers: { Authorization: `Bearer ${sessionToken()}` },
    });
    const json = await response.json();
    if (!response.ok) throw new Error(json.error || 'Failed to fetch campaign videos');
    return { data: Array.isArray(json.data) ? json.data : [], campaign: json.campaign || null };
  }, [currentUser]);

  const fetchProjectVideos = useCallback(async (projectId, options = {}) => {
    if (!currentUser || !projectId) return { data: [], project: null };
    const params = new URLSearchParams();
    if (options.video_type) params.set('video_type', options.video_type);
    if (options.search) params.set('search', options.search);
    if (options.session_id) params.set('session_id', options.session_id);
    if (options.usage) params.set('usage', options.usage);
    const suffix = params.toString() ? `?${params.toString()}` : '';
    const response = await fetch(`${backendBaseUrl()}/api/projects/${projectId}/videos${suffix}`, {
      headers: { Authorization: `Bearer ${sessionToken()}` },
    });
    const json = await response.json();
    if (!response.ok) throw new Error(json.error || 'Failed to fetch project videos');
    return { data: Array.isArray(json.data) ? json.data : [], project: json.project || null };
  }, [currentUser]);




  const createGlobalVideo = useCallback(async (payload) => {
    if (!currentUser) return null;
    const response = await fetch(`${backendBaseUrl()}/api/videos`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${sessionToken()}`,
      },
      body: JSON.stringify(payload),
    });
    const json = await response.json();
    if (!response.ok) throw new Error(json.error || 'Failed to create video');
    return Array.isArray(json.data) ? json.data[0] : null;
  }, [currentUser]);

  const updateVideo = useCallback(async (videoId, payload) => {
    if (!currentUser || !videoId) return null;
    const response = await fetch(`${backendBaseUrl()}/api/videos/${videoId}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${sessionToken()}`,
      },
      body: JSON.stringify(payload),
    });
    const json = await response.json();
    if (!response.ok) throw new Error(json.error || 'Failed to update video');
    return json.video || null;
  }, [currentUser]);



  const upsertHypothesisAudience = useCallback(async (payload) => {
    if (!currentUser) return null;
    const response = await fetch(`${backendBaseUrl()}/api/hypothesis_videos`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${sessionToken()}`,
      },
      body: JSON.stringify(payload),
    });
    const json = await response.json();
    if (!response.ok) {
      const error = new Error(json.error || 'Failed to save hypothesis audience');
      if (json.code) error.code = json.code;
      if (json.fields) error.fields = json.fields;
      throw error;
    }
    return json.data || null;
  }, [currentUser]);

  const fetchProjectHypotheses = useCallback(async (projectId) => {
    if (!currentUser || !projectId) return [];
    const response = await fetch(`${backendBaseUrl()}/api/projects/${projectId}/hypotheses`, {
      headers: { Authorization: `Bearer ${sessionToken()}` },
    });
    const json = await response.json();
    if (!response.ok) throw new Error(json.error || 'Failed to fetch hypotheses');
    return Array.isArray(json.data) ? json.data : [];
  }, [currentUser]);

  const linkVideosToHypothesis = useCallback(async (hypothesisId, videoIds) => {
    if (!currentUser || !hypothesisId) return null;
    const response = await fetch(`${backendBaseUrl()}/api/hypotheses/${hypothesisId}/videos/link`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${sessionToken()}`,
      },
      body: JSON.stringify({ video_ids: videoIds }),
    });
    const json = await response.json();
    if (!response.ok) throw new Error(json.error || 'Failed to link videos');
    return json;
  }, [currentUser]);

  const linkVideoToHypotheses = useCallback(async (videoId, hypothesisIds) => {
    if (!currentUser || !videoId) return null;
    const response = await fetch(`${backendBaseUrl()}/api/videos/${videoId}/link-hypotheses`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${sessionToken()}`,
      },
      body: JSON.stringify({ hypothesis_ids: hypothesisIds }),
    });
    const json = await response.json();
    if (!response.ok) throw new Error(json.error || 'Failed to link video to hypotheses');
    return json;
  }, [currentUser]);

  const deleteVideo = useCallback(async (id, hypothesisId) => {
    if (!currentUser) return false;
    setLoading(true);
    try {
      const { error } = await supabase
        .from('videos')
        .delete()
        .eq('id', id)
        .eq('user_id', currentUser.id);

      if (error) throw error;

      toast({ title: 'Success', description: 'Video deleted successfully' });

      if (hypothesisId) {
        await fetchVideos(hypothesisId);
      }
      return true;
    } catch (error) {
      toast({ title: 'Error', description: `Failed to delete video: ${error.message}`, variant: 'destructive' });
      return false;
    } finally {
      setLoading(false);
    }
  }, [toast, fetchVideos, currentUser]);

  const value = {
    videos,
    loading,
    fetchVideos,
    fetchCampaignVideos,
    fetchProjectVideos,
    createGlobalVideo,
    updateVideo,
    upsertHypothesisAudience,
    fetchProjectHypotheses,
    linkVideosToHypothesis,
    linkVideoToHypotheses,
    deleteVideo,
  };

  return (
    <VideoContext.Provider value={value}>
      {children}
    </VideoContext.Provider>
  );
};
