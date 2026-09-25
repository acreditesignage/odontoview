let current=null;

export function setViewerSession(session){
  current=session||null;
}

export function getViewerSession(){
  return current;
}

export function clearViewerSession(){
  current=null;
}
