import http from 'node:http';

const PORT = 4320;
const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
  if (/^\/backend-api\/(?:conversation|shared_conversation)\/[^/]+\/?$/.test(url.pathname)) {
    res.statusCode = 200;
    res.setHeader('content-type', 'application/json; charset=utf-8');
    res.end(JSON.stringify(conversationFixture(100)));
    return;
  }
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
  let title = kind;

  if (kind === 'running') state = '<button aria-label="Stop generating">Stop generating</button>';
  if (kind === 'retry') state = '<button id="retry" onclick="document.body.dataset.retryClicked=\'1\';this.textContent=\'Retried\'">Retry</button>';
  if (kind === 'delivery-timeout') state = `<main>
    <article data-message-author-role="user" data-message-id="delivery-user">Pending user prompt</article>
    <div role="alert" data-message-id="delivery-timeout">Message delivery timed out. Please try again.
      <button aria-label="Retry" onclick="document.body.dataset.deliveryRetryClicked='1';document.body.dataset.deliveryRetryCount=String(Number(document.body.dataset.deliveryRetryCount||0)+1)">Retry</button>
    </div>
  </main>`;
  if (kind === 'delivery-timeout-history') state = `<main>
    <article data-message-author-role="user" data-message-id="delivery-old-user">Old user prompt</article>
    <div role="alert" data-message-id="delivery-old-timeout">Message delivery timed out. Please try again.<button aria-label="Retry">Retry</button></div>
    <article data-message-author-role="assistant" data-message-id="delivery-later-assistant">Later completed answer</article>
  </main>`;
  if (kind === 'too-many-requests') state = `<main><div role="dialog"><h2>Too many requests</h2><p>You're making requests too quickly. We've temporarily limited access to your conversations to protect your data.</p><p>Please wait a few minutes before trying again.</p><button>Got it</button></div></main>`;
  if (kind === 'browser-crash') {
    title = 'This page is having a problem';
    state = '<main>This page is having a problem</main>';
  }
  if (kind === 'interrupt') state = `<main><article data-message-author-role="assistant" data-message-id="active-partial">Partial answer</article><div role="alert">Connection interrupted. Waiting for the complete answer</div></main>`;
  if (kind === 'interrupt-history') state = `<main>
    <article data-message-author-role="assistant" data-message-id="old-interrupt">Connection interrupted. Waiting for the complete answer</article>
    <article data-message-author-role="user" data-message-id="recovery-user">Continue</article>
    <article data-message-author-role="assistant" data-message-id="completed-assistant">Completed answer</article>
  </main>`;
  if (kind === 'dead') state = '<main>Conversation not found</main>';
  if (kind === 'frozen') progress = ' data-chatsentinel-test-progress-age="180001"';
  if (kind === 'noidentity') identityAttr = '';
  if (kind === 'rootidentity') {
    identityAttr = '';
    headScript = `<script>history.replaceState({conversationId:${JSON.stringify(id)}},'')</script>`;
  }

  const composer = `<form id="prompt-form" method="GET" action="/">
    <textarea id="prompt-textarea" name="prompt-textarea"></textarea>
    <button id="generic-submit" aria-label="Send" type="submit">Send</button>
    <button id="verified-send" data-testid="send-button" aria-label="Send prompt" type="button" hidden>Send prompt</button>
  </form>
  <script>
    (()=>{
      const composer=document.querySelector('#prompt-textarea');
      const send=document.querySelector('#verified-send');
      composer.addEventListener('input',()=>{ send.hidden=!composer.value; });
      send.addEventListener('click',()=>{
        const value=composer.value;
        document.body.dataset.sent=value;
        document.body.dataset.sendCount=String(Number(document.body.dataset.sendCount||0)+1);
        const turn=document.createElement('article');
        turn.setAttribute('data-message-author-role','user');
        turn.setAttribute('data-message-id','sent-'+document.body.dataset.sendCount);
        turn.innerText=value;
        document.body.prepend(turn);
        composer.value='';
        send.hidden=true;
      });
    })();
  </script>`;
  return `<!doctype html><html${identityAttr}${progress}>
    <head><title>${title}</title>${headScript}</head><body>${state}${composer}</body></html>`;
}


function conversationFixture(turns) {
  const mapping = { root: { parent: null, children: ['n1'] } };
  let previous = 'root';
  for (let index = 1; index <= turns; index += 1) {
    const id = `n${index}`;
    const next = index < turns ? `n${index + 1}` : null;
    mapping[id] = {
      parent: previous,
      children: next ? [next] : [],
      message: { author: { role: index % 2 ? 'user' : 'assistant' }, content: { parts: [`turn-${index}`] } }
    };
    previous = id;
  }
  return { mapping, current_node: `n${turns}`, root: 'root', title: 'fixture conversation' };
}
