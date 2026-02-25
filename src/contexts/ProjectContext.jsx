
import React, { createContext, useContext, useState, useCallback, useEffect } from 'react';
import { supabase } from '@/lib/customSupabaseClient';
import { useToast } from '@/components/ui/use-toast';

const ProjectContext = createContext();

export const useProjects = () => {
  const context = useContext(ProjectContext);
  if (!context) {
    throw new Error('useProjects must be used within ProjectProvider');
  }
  return context;
};

export const ProjectProvider = ({ children }) => {
  const [projects, setProjects] = useState([]);
  const [loading, setLoading] = useState(false);
  const [currentUser, setCurrentUser] = useState(null);
  const { toast } = useToast();

  useEffect(() => {
    let active = true;

    const getCurrentUser = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!active) return;
      if (user) {
        setCurrentUser(user);
      }
    };

    getCurrentUser();
    const retryTimer = setInterval(() => {
      if (!currentUser) {
        getCurrentUser();
      }
    }, 1000);

    return () => {
      active = false;
      clearInterval(retryTimer);
    };
  }, [currentUser]);

  const fetchProjects = useCallback(async () => {
    if (!currentUser) return [];
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('projects')
        .select(`
          *,
          campaigns:campaigns(count)
        `)
        .eq('user_id', currentUser.id)
        .order('created_at', { ascending: false });

      if (error) throw error;

      setProjects(data || []);
      return data;
    } catch (error) {
      toast({
        title: 'Error',
        description: `Failed to fetch projects: ${error.message}`,
        variant: 'destructive',
      });
      return [];
    } finally {
      setLoading(false);
    }
  }, [toast, currentUser]);

  const fetchProjectById = useCallback(async (id) => {
    if (!currentUser) return null;
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('projects')
        .select(`
          *,
          campaigns:campaigns(*)
        `)
        .eq('id', id)
        .eq('user_id', currentUser.id)
        .single();

      if (error) throw error;

      return data;
    } catch (error) {
      toast({
        title: 'Error',
        description: `Failed to fetch project: ${error.message}`,
        variant: 'destructive',
      });
      return null;
    } finally {
      setLoading(false);
    }
  }, [toast, currentUser]);

  const createProject = useCallback(async (projectData) => {
    if (!currentUser) return null;
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('projects')
        .insert([{ ...projectData, user_id: currentUser.id }])
        .select()
        .single();

      if (error) throw error;

      toast({
        title: 'Success',
        description: 'Project created successfully',
      });

      await fetchProjects();
      return data;
    } catch (error) {
      toast({
        title: 'Error',
        description: `Failed to create project: ${error.message}`,
        variant: 'destructive',
      });
      return null;
    } finally {
      setLoading(false);
    }
  }, [toast, fetchProjects, currentUser]);

  const updateProject = useCallback(async (id, projectData) => {
    if (!currentUser) return null;
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('projects')
        .update(projectData)
        .eq('id', id)
        .eq('user_id', currentUser.id)
        .select()
        .single();

      if (error) throw error;

      toast({
        title: 'Success',
        description: 'Project updated successfully',
      });

      await fetchProjects();
      return data;
    } catch (error) {
      toast({
        title: 'Error',
        description: `Failed to update project: ${error.message}`,
        variant: 'destructive',
      });
      return null;
    } finally {
      setLoading(false);
    }
  }, [toast, fetchProjects, currentUser]);

  const deleteProject = useCallback(async (id) => {
    if (!currentUser) return false;
    setLoading(true);
    try {
      const { error } = await supabase
        .from('projects')
        .delete()
        .eq('id', id)
        .eq('user_id', currentUser.id);

      if (error) throw error;

      toast({
        title: 'Success',
        description: 'Project deleted successfully',
      });

      await fetchProjects();
      return true;
    } catch (error) {
      toast({
        title: 'Error',
        description: `Failed to delete project: ${error.message}`,
        variant: 'destructive',
      });
      return false;
    } finally {
      setLoading(false);
    }
  }, [toast, fetchProjects, currentUser]);

  const value = {
    projects,
    loading,
    fetchProjects,
    fetchProjectById,
    createProject,
    updateProject,
    deleteProject,
  };

  return (
    <ProjectContext.Provider value={value}>
      {children}
    </ProjectContext.Provider>
  );
};
