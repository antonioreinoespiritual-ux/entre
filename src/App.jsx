import React from 'react';
import { BrowserRouter as Router, Navigate, Route, Routes } from 'react-router-dom';
import { Toaster } from '@/components/ui/toaster';
import { AuthProvider, useAuth } from '@/contexts/SupabaseAuthContext';
import { ProjectProvider } from '@/contexts/ProjectContext';
import { CampaignProvider } from '@/contexts/CampaignContext';
import { AudienceProvider } from '@/contexts/AudienceContext';
import { VideoProvider } from '@/contexts/VideoContext';
import { HypothesisProvider } from '@/contexts/HypothesisContext';
import ProjectsPage from '@/pages/ProjectsPage';
import ProjectDetailPage from '@/pages/ProjectDetailPage';
import CampaignDetailPage from '@/pages/CampaignDetailPage';
import AudienceDashboardPage from '@/pages/AudienceDashboardPage';
import AudienceDetailPage from '@/pages/AudienceDetailPage';
import HypothesesDashboardPage from '@/pages/HypothesesDashboardPage';
import HypothesisDetailPage from '@/pages/HypothesisDetailPage';
import HypothesisAdvancedAnalysisPage from '@/pages/HypothesisAdvancedAnalysisPage';
import VideoDetailPage from '@/pages/VideoDetailPage';
import AbTestPage from '@/pages/AbTestPage';
import LoginPage from '@/pages/LoginPage';
import SignupPage from '@/pages/SignupPage';

const ProtectedRoute = ({ children }) => {
  const { session, loading } = useAuth();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="animate-spin rounded-full h-10 w-10 border-4 border-blue-500 border-t-transparent" />
      </div>
    );
  }

  if (!session) {
    return <Navigate to="/login" replace />;
  }

  return children;
};

const AuthRoute = ({ children }) => {
  const { session, loading } = useAuth();

  if (loading) return null;
  if (session) return <Navigate to="/projects" replace />;
  return children;
};

const ProtectedApp = () => (
  <ProjectProvider>
    <CampaignProvider>
      <AudienceProvider>
        <VideoProvider>
          <HypothesisProvider>
            <Routes>
              <Route path="/projects" element={<ProjectsPage />} />
              <Route path="/projects/:id" element={<ProjectDetailPage />} />
              <Route path="/campaigns/:id" element={<CampaignDetailPage />} />
              <Route path="/projects/:projectId/campaigns/:campaignId/audiences" element={<AudienceDashboardPage />} />
              <Route path="/projects/:projectId/campaigns/:campaignId/audiences/:audienceId" element={<AudienceDetailPage />} />
              <Route path="/projects/:projectId/campaigns/:campaignId/hypotheses" element={<HypothesesDashboardPage />} />
              <Route path="/projects/:projectId/campaigns/:campaignId/hypotheses/:hypothesisId" element={<HypothesisDetailPage />} />
              <Route path="/projects/:projectId/campaigns/:campaignId/hypotheses/:hypothesisId/analysis" element={<HypothesisAdvancedAnalysisPage />} />
              <Route path="/projects/:projectId/campaigns/:campaignId/hypotheses/:hypothesisId/videos/:videoId" element={<VideoDetailPage />} />
              <Route path="/projects/:projectId/campaigns/:campaignId/hypotheses/:hypothesisId/ab-test" element={<AbTestPage />} />
              <Route path="*" element={<Navigate to="/projects" replace />} />
            </Routes>
          </HypothesisProvider>
        </VideoProvider>
      </AudienceProvider>
    </CampaignProvider>
  </ProjectProvider>
);

const AppRoutes = () => (
  <Routes>
    <Route path="/" element={<Navigate to="/projects" replace />} />
    <Route path="/login" element={<AuthRoute><LoginPage /></AuthRoute>} />
    <Route path="/signup" element={<AuthRoute><SignupPage /></AuthRoute>} />
    <Route path="/*" element={<ProtectedRoute><ProtectedApp /></ProtectedRoute>} />
  </Routes>
);

function App() {
  return (
    <Router>
      <AuthProvider>
        <Toaster />
        <AppRoutes />
      </AuthProvider>
    </Router>
  );
}

export default App;
