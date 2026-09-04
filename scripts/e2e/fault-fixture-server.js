import http from 'node:http';

const PORT = 4320;
const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
  const kind = url.searchParams.get('kind') || url.pathname.slice(1) || 'idle';
  const id = url.searchParams.get('cid') || `fixture-${kind}`;
  const fixture = render(kind, id);
  res.statusCode = 200;
  res.setHeader('content-type', 'text/html; charset=utf-8');
  res.end(fixture);
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`ChatSentinel fixture server listening on http://127.0.0.1:${PORT}`);
});

function render(kind, id) {
  let state = '<main>Normal idle conversation</main>';
  let progress = '';
  let identityAttr = ` data-chatsentinel-conversation-id="${id}"`;
  let headScript = '';

  if (kind === 'running') state = '<button aria-label="Stop generating">Stop generating</button>';
  if (kind === 'retry') state = '<button id="retry" onclick="document.body.dataset.retryClicked=\'1\';this.textContent=\'Retried\'">Retry</button>';
  if (kind === 'interrupt') state = '<main>Connection interrupted. Waiting for the complete answer</main>';
  if (kind === 'dead') state = '<main>Conversation not found</main>';
  if (kind === 'frozen') progress = ' data-chatsentinel-test-progress-age="180001"';
  if (kind === 'noidentity') identityAttr = '';
  if (kind === 'rootidentity') {
    identityAttr = '';
    headScript = `<script>history.replaceState({conversationId:${JSON.stringify(id)}},'')</script>`;
  }

  const composer = `<textarea id="prompt-textarea"></textarea>
    <button aria-label="Send" onclick="document.body.dataset.sent=document.querySelector('#prompt-textarea').value">Send</button>`;
  return `<!doctype html><html${identityAttr}${progress}>
    <head><title>${kind}</title>${headScript}</head><body>${state}${composer}</body></html>`;
}
