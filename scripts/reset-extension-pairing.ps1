$ErrorActionPreference = 'Stop'
try {
  $result = Invoke-RestMethod 'http://127.0.0.1:4317/admin/reset-pairing' -Method Post -ContentType 'application/json' -Body '{}'
  if (-not $result.ok) { throw 'Pairing reset was rejected.' }
  Write-Host '[ChatSentinel] extension pairing reset. Reload the ChatSentinel extension; its next request will pair the new extension origin.'
} catch {
  throw "Could not reset ChatSentinel extension pairing: $($_.Exception.Message)"
}
