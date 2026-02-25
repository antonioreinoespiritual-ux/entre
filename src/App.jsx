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
