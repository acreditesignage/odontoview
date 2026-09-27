const alphaXml = `<?xml version="1.0" encoding="utf-8"?>
<ImplantLibraryEntry>
  <MarkerFilename>CaseOnly.stl</MarkerFilename>
  <ScrewFilename>Ambiguous.sdfa</ScrewFilename>
  <ImplantFilename>MissingImplant.stl</ImplantFilename>
  <DisplayInformation>Synthetic Alpha System</DisplayInformation>
  <Supplier>Synthetic Alpha</Supplier>
  <TypeConfig>
    <ImplantTypeConfig>
      <InterfaceFilename>AlphaInterface.stl</InterfaceFilename>
      <DisplayInformation>Alpha Interface</DisplayInformation>
      <Keyword>ALPHA_IF</Keyword>
      <SubtypeConfig>
        <ImplantSubtypeConfig>
          <SupportFilename>CaseOnly.stl</SupportFilename>
          <DisplayInformation>Standard</DisplayInformation>
          <Keyword>STD</Keyword>
        </ImplantSubtypeConfig>
      </SubtypeConfig>
    </ImplantTypeConfig>
  </TypeConfig>
</ImplantLibraryEntry>`;

const betaXml = `<?xml version="1.0" encoding="utf-8"?>
<ImplantLibraryEntry>
  <MarkerFilename>BetaMarker.stl</MarkerFilename>
  <DisplayInformation>Synthetic Beta System</DisplayInformation>
  <Supplier>Synthetic Beta</Supplier>
  <TypeConfig>
    <ImplantTypeConfig>
      <InterfaceFilename>BetaInterface.stl</InterfaceFilename>
      <DisplayInformation>Beta Interface</DisplayInformation>
      <Keyword>BETA_IF</Keyword>
    </ImplantTypeConfig>
  </TypeConfig>
</ImplantLibraryEntry>`;

const unsupportedXml = `<?xml version="1.0" encoding="utf-8"?>
<ModelLabAnalogEntries />`;

export const catalogMixedBundleFixture = {
  entries: [
    { path: 'implant/ALPHA/config.xml', xmlText: alphaXml },
    { path: 'implant/BETA/config.xml', xmlText: betaXml },
    { path: 'modelcreator/SYNTHETIC/config.xml', xmlText: unsupportedXml },
  ],
  availableFiles: [
    'implant/ALPHA/CASEONLY.STL',
    'implant/ALPHA/AlphaInterface.stl',
    'shared/one/Ambiguous.SDFA',
    'shared/two/ambiguous.sdfa',
    'implant/BETA/BetaMarker.stl',
    'implant/BETA/BetaInterface.stl',
  ],
};
