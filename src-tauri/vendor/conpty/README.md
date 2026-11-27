NuGet `Microsoft.Windows.Console.ConPTY` 1.25.261109001 (MIT, assinado pela Microsoft).

Substitui o ConPTY do kernel32, que descarta os modos de mouse (`?1000h`/`?1006h`) e deixa
TUIs sem clique. Copiado para `target/<profile>` pelo `build.rs` e empacotado via
`bundle.resources` em `tauri.conf.json`.
