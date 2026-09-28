import React,{useEffect} from "react";
import {useLocation} from "react-router-dom";
import {trackAnalyticsEvent} from "./analyticsClient.js";

export default function AnalyticsTracker(){
  const location=useLocation();
  useEffect(()=>{
    trackAnalyticsEvent("PAGE_VIEW",{pathname:location.pathname,search:location.search});
  },[location.pathname,location.search]);

  useEffect(()=>{
    const heartbeat=()=>{
      if(document.visibilityState!=="visible")return;
      trackAnalyticsEvent("HEARTBEAT",{pathname:location.pathname,search:location.search,activeSeconds:60});
    };
    const timer=window.setInterval(heartbeat,60000);
    return()=>window.clearInterval(timer);
  },[location.pathname,location.search]);

  return null;
}
