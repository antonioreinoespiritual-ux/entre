
import React, { createContext, useContext, useState, useCallback, useEffect } from 'react';
import { supabase } from '@/lib/customSupabaseClient';
import { useToast } from '@/components/ui/use-toast';

const VideoContext = createContext();

export const useVideos = () => {
  const context = useContext(VideoContext);
  if (!context) {
    throw new Error('useVideos must be used within VideoProvider');
  }
  return context;
};

export const VideoProvider = ({ children }) => {
  const [videos, setVideos] = useState([]);
  const [loading, setLoading] = useState(false);
  const [currentUser, setCurrentUser] = useState(null);
  const { toast } = useToast();

  useEffect(() => {
    const getCurrentUser = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        setCurrentUser(user);
      }
    };
    getCurrentUser();
  }, []);

  const validateHypothesesForVideo = useCallback(async (audienceId, videoMetrics) => {
    if (!currentUser) return;
    try {
      const { data: audience, error: audienceError } = await supabase
        .from('audiences')
        .select('campaign_id')
        .eq('id', audienceId)
        .eq('user_id', currentUser.id)
        .single();

      if (audienceError) throw audienceError;

      const { data: hypotheses, error: hypothesesError } = await supabase
        .from('hypotheses')
        .select('*')
        .eq('campaign_id', audience.campaign_id)
        .eq('user_id', currentUser.id);

      if (hypothesesError) throw hypothesesError;

      for (const hypothesis of hypotheses) {
        try {
          let isValidated = false;
          const condition = hypothesis.condition.toLowerCase();

          if (condition.includes('views') && videoMetrics.views > 1000) {
            isValidated = true;
          }
          if (condition.includes('engagement') && videoMetrics.engagement > 5) {
            isValidated = true;
          }
          if (condition.includes('likes') && videoMetrics.likes > 100) {
            isValidated = true;
          }

          if (isValidated && hypothesis.validation_status !== 'Validada') {
            await supabase
              .from('hypotheses')
              .update({ validation_status: 'Validada' })
              .eq('id', hypothesis.id)
              .eq('user_id', currentUser.id);
          }
        } catch (err) {
          console.error('Error validating hypothesis:', err);
        }
      }
    } catch (error) {
      console.error('Error in hypothesis validation:', error);
    }
  }, [currentUser]);

  const fetchVideos = useCallback(async (audienceId) => {
    if (!currentUser) return [];
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('videos')
        .select('*')
        .eq('audience_id', audienceId)
        .eq('user_id', currentUser.id)
        .order('created_at', { ascending: false });

      if (error) throw error;

      setVideos(data || []);
      return data;
    } catch (error) {
      toast({
        title: 'Error',
        description: `Failed to fetch videos: ${error.message}`,
        variant: 'destructive',
      });
      return [];
    } finally {
      setLoading(false);
    }
  }, [toast, currentUser]);

  const createVideo = useCallback(async (videoData) => {
    if (!currentUser) return null;
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('videos')
        .insert([{ ...videoData, user_id: currentUser.id }])
        .select()
        .single();

      if (error) throw error;

      toast({
        title: 'Success',
        description: 'Video created successfully',
      });

      await validateHypothesesForVideo(videoData.audience_id, videoData);

      if (videoData.audience_id) {
        await fetchVideos(videoData.audience_id);
      }
      return data;
    } catch (error) {
      toast({
        title: 'Error',
        description: `Failed to create video: ${error.message}`,
        variant: 'destructive',
      });
      return null;
    } finally {
      setLoading(false);
    }
  }, [toast, fetchVideos, validateHypothesesForVideo, currentUser]);

  const updateVideo = useCallback(async (id, videoData) => {
    if (!currentUser) return null;
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('videos')
        .update(videoData)
        .eq('id', id)
        .eq('user_id', currentUser.id)
        .select()
        .single();

      if (error) throw error;

      toast({
        title: 'Success',
        description: 'Video updated successfully',
      });

      if (data) {
        await validateHypothesesForVideo(data.audience_id, data);
      }

      return data;
    } catch (error) {
      toast({
        title: 'Error',
        description: `Failed to update video: ${error.message}`,
        variant: 'destructive',
      });
      return null;
    } finally {
      setLoading(false);
    }
  }, [toast, validateHypothesesForVideo, currentUser]);

  const deleteVideo = useCallback(async (id, audienceId) => {
    if (!currentUser) return false;
    setLoading(true);
    try {
      const { error } = await supabase
        .from('videos')
        .delete()
        .eq('id', id)
        .eq('user_id', currentUser.id);

      if (error) throw error;

      toast({
        title: 'Success',
        description: 'Video deleted successfully',
      });

      if (audienceId) {
        await fetchVideos(audienceId);
      }
      return true;
    } catch (error) {
      toast({
        title: 'Error',
        description: `Failed to delete video: ${error.message}`,
        variant: 'destructive',
      });
      return false;
    } finally {
      setLoading(false);
    }
  }, [toast, fetchVideos, currentUser]);

  const value = {
    videos,
    loading,
    fetchVideos,
    createVideo,
    updateVideo,
    deleteVideo,
  };

  return (
    <VideoContext.Provider value={value}>
      {children}
    </VideoContext.Provider>
  );
};
