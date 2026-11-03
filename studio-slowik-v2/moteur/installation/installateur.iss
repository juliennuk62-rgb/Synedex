; Installateur Windows de Studio SLOWIK Detourage (Inno Setup 6), fabrique par GitHub
; (.github/workflows/logiciel.yml). Le dossier « paquet » contient : le site (interface), moteur/
; et python/ (Python portable). PyTorch et les modeles d'IA sont telecharges au premier lancement.
#define Version GetEnv("SLOWIK_VERSION")
#if Version == ""
  #define Version "0.0.0"
#endif

[Setup]
AppId={{6B7F3C2E-5A1D-4E8B-9C0F-2D4A6B8E1F35}
AppName=Studio SLOWIK Détourage
AppVersion={#Version}
AppPublisher=Studio SLOWIK
DefaultDirName={localappdata}\Programs\StudioSlowik
DefaultGroupName=Studio SLOWIK
PrivilegesRequired=lowest
OutputDir=sortie
OutputBaseFilename=StudioSlowik-Detourage-{#Version}
Compression=lzma2/max
SolidCompression=yes
WizardStyle=modern
SetupIconFile=paquet\moteur\installation\icone.ico
UninstallDisplayIcon={app}\moteur\installation\icone.ico
DisableProgramGroupPage=yes

[Languages]
Name: "fr"; MessagesFile: "compiler:Languages\French.isl"

[Tasks]
Name: "bureau"; Description: "Créer un raccourci sur le bureau"; Flags: checkedonce

[Files]
Source: "paquet\*"; DestDir: "{app}"; Flags: recursesubdirs createallsubdirs ignoreversion

[InstallDelete]
; Mise a jour : l'ancienne interface est remplacee (le Python et ses dependances restent).
Type: filesandordirs; Name: "{app}\detourage"
Type: filesandordirs; Name: "{app}\js"
Type: filesandordirs; Name: "{app}\moteur"

[Icons]
Name: "{group}\Studio SLOWIK Détourage"; Filename: "{app}\StudioSlowik.cmd"; WorkingDir: "{app}"; IconFilename: "{app}\moteur\installation\icone.ico"
Name: "{userdesktop}\Studio SLOWIK Détourage"; Filename: "{app}\StudioSlowik.cmd"; WorkingDir: "{app}"; IconFilename: "{app}\moteur\installation\icone.ico"; Tasks: bureau

[Run]
Filename: "{app}\StudioSlowik.cmd"; Description: "Lancer Studio SLOWIK Détourage (le premier lancement installe le moteur d'IA, environ 3 Go)"; Flags: postinstall shellexec nowait
