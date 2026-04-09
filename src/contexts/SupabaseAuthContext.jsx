
import React, { createContext, useContext, useEffect, useState, useCallback, useMemo } from 'react';
import { supabase } from '@/lib/customSupabaseClient';
import { useToast } from '@/components/ui/use-toast';

const AuthContext = createContext(undefined);
// 4 s is enough: Supabase getSession() reads from localStorage and should
// resolve in milliseconds.  A long timeout here directly maps to how long
// ProtectedRoute shows a spinner when the auth service is unreachable.
const AUTH_BOOTSTRAP_TIMEOUT_MS = 4000;

export const AuthProvider = ({ children }) => {
  const { toast } = useToast();

  const [user, setUser] = useState(null);
  const [currentUser, setCurrentUser] = useState(null);
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);

  const handleSession = useCallback(async (session) => {
    setSession(session);
    const sessionUser = session?.user ?? null;
    setUser(sessionUser);
    setCurrentUser(sessionUser ? { id: sessionUser.id, ...sessionUser } : null);
    setLoading(false);
  }, []);

  useEffect(() => {
    let mounted = true;
    const timeoutId = setTimeout(() => {
      if (!mounted) return;
      console.warn('[Auth] Bootstrap timeout reached — forcing loading=false. Supabase did not respond in time.');
      setLoading(false);
    }, AUTH_BOOTSTRAP_TIMEOUT_MS);

    const getSession = async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!mounted) return;
        handleSession(session);
      } catch {
        if (!mounted) return;
        handleSession(null);
      }
    };

    getSession();

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, session) => {
        if (!mounted) return;
        handleSession(session);
      }
    );

    return () => {
      mounted = false;
      clearTimeout(timeoutId);
      subscription.unsubscribe();
    };
  }, [handleSession]);

  const signUp = useCallback(async (email, password, options) => {
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options,
    });

    if (error) {
      toast({
        variant: "destructive",
        title: "Sign up Failed",
        description: error.message || "Something went wrong",
      });
    }

    return { error };
  }, [toast]);

  const signIn = useCallback(async (email, password) => {
    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error) {
      toast({
        variant: "destructive",
        title: "Sign in Failed",
        description: error.message || "Something went wrong",
      });
    }

    return { error };
  }, [toast]);

  const signOut = useCallback(async () => {
    const { error } = await supabase.auth.signOut();

    if (error) {
      toast({
        variant: "destructive",
        title: "Sign out Failed",
        description: error.message || "Something went wrong",
      });
    }

    return { error };
  }, [toast]);

  const value = useMemo(() => ({
    user,
    currentUser,
    session,
    loading,
    signUp,
    signIn,
    signOut,
  }), [user, currentUser, session, loading, signUp, signIn, signOut]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
