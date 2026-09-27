import React from 'react';
import { useLocation } from 'react-router-dom';
import App from './App.jsx';
import ImplantGeometryLab from './ImplantGeometryLab.jsx';

export default function AppEntry() {
  const location = useLocation();
  if (location.pathname === '/implant-geometry-lab') return <ImplantGeometryLab />;
  return <App />;
}
