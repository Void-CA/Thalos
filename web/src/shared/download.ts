/**
 * Browser-download helper (design D12: Save = browser download; NO
 * POST/PUT/PATCH scene/program endpoints in the MVP).
 *
 * Shared by the Scene editor ([Save Scene] → SceneFile JSON) and the Task
 * editor ([Save Program] → canonical `.thalos` text). Pure browser plumbing —
 * the content string is produced by the caller (store action / serializer).
 */
export function downloadTextFile(
  filename: string,
  text: string,
  mime = 'text/plain',
): void {
  const blob = new Blob([text], { type: mime })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  URL.revokeObjectURL(url)
}
