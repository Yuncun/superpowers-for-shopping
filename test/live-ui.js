#!/usr/bin/env node
// Live smoke for the UI server. Run manually:
//   npm run smoke:ui
// Starts the server, prints a URL, walks through the demo flow as the user clicks.

import { startServer } from '../server/ui.js';

const CANDIDATES = [
  {
    image: 'https://placehold.co/600x600/2c3e50/ffffff/png?text=Crew+Sweater',
    brand: 'Marine Layer', title: 'Crew Neck Sweater', price: '98.00',
    url: 'https://marinelayer.com/products/crew-sweater',
  },
  {
    image: 'https://placehold.co/600x600/8b4513/ffffff/png?text=Cardigan',
    brand: 'Marine Layer', title: 'Shawl Cardigan', price: '128.00',
    url: 'https://marinelayer.com/products/shawl-cardigan',
  },
  {
    image: 'https://placehold.co/600x600/4a5d23/ffffff/png?text=Pullover',
    brand: 'Marine Layer', title: 'Tencel Pullover', price: '88.00',
    url: 'https://marinelayer.com/products/tencel-pullover',
  },
  {
    image: 'https://placehold.co/600x600/8e44ad/ffffff/png?text=Henley',
    brand: 'Uniqlo', title: 'Heattech Henley', price: '34.00',
    url: 'https://uniqlo.com/us/en/products/E455920',
  },
  {
    image: 'https://placehold.co/600x600/c0392b/ffffff/png?text=Fleece',
    brand: 'Marine Layer', title: 'Sherpa Fleece', price: '118.00',
    url: 'https://marinelayer.com/products/sherpa-fleece',
  },
  {
    image: 'https://placehold.co/600x600/16a085/ffffff/png?text=Hoodie',
    brand: 'Aritzia', title: 'Cozy Fleece Hoodie', price: '78.00',
    url: 'https://aritzia.com/us/en/product/cozy-fleece-hoodie',
  },
  {
    image: 'https://placehold.co/600x600/d35400/ffffff/png?text=Mock+Neck',
    brand: 'Everlane', title: 'Cashmere Mock Neck', price: '160.00',
    url: 'https://everlane.com/products/womens-cashmere-mock',
  },
  {
    image: 'https://placehold.co/600x600/34495e/ffffff/png?text=Quarter+Zip',
    brand: 'Marine Layer', title: 'Quarter Zip Pullover', price: '108.00',
    url: 'https://marinelayer.com/products/quarter-zip',
  },
];

async function main() {
  const server = await startServer();
  const session = server.createSession();

  console.log(`\nUI server started at ${server.baseUrl}`);
  console.log(`\nOpen this URL in your browser:\n  ${session.url}\n`);
  console.log(`(Ctrl+C anytime to abort and shut down the server.)\n`);

  session.pushState({ stage: 'loading', message: 'Searching for sweaters...' });

  await new Promise((r) => setTimeout(r, 1200));
  session.pushState({ stage: 'thumbs', candidates: CANDIDATES });
  console.log('Pushed thumbs grid. Waiting for thumbs interactions...');

  const thumbsDone = await session.nextAction({ types: ['thumbs_complete', 'dismissed'] });
  if (thumbsDone.type === 'dismissed') {
    console.log('User dismissed the tab. Shutting down.');
    await server.shutdown();
    return;
  }
  console.log('thumbs_complete received.');

  session.pushState({
    stage: 'final',
    product: CANDIDATES[0],
    alternativesCount: CANDIDATES.length - 1,
  });
  console.log('Pushed final card. Waiting for accept/cancel/see_alternatives...');

  const finalAction = await session.nextAction({
    types: ['final_accept', 'final_cancel', 'see_alternatives', 'dismissed'],
  });
  console.log(`final action: ${finalAction.type}`);

  if (finalAction.type === 'final_accept') {
    session.pushState({ stage: 'redirect', url: 'https://marinelayer.com/cart' });
    console.log('Pushed redirect. Waiting 2s for browser to navigate, then closing.');
    await new Promise((r) => setTimeout(r, 2000));
  } else {
    session.pushState({ stage: 'done', message: 'Canceled. You can close this tab.' });
    await new Promise((r) => setTimeout(r, 1000));
  }

  console.log('Shutting down server.');
  await server.shutdown();
  console.log('Live UI smoke OK.');
}

main().catch((err) => {
  console.error('Live UI smoke FAILED:', err.message);
  process.exit(1);
});
