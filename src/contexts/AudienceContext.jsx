
import React, { createContext, useContext, useState, useCallback } from 'react';
import { supabase } from '@/lib/customSupabaseClient';
import { useToast } from '@/components/ui/use-toast';
import { useAuth } from '@/contexts/SupabaseAuthContext';

const AudienceContext = createContext();

export const useAudiences = () => {
  const context = useContext(AudienceContext);
  if (!context) {
    throw new Error('useAudiences must be used within AudienceProvider');
  }
  return context;
};

export const AudienceProvider = ({ children }) => {
  const [audiences, setAudiences] = useState([]);
  const [loading, setLoading] = useState(false);
  const { toast } = useToast();
  const { currentUser } = useAuth();

  const fetchAudiences = useCallback(async (campaignId) => {
    if (!currentUser) return [];
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('audiences')
        .select(`
          *
        `)
        .eq('campaign_id', campaignId)
        .eq('user_id', currentUser.id)
        .order('created_at', { ascending: false });

      if (error) throw error;

      setAudiences(data || []);
      return data;
    } catch (error) {
      toast({
        title: 'Error',
        description: `Failed to fetch audiences: ${error.message}`,
        variant: 'destructive',
      });
      return [];
    } finally {
      setLoading(false);
    }
  }, [toast, currentUser]);

  const createAudience = useCallback(async (audienceData) => {
    if (!currentUser) return null;
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('audiences')
        .insert([{ ...audienceData, user_id: currentUser.id }])
        .select()
        .single();

      if (error) throw error;

      toast({
        title: 'Success',
        description: 'Audience created successfully',
      });

      if (audienceData.campaign_id) {
        await fetchAudiences(audienceData.campaign_id);
      }
      return data;
    } catch (error) {
      toast({
        title: 'Error',
        description: `Failed to create audience: ${error.message}`,
        variant: 'destructive',
      });
      return null;
    } finally {
      setLoading(false);
    }
  }, [toast, fetchAudiences, currentUser]);

  const updateAudience = useCallback(async (id, audienceData) => {
    if (!currentUser) return null;
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('audiences')
        .update(audienceData)
        .eq('id', id)
        .eq('user_id', currentUser.id)
        .select()
        .single();

      if (error) throw error;

      toast({
        title: 'Success',
        description: 'Audience updated successfully',
      });

      return data;
    } catch (error) {
      toast({
        title: 'Error',
        description: `Failed to update audience: ${error.message}`,
        variant: 'destructive',
      });
      return null;
    } finally {
      setLoading(false);
    }
  }, [toast, currentUser]);

  const deleteAudience = useCallback(async (id, campaignId) => {
    if (!currentUser) return false;
    setLoading(true);
    try {
      const { error } = await supabase
        .from('audiences')
        .delete()
        .eq('id', id)
        .eq('user_id', currentUser.id);

      if (error) throw error;

      toast({
        title: 'Success',
        description: 'Audience deleted successfully',
      });

      if (campaignId) {
        await fetchAudiences(campaignId);
      }
      return true;
    } catch (error) {
      toast({
        title: 'Error',
        description: `Failed to delete audience: ${error.message}`,
        variant: 'destructive',
      });
      return false;
    } finally {
      setLoading(false);
    }
  }, [toast, fetchAudiences, currentUser]);

  const value = {
    audiences,
    loading,
    fetchAudiences,
    createAudience,
    updateAudience,
    deleteAudience,
  };

  return (
    <AudienceContext.Provider value={value}>
      {children}
    </AudienceContext.Provider>
  );
};
