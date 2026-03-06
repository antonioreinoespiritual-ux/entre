import { useCallback, useEffect, useMemo, useState } from 'react';
import { interviewsModuleApi } from '@/modules/interviews/services/interviewsModuleApi';

export const useInterviewCenterData = ({ projectId, campaignId, toast }) => {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [audiences, setAudiences] = useState([]);
  const [clients, setClients] = useState([]);
  const [forms, setForms] = useState([]);
  const [hypotheses, setHypotheses] = useState([]);
  const [sessions, setSessions] = useState([]);

  const loadAll = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [audiencesData, clientsData, formsData, hypothesesData, sessionsData] = await Promise.all([
        interviewsModuleApi.listAudiences(campaignId),
        interviewsModuleApi.listClients(projectId, campaignId),
        interviewsModuleApi.listForms(projectId, campaignId),
        interviewsModuleApi.listHypotheses(projectId, campaignId),
        interviewsModuleApi.listSessions(projectId, campaignId),
      ]);
      setAudiences(audiencesData);
      setClients(clientsData);
      setForms(formsData);
      setHypotheses(hypothesesData);
      setSessions(sessionsData);
    } catch (err) {
      setError(err.message || 'No se pudo cargar el centro de entrevistas');
    } finally {
      setLoading(false);
    }
  }, [campaignId, projectId]);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  const runMutation = useCallback(async (operation, successMessage, optimisticUpdate) => {
    const snapshot = optimisticUpdate ? { clients, forms, hypotheses, sessions } : null;
    if (optimisticUpdate) optimisticUpdate();
    try {
      await operation();
      toast?.({ title: successMessage });
      await loadAll();
    } catch (err) {
      if (snapshot) {
        setClients(snapshot.clients);
        setForms(snapshot.forms);
        setHypotheses(snapshot.hypotheses);
        setSessions(snapshot.sessions);
      }
      toast?.({ title: 'Error', description: err.message, variant: 'destructive' });
      throw err;
    }
  }, [clients, forms, hypotheses, sessions, toast, loadAll]);

  const kpis = useMemo(() => {
    const activeForms = forms.filter((form) => form.status !== 'inactive').length;
    const byAudienceMap = sessions.reduce((acc, session) => {
      const key = session.audience_name || 'Sin audiencia';
      acc[key] = (acc[key] || 0) + 1;
      return acc;
    }, {});
    const topAudience = Object.entries(byAudienceMap).sort((a, b) => b[1] - a[1]).slice(0, 3);
    return {
      totalClients: clients.length,
      totalSessions: sessions.length,
      activeForms,
      topAudience,
      recentSessions: [...sessions].sort((a, b) => new Date(b.created_at) - new Date(a.created_at)).slice(0, 5),
    };
  }, [clients, forms, sessions]);

  return {
    loading,
    error,
    audiences,
    clients,
    forms,
    hypotheses,
    sessions,
    kpis,
    setClients,
    setForms,
    setHypotheses,
    setSessions,
    reload: loadAll,
    runMutation,
  };
};
