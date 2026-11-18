$l = New-Object Net.HttpListener
$l.Prefixes.Add('http://localhost:8090/')
$l.Start()
$m = @{'.html'='text/html';'.js'='text/javascript';'.css'='text/css';'.svg'='image/svg+xml';'.png'='image/png';'.webmanifest'='application/manifest+json'}
while ($l.IsListening) {
  $c = $l.GetContext()
  $p = $c.Request.Url.AbsolutePath.TrimStart('/'); if (!$p) { $p = 'index.html' }
  $f = Join-Path $PSScriptRoot $p
  if (Test-Path $f -PathType Leaf) {
    $b = [IO.File]::ReadAllBytes($f)
    $c.Response.ContentType = $m[[IO.Path]::GetExtension($f)]
    $c.Response.OutputStream.Write($b, 0, $b.Length)
  } else { $c.Response.StatusCode = 404 }
  $c.Response.Close()
}