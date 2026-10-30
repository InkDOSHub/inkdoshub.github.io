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
