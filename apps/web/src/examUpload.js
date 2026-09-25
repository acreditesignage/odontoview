function normalizeExamName(examType){
  const raw=typeof examType==="string"?examType:examType?.name||"";
  return String(raw).normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase().trim();
}

export function examUploadPolicy(examType){
  const name=normalizeExamName(examType);
  const isCbct=name.includes("tomografia")||name.includes("cbct")||name.includes("cone beam")||name.includes("feixe conico");
  const isScan=name.includes("escaneamento")||name.includes("scanner")||name.includes("scan intraoral");
  if(isCbct){
    return {
      kind:"dicom",
      accept:".zip,.rar,.dcm,.dicom,application/dicom,application/zip,application/x-zip-compressed,application/vnd.rar",
      multiple:true,
      buttonLabel:"Selecionar ZIP / DICOM",
      help:"Tomografia CBCT aceita série DICOM solta ou um ZIP/RAR contendo a série."
    };
  }
  if(isScan){
    return {
      kind:"scan",
      accept:".stl,.ply,.obj,.zip,model/stl,model/obj,application/zip,application/x-zip-compressed",
      multiple:false,
      buttonLabel:"Selecionar arquivo 3D",
      help:"Escaneamento: envie um único STL, PLY, OBJ ou ZIP."
    };
  }
  return {
    kind:"single",
    accept:".jpg,.jpeg,.png,.webp,.tif,.tiff,.bmp,.pdf,image/jpeg,image/png,image/webp,image/tiff,image/bmp,application/pdf",
    multiple:false,
    buttonLabel:"Selecionar arquivo",
    help:"Envie um único arquivo de imagem ou PDF."
  };
}

export function isDicomStudySource(sourceType){
  return ["DICOM","ZIP","RAR"].includes(String(sourceType||"").toUpperCase());
}
