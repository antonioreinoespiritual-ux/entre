
import React, { createContext, useContext, useState, useCallback, useEffect } from 'react';
import { supabase } from '@/lib/customSupabaseClient';
import { useToast } from '@/components/ui/use-toast';

const HypothesisContext = createContext();

export const useHypotheses = () => {
  const context = useContext(HypothesisContext);
  if (!context) {
    throw new Error('useHypotheses must be used within HypothesisProvider');
  }
  return context;
};

export const HypothesisProvider = ({ children }) => {
  const [hypotheses, setHypotheses] = useState([]);
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

  const validateHypothesis = useCallback((hypothesis, videoMetrics) => {
    try {
      const condition = hypothesis.condition.toLowerCase();
      
      if (condition.includes('views') && condition.includes('>')) {
        const threshold = parseInt(condition.match(/\d+/)?.[0] || '0');
        return videoMetrics.views > threshold;
      }
      
      if (condition.includes('engagement') && condition.includes('>')) {
        const threshold = parseFloat(condition.match(/[\d.]+/)?.[0] || '0');
        return videoMetrics.engagement > threshold;
      }
      
      if (condition.includes('likes') && condition.includes('>')) {
        const threshold = parseInt(condition.match(/\d+/)?.[0] || '0');
        return videoMetrics.likes > threshold;
      }
      
      if (condition.includes('shares') && condition.includes('>')) {
        const threshold = parseInt(condition.match(/\d+/)?.[0] || '0');
        return videoMetrics.shares > threshold;
      }
      
      if (condition.includes('comments') && condition.includes('>')) {
        const threshold = parseInt(condition.match(/\d+/)?.[0] || '0');
        return videoMetrics.comments > threshold;
      }
      
      if (condition.includes('cpc') && condition.includes('<')) {
        const threshold = parseFloat(condition.match(/[\d.]+/)?.[0] || '999');
        return videoMetrics.cpc < threshold;
      }
      
      return false;
    } catch (error) {
      console.error('Error validating hypothesis:', error);
      return false;
    }
  }, []);

  const fetchHypotheses = useCallback(async (campaignId) => {
    if (!currentUser) return [];
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('hypotheses')
        .select('*')
        .eq('campaign_id', campaignId)
        .eq('user_id', currentUser.id)
        .order('created_at', { ascending: false });

      if (error) throw error;

      setHypotheses(data || []);
      return data;
    } catch (error) {
      toast({
        title: 'Error',
        description: `Failed to fetch hypotheses: ${error.message}`,
        variant: 'destructive',
      });
      return [];
    } finally {
      setLoading(false);
    }
  }, [toast, currentUser]);

  const createHypothesis = useCallback(async (hypothesisData) => {
    if (!currentUser) return null;
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('hypotheses')
        .insert([{ ...hypothesisData, validation_status: 'No Validada', user_id: currentUser.id }])
        .select()
        .single();

      if (error) throw error;

      toast({
        title: 'Success',
        description: 'Hypothesis created successfully',
      });

      if (hypothesisData.campaign_id) {
        await fetchHypotheses(hypothesisData.campaign_id);
      }
      return data;
    } catch (error) {
      toast({
        title: 'Error',
        description: `Failed to create hypothesis: ${error.message}`,
        variant: 'destructive',
      });
      return null;
    } finally {
      setLoading(false);
    }
  }, [toast, fetchHypotheses, currentUser]);

  const updateHypothesis = useCallback(async (id, hypothesisData) => {
    if (!currentUser) return null;
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('hypotheses')
        .update(hypothesisData)
        .eq('id', id)
        .eq('user_id', currentUser.id)
        .select()
        .single();

      if (error) throw error;

      toast({
        title: 'Success',
        description: 'Hypothesis updated successfully',
      });

      return data;
    } catch (error) {
      toast({
        title: 'Error',
        description: `Failed to update hypothesis: ${error.message}`,
        variant: 'destructive',
      });
      return null;
    } finally {
      setLoading(false);
    }
  }, [toast, currentUser]);

  const deleteHypothesis = useCallback(async (id, campaignId) => {
    if (!currentUser) return false;
    setLoading(true);
    try {
      const { error } = await supabase
        .from('hypotheses')
        .delete()
        .eq('id', id)
        .eq('user_id', currentUser.id);

      if (error) throw error;

      toast({
        title: 'Success',
        description: 'Hypothesis deleted successfully',
      });

      if (campaignId) {
        await fetchHypotheses(campaignId);
      }
      return true;
    } catch (error) {
      toast({
        title: 'Error',
        description: `Failed to delete hypothesis: ${error.message}`,
        variant: 'destructive',
      });
      return false;
    } finally {
      setLoading(false);
    }
  }, [toast, fetchHypotheses, currentUser]);

  const value = {
    hypotheses,
    loading,
    fetchHypotheses,
    createHypothesis,
    updateHypothesis,
    deleteHypothesis,
    validateHypothesis,
  };

  return (
    <HypothesisContext.Provider value={value}>
      {children}
    </HypothesisContext.Provider>
  );
};
