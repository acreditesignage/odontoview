export function adminEntryRedirect(pathname,role){
  const path=String(pathname||"/");
  const userRole=String(role||"");
  if(path==="/dentista"&&userRole==="ADMIN")return "/admin";
  if(path==="/admin"&&userRole!=="ADMIN")return "/";
  return null;
}
