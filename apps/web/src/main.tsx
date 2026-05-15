import React from "react";
import ReactDOM from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { LoginPage } from "./pages/login";
import { DashboardPage } from "./pages/dashboard";
import { ContainersPage } from "./pages/containers";
import { AppsPage } from "./pages/apps";
import { AppDetailPage } from "./pages/app-detail";
import { ProjectsPage } from "./pages/projects";
import { ProjectDetailPage } from "./pages/project-detail";
import { AuditPage } from "./pages/audit";
import { SettingsPage } from "./pages/settings";
import { HostShellPage } from "./pages/host-shell";
import { IntegrationsPage } from "./pages/integrations";
import { RequireAuth } from "./components/require-auth";
import "./index.css";

const qc = new QueryClient();

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <QueryClientProvider client={qc}>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route
            path="/"
            element={
              <RequireAuth>
                <Navigate to="/dashboard" replace />
              </RequireAuth>
            }
          />
          <Route
            path="/dashboard"
            element={
              <RequireAuth>
                <DashboardPage />
              </RequireAuth>
            }
          />
          <Route
            path="/projects"
            element={
              <RequireAuth>
                <ProjectsPage />
              </RequireAuth>
            }
          />
          <Route
            path="/projects/:id"
            element={
              <RequireAuth>
                <ProjectDetailPage />
              </RequireAuth>
            }
          />
          <Route
            path="/apps"
            element={
              <RequireAuth>
                <AppsPage />
              </RequireAuth>
            }
          />
          <Route
            path="/apps/:id"
            element={
              <RequireAuth>
                <AppDetailPage />
              </RequireAuth>
            }
          />
          <Route
            path="/containers"
            element={
              <RequireAuth>
                <ContainersPage />
              </RequireAuth>
            }
          />
          <Route
            path="/audit"
            element={
              <RequireAuth>
                <AuditPage />
              </RequireAuth>
            }
          />
          <Route
            path="/settings"
            element={
              <RequireAuth>
                <SettingsPage />
              </RequireAuth>
            }
          />
          <Route
            path="/host"
            element={
              <RequireAuth>
                <HostShellPage />
              </RequireAuth>
            }
          />
          <Route
            path="/integrations"
            element={
              <RequireAuth>
                <IntegrationsPage />
              </RequireAuth>
            }
          />
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  </React.StrictMode>,
);
