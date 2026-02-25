
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

export const VideoProvider = ({ children }) => {
  const [videos, setVideos] = useState([]);
  const [loading, setLoading] = useState(false);
  const { toast } = useToast();
  const { currentUser } = useAuth();

  const validateHypothesisForVideo = useCallback(async (hypothesisId, videoMetrics) => {
    if (!currentUser || !hypothesisId) return;
    try {
      const { data: hypothesis, error } = await supabase
        .from('hypotheses')
        .select('*')
        .eq('id', hypothesisId)
        .eq('user_id', currentUser.id)
        .single();

      if (error || !hypothesis) return;

      let isValidated = false;
      const condition = String(hypothesis.condition || '').toLowerCase();
      if (condition.includes('views') && Number(videoMetrics.views) > 1000) isValidated = true;
      if (condition.includes('engagement') && Number(videoMetrics.engagement) > 5) isValidated = true;
      if (condition.includes('likes') && Number(videoMetrics.likes) > 100) isValidated = true;

      if (isValidated && hypothesis.validation_status !== 'Validada') {
        await supabase
          .from('hypotheses')
          .update({ validation_status: 'Validada' })
          .eq('id', hypothesis.id)
          .eq('user_id', currentUser.id);
      }
    } catch (error) {
      console.error('Error validating hypothesis:', error);
    }
  }, [currentUser]);

  const fetchVideos = useCallback(async (hypothesisId) => {
    if (!currentUser || !hypothesisId) return [];
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('videos')
        .select('*')
        .eq('hypothesis_id', hypothesisId)
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

      await validateHypothesisForVideo(videoData.hypothesis_id, videoData);
      if (videoData.hypothesis_id) {
        await fetchVideos(videoData.hypothesis_id);
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
  }, [toast, fetchVideos, validateHypothesisForVideo, currentUser]);

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

      toast({
        title: 'Success',
        description: 'Video deleted successfully',
      });

      if (hypothesisId) {
        await fetchVideos(hypothesisId);
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
    deleteVideo,
  };

  return (
    <VideoContext.Provider value={value}>
      {children}
    </VideoContext.Provider>
  );
};
