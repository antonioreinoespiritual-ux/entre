
import React from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { Toaster } from '@/components/ui/toaster';
import { ProjectProvider } from '@/contexts/ProjectContext';
import { CampaignProvider } from '@/contexts/CampaignContext';
import { AudienceProvider } from '@/contexts/AudienceContext';
import { VideoProvider } from '@/contexts/VideoContext';
import { HypothesisProvider } from '@/contexts/HypothesisContext';
import ProjectsPage from '@/pages/ProjectsPage';
import ProjectDetailPage from '@/pages/ProjectDetailPage';
import CampaignDetailPage from '@/pages/CampaignDetailPage';

function App() {
  return (
    <Router>
      <ProjectProvider>
        <CampaignProvider>
          <AudienceProvider>
            <VideoProvider>
              <HypothesisProvider>
                <Toaster />
                <Routes>
                  <Route path="/" element={<Navigate to="/projects" replace />} />
                  <Route path="/projects" element={<ProjectsPage />} />
                  <Route path="/projects/:id" element={<ProjectDetailPage />} />
                  <Route path="/campaigns/:id" element={<CampaignDetailPage />} />
                </Routes>
              </HypothesisProvider>
            </VideoProvider>
          </AudienceProvider>
        </CampaignProvider>
      </ProjectProvider>
    </Router>
  );
}

export default App;
