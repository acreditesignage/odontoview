import React from 'react';
import { useLocation } from 'react-router-dom';
import App from './App.jsx';
import ImplantGeometryLab from './ImplantGeometryLab.jsx';
import ImplantViewerGeometrySmoke from './ImplantViewerGeometrySmoke.jsx';
import ImplantLibraryDock from './ImplantLibraryDock.jsx';

export default function AppEntry() {
  const location = useLocation();
  if (location.pathname === '/implant-geometry-lab') return <ImplantGeometryLab />;
  if (location.pathname === '/implant-viewer-geometry-smoke') return <ImplantViewerGeometrySmoke />;
  return <>
    <App />
    {location.pathname === '/viewer2' && <ImplantLibraryDock />}
  </>;
}