' Hidden launcher for the Selena-port control centre.
'
' WMI and Start-Process both tend to give a long-running child its own console
' window. This script starts the command with window style 0 (hidden) and does not
' wait for it, so the control centre never shows stray terminals.
'
' Arguments: argv(0) = working directory, argv(1) = command line to run.

Set shell = CreateObject("WScript.Shell")
If WScript.Arguments.Count < 2 Then
    WScript.Quit 2
End If

shell.CurrentDirectory = WScript.Arguments(0)
shell.Run WScript.Arguments(1), 0, False