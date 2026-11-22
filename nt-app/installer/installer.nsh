; Custom installer steps, included by electron-builder (nsis.include in vue.config.js).
; (Not in build/, which .gitignore leaves out.)
;
; Adds an "Updates" page with an "automatic updates" checkbox. The choice is
; saved as HKLM\Software\Noita Together Steam\AutoUpdate (DWORD, 1 = on, in the
; 64-bit view), which the app reads and changes too (src/autoUpdateSetting.js).
; The page is skipped when the app updates itself, so the saved choice stays.

!define NT_SETTINGS_KEY "Software\Noita Together Steam"

!ifndef BUILD_UNINSTALLER
  !include LogicLib.nsh
  !include nsDialogs.nsh

  Var ntAutoUpdate
  Var ntAutoUpdateBox

  ; start from the saved choice (on when there is none), so a reinstall or a
  ; silent update writes back the same value
  !macro customInit
    Push $0
    StrCpy $ntAutoUpdate 1
    SetRegView 64
    ClearErrors
    ReadRegDWORD $0 HKLM "${NT_SETTINGS_KEY}" "AutoUpdate"
    ${IfNot} ${Errors}
    ${AndIf} $0 == 0
      StrCpy $ntAutoUpdate 0
    ${EndIf}
    SetRegView lastused
    Pop $0
  !macroend

  ; inserted after the folder page, where MUI is already set up
  !macro customPageAfterChangeDir
    Page custom ntUpdatesPageCreate ntUpdatesPageLeave

    Function ntUpdatesPageCreate
      ${if} ${isUpdated}
        Abort
      ${endif}
      !insertmacro MUI_HEADER_TEXT "Updates" "Choose whether Noita Together updates itself."
      nsDialogs::Create 1018
      Pop $0
      ${If} $0 == error
        Abort
      ${EndIf}

      ${NSD_CreateCheckbox} 0 0 100% 12u "Download and install updates automatically"
      Pop $ntAutoUpdateBox
      ${If} $ntAutoUpdate == 1
        ${NSD_Check} $ntAutoUpdateBox
      ${EndIf}

      ${NSD_CreateLabel} 0 22u 100% 40u "When this is off, the app still tells you when a new version is out, and you choose when to download it. You can change this later with the Auto-update switch at the bottom of the app window."
      Pop $0

      nsDialogs::Show
    FunctionEnd

    Function ntUpdatesPageLeave
      ${NSD_GetState} $ntAutoUpdateBox $0
      ${If} $0 == ${BST_CHECKED}
        StrCpy $ntAutoUpdate 1
      ${Else}
        StrCpy $ntAutoUpdate 0
      ${EndIf}
    FunctionEnd
  !macroend

  ; runs after the old version is removed
  !macro customInstall
    SetRegView 64
    WriteRegDWORD HKLM "${NT_SETTINGS_KEY}" "AutoUpdate" $ntAutoUpdate
    SetRegView lastused
  !macroend
!else
  ; a real uninstall removes the setting; an update's uninstall of the old version keeps it
  !macro customUnInstall
    ${ifNot} ${isUpdated}
      SetRegView 64
      DeleteRegKey HKLM "${NT_SETTINGS_KEY}"
      SetRegView lastused
    ${endif}
  !macroend
!endif
