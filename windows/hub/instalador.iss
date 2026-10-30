; Instalador do InkDOS Hub para Windows (Inno Setup 6). Sem administrador: instala só para a pessoa,
; em %LOCALAPPDATA%\Programs\InkDOS Hub, com atalho no Iniciar (e na Área de Trabalho, se quiser).
; Os apps não vêm aqui: ficam no "Offline" do ☰, baixados do site e conferidos pelo SHA-256.
; Compilar: ISCC /DOrigem=<pasta montada> /DVersao=<x.y.z> /O<saída> instalador.iss
#ifndef Origem
  #define Origem "..\..\saida\InkDOS Hub"
#endif
#ifndef Versao
  #define Versao "0.0.0"
#endif

[Setup]
AppId={{6E0B7C52-3F1A-4D8E-9C27-5A1D2B8F4E60}
AppName=InkDOS Hub
AppVersion={#Versao}
AppVerName=InkDOS Hub {#Versao}
AppPublisher=InkDOS Hub
AppPublisherURL=https://inkdoshub.github.io/
DefaultDirName={localappdata}\Programs\InkDOS Hub
DisableDirPage=yes
DisableProgramGroupPage=yes
PrivilegesRequired=lowest
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
OutputBaseFilename=InkDOSHub-Setup
SetupIconFile=icone.ico
UninstallDisplayIcon={app}\InkDOS Hub.exe
UninstallDisplayName=InkDOS Hub
Compression=lzma2/ultra64
SolidCompression=yes
WizardStyle=modern
CloseApplications=yes
ChangesAssociations=yes

[Languages]
Name: "en"; MessagesFile: "compiler:Default.isl"
Name: "pt"; MessagesFile: "compiler:Languages\BrazilianPortuguese.isl"
Name: "es"; MessagesFile: "compiler:Languages\Spanish.isl"
Name: "de"; MessagesFile: "compiler:Languages\German.isl"
Name: "fr"; MessagesFile: "compiler:Languages\French.isl"
Name: "ja"; MessagesFile: "compiler:Languages\Japanese.isl"
Name: "ru"; MessagesFile: "compiler:Languages\Russian.isl"

[Tasks]
Name: "desktopicon"; Description: "{cm:CreateDesktopIcon}"; GroupDescription: "{cm:AdditionalIcons}"; Flags: unchecked

[InstallDelete]
; versão nova do motor: tira os arquivos da anterior (os apps guardados ficam em %LOCALAPPDATA%\InkDOS Hub)
Type: filesandordirs; Name: "{app}\locales"
Type: filesandordirs; Name: "{app}\resources"

[Files]
Source: "{#Origem}\*"; DestDir: "{app}"; Flags: recursesubdirs ignoreversion

[Registry]
; "Abrir com" e Aplicativos padrão: o Hub aparece como opção para estes tipos (só para esta pessoa, sem administrador).
; O Windows não deixa um app virar padrão sozinho: a pessoa escolhe em Abrir com › Sempre, ou em Configurações › Aplicativos padrão.
Root: HKCU; Subkey: "Software\Classes\InkDOSHub.Arquivo"; ValueType: string; ValueData: "InkDOS Hub"; Flags: uninsdeletekey
Root: HKCU; Subkey: "Software\Classes\InkDOSHub.Arquivo\DefaultIcon"; ValueType: string; ValueData: """{app}\InkDOS Hub.exe"",0"
Root: HKCU; Subkey: "Software\Classes\InkDOSHub.Arquivo\shell\open\command"; ValueType: string; ValueData: """{app}\InkDOS Hub.exe"" ""%1"""
Root: HKCU; Subkey: "Software\Classes\Applications\InkDOS Hub.exe"; ValueType: string; ValueName: "FriendlyAppName"; ValueData: "InkDOS Hub"; Flags: uninsdeletekey
Root: HKCU; Subkey: "Software\Classes\Applications\InkDOS Hub.exe\shell\open\command"; ValueType: string; ValueData: """{app}\InkDOS Hub.exe"" ""%1"""
Root: HKCU; Subkey: "Software\InkDOS Hub\Capabilities"; ValueType: string; ValueName: "ApplicationName"; ValueData: "InkDOS Hub"; Flags: uninsdeletekey
Root: HKCU; Subkey: "Software\InkDOS Hub\Capabilities"; ValueType: string; ValueName: "ApplicationDescription"; ValueData: "InkDOS Hub: PDF, documents, spreadsheets, presentations, text, EPUB, photos, video and music."
Root: HKCU; Subkey: "Software\RegisteredApplications"; ValueType: string; ValueName: "InkDOS Hub"; ValueData: "Software\InkDOS Hub\Capabilities"; Flags: uninsdeletevalue
Root: HKCU; Subkey: "Software\Classes\.pdf\OpenWithProgids"; ValueType: none; ValueName: "InkDOSHub.Arquivo"; Flags: uninsdeletevalue
Root: HKCU; Subkey: "Software\InkDOS Hub\Capabilities\FileAssociations"; ValueType: string; ValueName: ".pdf"; ValueData: "InkDOSHub.Arquivo"
Root: HKCU; Subkey: "Software\Classes\Applications\InkDOS Hub.exe\SupportedTypes"; ValueType: string; ValueName: ".pdf"; ValueData: ""
Root: HKCU; Subkey: "Software\Classes\.docx\OpenWithProgids"; ValueType: none; ValueName: "InkDOSHub.Arquivo"; Flags: uninsdeletevalue
Root: HKCU; Subkey: "Software\InkDOS Hub\Capabilities\FileAssociations"; ValueType: string; ValueName: ".docx"; ValueData: "InkDOSHub.Arquivo"
Root: HKCU; Subkey: "Software\Classes\Applications\InkDOS Hub.exe\SupportedTypes"; ValueType: string; ValueName: ".docx"; ValueData: ""
Root: HKCU; Subkey: "Software\Classes\.doc\OpenWithProgids"; ValueType: none; ValueName: "InkDOSHub.Arquivo"; Flags: uninsdeletevalue
Root: HKCU; Subkey: "Software\InkDOS Hub\Capabilities\FileAssociations"; ValueType: string; ValueName: ".doc"; ValueData: "InkDOSHub.Arquivo"
Root: HKCU; Subkey: "Software\Classes\Applications\InkDOS Hub.exe\SupportedTypes"; ValueType: string; ValueName: ".doc"; ValueData: ""
Root: HKCU; Subkey: "Software\Classes\.odt\OpenWithProgids"; ValueType: none; ValueName: "InkDOSHub.Arquivo"; Flags: uninsdeletevalue
Root: HKCU; Subkey: "Software\InkDOS Hub\Capabilities\FileAssociations"; ValueType: string; ValueName: ".odt"; ValueData: "InkDOSHub.Arquivo"
Root: HKCU; Subkey: "Software\Classes\Applications\InkDOS Hub.exe\SupportedTypes"; ValueType: string; ValueName: ".odt"; ValueData: ""
Root: HKCU; Subkey: "Software\Classes\.rtf\OpenWithProgids"; ValueType: none; ValueName: "InkDOSHub.Arquivo"; Flags: uninsdeletevalue
Root: HKCU; Subkey: "Software\InkDOS Hub\Capabilities\FileAssociations"; ValueType: string; ValueName: ".rtf"; ValueData: "InkDOSHub.Arquivo"
Root: HKCU; Subkey: "Software\Classes\Applications\InkDOS Hub.exe\SupportedTypes"; ValueType: string; ValueName: ".rtf"; ValueData: ""
Root: HKCU; Subkey: "Software\Classes\.xlsx\OpenWithProgids"; ValueType: none; ValueName: "InkDOSHub.Arquivo"; Flags: uninsdeletevalue
Root: HKCU; Subkey: "Software\InkDOS Hub\Capabilities\FileAssociations"; ValueType: string; ValueName: ".xlsx"; ValueData: "InkDOSHub.Arquivo"
Root: HKCU; Subkey: "Software\Classes\Applications\InkDOS Hub.exe\SupportedTypes"; ValueType: string; ValueName: ".xlsx"; ValueData: ""
Root: HKCU; Subkey: "Software\Classes\.xls\OpenWithProgids"; ValueType: none; ValueName: "InkDOSHub.Arquivo"; Flags: uninsdeletevalue
Root: HKCU; Subkey: "Software\InkDOS Hub\Capabilities\FileAssociations"; ValueType: string; ValueName: ".xls"; ValueData: "InkDOSHub.Arquivo"
Root: HKCU; Subkey: "Software\Classes\Applications\InkDOS Hub.exe\SupportedTypes"; ValueType: string; ValueName: ".xls"; ValueData: ""
Root: HKCU; Subkey: "Software\Classes\.ods\OpenWithProgids"; ValueType: none; ValueName: "InkDOSHub.Arquivo"; Flags: uninsdeletevalue
Root: HKCU; Subkey: "Software\InkDOS Hub\Capabilities\FileAssociations"; ValueType: string; ValueName: ".ods"; ValueData: "InkDOSHub.Arquivo"
Root: HKCU; Subkey: "Software\Classes\Applications\InkDOS Hub.exe\SupportedTypes"; ValueType: string; ValueName: ".ods"; ValueData: ""
Root: HKCU; Subkey: "Software\Classes\.csv\OpenWithProgids"; ValueType: none; ValueName: "InkDOSHub.Arquivo"; Flags: uninsdeletevalue
Root: HKCU; Subkey: "Software\InkDOS Hub\Capabilities\FileAssociations"; ValueType: string; ValueName: ".csv"; ValueData: "InkDOSHub.Arquivo"
Root: HKCU; Subkey: "Software\Classes\Applications\InkDOS Hub.exe\SupportedTypes"; ValueType: string; ValueName: ".csv"; ValueData: ""
Root: HKCU; Subkey: "Software\Classes\.tsv\OpenWithProgids"; ValueType: none; ValueName: "InkDOSHub.Arquivo"; Flags: uninsdeletevalue
Root: HKCU; Subkey: "Software\InkDOS Hub\Capabilities\FileAssociations"; ValueType: string; ValueName: ".tsv"; ValueData: "InkDOSHub.Arquivo"
Root: HKCU; Subkey: "Software\Classes\Applications\InkDOS Hub.exe\SupportedTypes"; ValueType: string; ValueName: ".tsv"; ValueData: ""
Root: HKCU; Subkey: "Software\Classes\.pptx\OpenWithProgids"; ValueType: none; ValueName: "InkDOSHub.Arquivo"; Flags: uninsdeletevalue
Root: HKCU; Subkey: "Software\InkDOS Hub\Capabilities\FileAssociations"; ValueType: string; ValueName: ".pptx"; ValueData: "InkDOSHub.Arquivo"
Root: HKCU; Subkey: "Software\Classes\Applications\InkDOS Hub.exe\SupportedTypes"; ValueType: string; ValueName: ".pptx"; ValueData: ""
Root: HKCU; Subkey: "Software\Classes\.ppt\OpenWithProgids"; ValueType: none; ValueName: "InkDOSHub.Arquivo"; Flags: uninsdeletevalue
Root: HKCU; Subkey: "Software\InkDOS Hub\Capabilities\FileAssociations"; ValueType: string; ValueName: ".ppt"; ValueData: "InkDOSHub.Arquivo"
Root: HKCU; Subkey: "Software\Classes\Applications\InkDOS Hub.exe\SupportedTypes"; ValueType: string; ValueName: ".ppt"; ValueData: ""
Root: HKCU; Subkey: "Software\Classes\.odp\OpenWithProgids"; ValueType: none; ValueName: "InkDOSHub.Arquivo"; Flags: uninsdeletevalue
Root: HKCU; Subkey: "Software\InkDOS Hub\Capabilities\FileAssociations"; ValueType: string; ValueName: ".odp"; ValueData: "InkDOSHub.Arquivo"
Root: HKCU; Subkey: "Software\Classes\Applications\InkDOS Hub.exe\SupportedTypes"; ValueType: string; ValueName: ".odp"; ValueData: ""
Root: HKCU; Subkey: "Software\Classes\.txt\OpenWithProgids"; ValueType: none; ValueName: "InkDOSHub.Arquivo"; Flags: uninsdeletevalue
Root: HKCU; Subkey: "Software\InkDOS Hub\Capabilities\FileAssociations"; ValueType: string; ValueName: ".txt"; ValueData: "InkDOSHub.Arquivo"
Root: HKCU; Subkey: "Software\Classes\Applications\InkDOS Hub.exe\SupportedTypes"; ValueType: string; ValueName: ".txt"; ValueData: ""
Root: HKCU; Subkey: "Software\Classes\.xml\OpenWithProgids"; ValueType: none; ValueName: "InkDOSHub.Arquivo"; Flags: uninsdeletevalue
Root: HKCU; Subkey: "Software\InkDOS Hub\Capabilities\FileAssociations"; ValueType: string; ValueName: ".xml"; ValueData: "InkDOSHub.Arquivo"
Root: HKCU; Subkey: "Software\Classes\Applications\InkDOS Hub.exe\SupportedTypes"; ValueType: string; ValueName: ".xml"; ValueData: ""
Root: HKCU; Subkey: "Software\Classes\.log\OpenWithProgids"; ValueType: none; ValueName: "InkDOSHub.Arquivo"; Flags: uninsdeletevalue
Root: HKCU; Subkey: "Software\InkDOS Hub\Capabilities\FileAssociations"; ValueType: string; ValueName: ".log"; ValueData: "InkDOSHub.Arquivo"
Root: HKCU; Subkey: "Software\Classes\Applications\InkDOS Hub.exe\SupportedTypes"; ValueType: string; ValueName: ".log"; ValueData: ""
Root: HKCU; Subkey: "Software\Classes\.md\OpenWithProgids"; ValueType: none; ValueName: "InkDOSHub.Arquivo"; Flags: uninsdeletevalue
Root: HKCU; Subkey: "Software\InkDOS Hub\Capabilities\FileAssociations"; ValueType: string; ValueName: ".md"; ValueData: "InkDOSHub.Arquivo"
Root: HKCU; Subkey: "Software\Classes\Applications\InkDOS Hub.exe\SupportedTypes"; ValueType: string; ValueName: ".md"; ValueData: ""
Root: HKCU; Subkey: "Software\Classes\.epub\OpenWithProgids"; ValueType: none; ValueName: "InkDOSHub.Arquivo"; Flags: uninsdeletevalue
Root: HKCU; Subkey: "Software\InkDOS Hub\Capabilities\FileAssociations"; ValueType: string; ValueName: ".epub"; ValueData: "InkDOSHub.Arquivo"
Root: HKCU; Subkey: "Software\Classes\Applications\InkDOS Hub.exe\SupportedTypes"; ValueType: string; ValueName: ".epub"; ValueData: ""
Root: HKCU; Subkey: "Software\Classes\.jpg\OpenWithProgids"; ValueType: none; ValueName: "InkDOSHub.Arquivo"; Flags: uninsdeletevalue
Root: HKCU; Subkey: "Software\InkDOS Hub\Capabilities\FileAssociations"; ValueType: string; ValueName: ".jpg"; ValueData: "InkDOSHub.Arquivo"
Root: HKCU; Subkey: "Software\Classes\Applications\InkDOS Hub.exe\SupportedTypes"; ValueType: string; ValueName: ".jpg"; ValueData: ""
Root: HKCU; Subkey: "Software\Classes\.jpeg\OpenWithProgids"; ValueType: none; ValueName: "InkDOSHub.Arquivo"; Flags: uninsdeletevalue
Root: HKCU; Subkey: "Software\InkDOS Hub\Capabilities\FileAssociations"; ValueType: string; ValueName: ".jpeg"; ValueData: "InkDOSHub.Arquivo"
Root: HKCU; Subkey: "Software\Classes\Applications\InkDOS Hub.exe\SupportedTypes"; ValueType: string; ValueName: ".jpeg"; ValueData: ""
Root: HKCU; Subkey: "Software\Classes\.png\OpenWithProgids"; ValueType: none; ValueName: "InkDOSHub.Arquivo"; Flags: uninsdeletevalue
Root: HKCU; Subkey: "Software\InkDOS Hub\Capabilities\FileAssociations"; ValueType: string; ValueName: ".png"; ValueData: "InkDOSHub.Arquivo"
Root: HKCU; Subkey: "Software\Classes\Applications\InkDOS Hub.exe\SupportedTypes"; ValueType: string; ValueName: ".png"; ValueData: ""
Root: HKCU; Subkey: "Software\Classes\.gif\OpenWithProgids"; ValueType: none; ValueName: "InkDOSHub.Arquivo"; Flags: uninsdeletevalue
Root: HKCU; Subkey: "Software\InkDOS Hub\Capabilities\FileAssociations"; ValueType: string; ValueName: ".gif"; ValueData: "InkDOSHub.Arquivo"
Root: HKCU; Subkey: "Software\Classes\Applications\InkDOS Hub.exe\SupportedTypes"; ValueType: string; ValueName: ".gif"; ValueData: ""
Root: HKCU; Subkey: "Software\Classes\.webp\OpenWithProgids"; ValueType: none; ValueName: "InkDOSHub.Arquivo"; Flags: uninsdeletevalue
Root: HKCU; Subkey: "Software\InkDOS Hub\Capabilities\FileAssociations"; ValueType: string; ValueName: ".webp"; ValueData: "InkDOSHub.Arquivo"
Root: HKCU; Subkey: "Software\Classes\Applications\InkDOS Hub.exe\SupportedTypes"; ValueType: string; ValueName: ".webp"; ValueData: ""
Root: HKCU; Subkey: "Software\Classes\.bmp\OpenWithProgids"; ValueType: none; ValueName: "InkDOSHub.Arquivo"; Flags: uninsdeletevalue
Root: HKCU; Subkey: "Software\InkDOS Hub\Capabilities\FileAssociations"; ValueType: string; ValueName: ".bmp"; ValueData: "InkDOSHub.Arquivo"
Root: HKCU; Subkey: "Software\Classes\Applications\InkDOS Hub.exe\SupportedTypes"; ValueType: string; ValueName: ".bmp"; ValueData: ""
Root: HKCU; Subkey: "Software\Classes\.avif\OpenWithProgids"; ValueType: none; ValueName: "InkDOSHub.Arquivo"; Flags: uninsdeletevalue
Root: HKCU; Subkey: "Software\InkDOS Hub\Capabilities\FileAssociations"; ValueType: string; ValueName: ".avif"; ValueData: "InkDOSHub.Arquivo"
Root: HKCU; Subkey: "Software\Classes\Applications\InkDOS Hub.exe\SupportedTypes"; ValueType: string; ValueName: ".avif"; ValueData: ""
Root: HKCU; Subkey: "Software\Classes\.heic\OpenWithProgids"; ValueType: none; ValueName: "InkDOSHub.Arquivo"; Flags: uninsdeletevalue
Root: HKCU; Subkey: "Software\InkDOS Hub\Capabilities\FileAssociations"; ValueType: string; ValueName: ".heic"; ValueData: "InkDOSHub.Arquivo"
Root: HKCU; Subkey: "Software\Classes\Applications\InkDOS Hub.exe\SupportedTypes"; ValueType: string; ValueName: ".heic"; ValueData: ""
Root: HKCU; Subkey: "Software\Classes\.mp4\OpenWithProgids"; ValueType: none; ValueName: "InkDOSHub.Arquivo"; Flags: uninsdeletevalue
Root: HKCU; Subkey: "Software\InkDOS Hub\Capabilities\FileAssociations"; ValueType: string; ValueName: ".mp4"; ValueData: "InkDOSHub.Arquivo"
Root: HKCU; Subkey: "Software\Classes\Applications\InkDOS Hub.exe\SupportedTypes"; ValueType: string; ValueName: ".mp4"; ValueData: ""
Root: HKCU; Subkey: "Software\Classes\.mov\OpenWithProgids"; ValueType: none; ValueName: "InkDOSHub.Arquivo"; Flags: uninsdeletevalue
Root: HKCU; Subkey: "Software\InkDOS Hub\Capabilities\FileAssociations"; ValueType: string; ValueName: ".mov"; ValueData: "InkDOSHub.Arquivo"
Root: HKCU; Subkey: "Software\Classes\Applications\InkDOS Hub.exe\SupportedTypes"; ValueType: string; ValueName: ".mov"; ValueData: ""
Root: HKCU; Subkey: "Software\Classes\.m4v\OpenWithProgids"; ValueType: none; ValueName: "InkDOSHub.Arquivo"; Flags: uninsdeletevalue
Root: HKCU; Subkey: "Software\InkDOS Hub\Capabilities\FileAssociations"; ValueType: string; ValueName: ".m4v"; ValueData: "InkDOSHub.Arquivo"
Root: HKCU; Subkey: "Software\Classes\Applications\InkDOS Hub.exe\SupportedTypes"; ValueType: string; ValueName: ".m4v"; ValueData: ""
Root: HKCU; Subkey: "Software\Classes\.webm\OpenWithProgids"; ValueType: none; ValueName: "InkDOSHub.Arquivo"; Flags: uninsdeletevalue
Root: HKCU; Subkey: "Software\InkDOS Hub\Capabilities\FileAssociations"; ValueType: string; ValueName: ".webm"; ValueData: "InkDOSHub.Arquivo"
Root: HKCU; Subkey: "Software\Classes\Applications\InkDOS Hub.exe\SupportedTypes"; ValueType: string; ValueName: ".webm"; ValueData: ""
Root: HKCU; Subkey: "Software\Classes\.mkv\OpenWithProgids"; ValueType: none; ValueName: "InkDOSHub.Arquivo"; Flags: uninsdeletevalue
Root: HKCU; Subkey: "Software\InkDOS Hub\Capabilities\FileAssociations"; ValueType: string; ValueName: ".mkv"; ValueData: "InkDOSHub.Arquivo"
Root: HKCU; Subkey: "Software\Classes\Applications\InkDOS Hub.exe\SupportedTypes"; ValueType: string; ValueName: ".mkv"; ValueData: ""
Root: HKCU; Subkey: "Software\Classes\.mp3\OpenWithProgids"; ValueType: none; ValueName: "InkDOSHub.Arquivo"; Flags: uninsdeletevalue
Root: HKCU; Subkey: "Software\InkDOS Hub\Capabilities\FileAssociations"; ValueType: string; ValueName: ".mp3"; ValueData: "InkDOSHub.Arquivo"
Root: HKCU; Subkey: "Software\Classes\Applications\InkDOS Hub.exe\SupportedTypes"; ValueType: string; ValueName: ".mp3"; ValueData: ""
Root: HKCU; Subkey: "Software\Classes\.m4a\OpenWithProgids"; ValueType: none; ValueName: "InkDOSHub.Arquivo"; Flags: uninsdeletevalue
Root: HKCU; Subkey: "Software\InkDOS Hub\Capabilities\FileAssociations"; ValueType: string; ValueName: ".m4a"; ValueData: "InkDOSHub.Arquivo"
Root: HKCU; Subkey: "Software\Classes\Applications\InkDOS Hub.exe\SupportedTypes"; ValueType: string; ValueName: ".m4a"; ValueData: ""
Root: HKCU; Subkey: "Software\Classes\.aac\OpenWithProgids"; ValueType: none; ValueName: "InkDOSHub.Arquivo"; Flags: uninsdeletevalue
Root: HKCU; Subkey: "Software\InkDOS Hub\Capabilities\FileAssociations"; ValueType: string; ValueName: ".aac"; ValueData: "InkDOSHub.Arquivo"
Root: HKCU; Subkey: "Software\Classes\Applications\InkDOS Hub.exe\SupportedTypes"; ValueType: string; ValueName: ".aac"; ValueData: ""
Root: HKCU; Subkey: "Software\Classes\.wav\OpenWithProgids"; ValueType: none; ValueName: "InkDOSHub.Arquivo"; Flags: uninsdeletevalue
Root: HKCU; Subkey: "Software\InkDOS Hub\Capabilities\FileAssociations"; ValueType: string; ValueName: ".wav"; ValueData: "InkDOSHub.Arquivo"
Root: HKCU; Subkey: "Software\Classes\Applications\InkDOS Hub.exe\SupportedTypes"; ValueType: string; ValueName: ".wav"; ValueData: ""
Root: HKCU; Subkey: "Software\Classes\.ogg\OpenWithProgids"; ValueType: none; ValueName: "InkDOSHub.Arquivo"; Flags: uninsdeletevalue
Root: HKCU; Subkey: "Software\InkDOS Hub\Capabilities\FileAssociations"; ValueType: string; ValueName: ".ogg"; ValueData: "InkDOSHub.Arquivo"
Root: HKCU; Subkey: "Software\Classes\Applications\InkDOS Hub.exe\SupportedTypes"; ValueType: string; ValueName: ".ogg"; ValueData: ""
Root: HKCU; Subkey: "Software\Classes\.oga\OpenWithProgids"; ValueType: none; ValueName: "InkDOSHub.Arquivo"; Flags: uninsdeletevalue
Root: HKCU; Subkey: "Software\InkDOS Hub\Capabilities\FileAssociations"; ValueType: string; ValueName: ".oga"; ValueData: "InkDOSHub.Arquivo"
Root: HKCU; Subkey: "Software\Classes\Applications\InkDOS Hub.exe\SupportedTypes"; ValueType: string; ValueName: ".oga"; ValueData: ""
Root: HKCU; Subkey: "Software\Classes\.flac\OpenWithProgids"; ValueType: none; ValueName: "InkDOSHub.Arquivo"; Flags: uninsdeletevalue
Root: HKCU; Subkey: "Software\InkDOS Hub\Capabilities\FileAssociations"; ValueType: string; ValueName: ".flac"; ValueData: "InkDOSHub.Arquivo"
Root: HKCU; Subkey: "Software\Classes\Applications\InkDOS Hub.exe\SupportedTypes"; ValueType: string; ValueName: ".flac"; ValueData: ""
Root: HKCU; Subkey: "Software\Classes\.opus\OpenWithProgids"; ValueType: none; ValueName: "InkDOSHub.Arquivo"; Flags: uninsdeletevalue
Root: HKCU; Subkey: "Software\InkDOS Hub\Capabilities\FileAssociations"; ValueType: string; ValueName: ".opus"; ValueData: "InkDOSHub.Arquivo"
Root: HKCU; Subkey: "Software\Classes\Applications\InkDOS Hub.exe\SupportedTypes"; ValueType: string; ValueName: ".opus"; ValueData: ""

[Icons]
Name: "{userprograms}\InkDOS Hub"; Filename: "{app}\InkDOS Hub.exe"
Name: "{userdesktop}\InkDOS Hub"; Filename: "{app}\InkDOS Hub.exe"; Tasks: desktopicon

[Run]
Filename: "{app}\InkDOS Hub.exe"; Description: "{cm:LaunchProgram,InkDOS Hub}"; Flags: nowait postinstall skipifsilent
; atualização feita pelo próprio app (instalação silenciosa): abre de novo se a pessoa pediu "Reiniciar"
Filename: "{app}\InkDOS Hub.exe"; Flags: nowait; Check: Relancar

[Code]
function Relancar: Boolean;
begin
  Result := WizardSilent and (ExpandConstant('{param:relancar|0}') = '1');
end;
