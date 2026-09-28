import React from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import App from './App.jsx';
import ImplantGeometryLab from './ImplantGeometryLab.jsx';
import ImplantViewerGeometrySmoke from './ImplantViewerGeometrySmoke.jsx';
import Viewer2LayoutSmoke from './Viewer2LayoutSmoke.jsx';
import ImplantLibraryDock from './ImplantLibraryDock.jsx';
import AnalyticsTracker from './AnalyticsTracker.jsx';
import AdminDashboard from './AdminDashboard.jsx';
import { adminEntryRedirect } from './adminRouting.js';

export default function AppEntry() {
  const location = useLocation();
  if (location.pathname === '/implant-geometry-lab') return <ImplantGeometryLab />;
  if (location.pathname === '/implant-viewer-geometry-smoke') return <ImplantViewerGeometrySmoke />;
  if (location.pathname === '/viewer2-layout-smoke') return <><Viewer2LayoutSmoke /><ImplantLibraryDock /></>;

  const role=localStorage.getItem('odontoview_role');
  const redirect=adminEntryRedirect(location.pathname,role);
  if(redirect)return <Navigate to={redirect} replace/>;
  if(location.pathname==='/admin')return <><AnalyticsTracker/><AdminDashboard/></>;

  return <>
    <AnalyticsTracker />
    <App />
    {location.pathname === '/viewer2' && <ImplantLibraryDock />}
  </>;
}
