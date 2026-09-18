import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { config } from './config.js';
import { loadCatalog } from './catalog.js';
import { validShopifySignature, readDownloadToken } from './security.js';
import { Renderer, Storage, Delivery } from './adapters.js';
import { Journal, JobQueue } from './engine.js';
import { CreativePromptAgent } from './creative-agent.js';
import { LangGraphCreativeOrchestrator } from './langchain-orchestrator.js';
import { buildMidjourneyHandoff } from './midjourney.js';
import { dashboard } from './dashboard.js';
import { ProductionReview, reviewZone } from './production-review.js';
import { reviewPanel, reviewScript } from './review-panel.js';
import { FluxStudio } from './flux.js';
import { UpscaleService, replicateTopazProvider } from './upscale.js';
import { createRustImageCore } from './rust-image-core.js';
import { fluxPanel, fluxScript } from './flux-panel.js';
import { canvasStyles, canvasScript } from './canvas-studio.js';
import { themeStyles } from './theme.js';
import { readUserGuide, guideScript } from './user-guide.js';
import { highestFluxSize } from './creation-formats.js';
import { customerSizePreview } from './customer-size-preview.js';
import { spacesPage } from './spaces.js';
import { gallery } from './gallery.js';
import { productPage } from './product-page.js';
import { PictureInputs } from './picture-inputs.js';
import { PictureDrafts } from './picture-drafts.js';
import { pictureStudioStyles, pictureStudioScript } from './picture-studio.js';
import { prepareArtworkBatch, batchStudioScript } from './batch-studio.js';
import { PipelineMonitor } from './pipeline-monitor.js';
import { pipelinePanel, pipelineStyles, pipelineScript } from './pipeline-panel.js';

const lifecycle = [
  ['strategy', 'Strategy & policy', 'Catalog and creative briefs', 'partial'],
  ['infrastructure', 'Infrastructure', 'Local service; cloud deployment pending', 'local'],
  ['intake', 'Data intake', 'Signed Shopify paid-order ingestion', 'available'],
  ['audit-storage', 'Audit storage', 'Local job journal', 'local'],
  ['normalization', 'Data transformation', 'Order and personalization mapping', 'available'],
  ['creative', 'Creative Prompt Agent', 'Briefs, three directions and preference feedback', 'available'],
  ['version-control', 'Version control', 'Catalog and template versioning pending', 'planned'],
  ['quality-gates', 'Quality gates', 'Measured resolution, proposed price and human artwork review', 'available'],
  ['worker-runtime', 'Worker runtime', 'Local queue and Midjourney handoffs', 'local'],
  ['rendering', 'Midjourney executor', 'You generate; DMAS records the selected artwork', 'manual'],
  ['provider-routing', 'Provider routing', 'Storage and delivery adapters need configuration', 'partial'],
  ['safe-preview', 'Safe preview', 'Creative studio does not deliver orders', 'available'],
  ['exception-review', 'Exception review', 'Full review workflow pending', 'planned'],
  ['security', 'Security', 'HMAC and local admin access; production review pending', 'partial'],
  ['delivery', 'Production delivery', 'Live email, Shopify and POD sync pending', 'unconfigured'],
  ['operations', 'Monitoring & logging', 'Job states and local journal', 'local'],
  ['complete', 'Optimization & feedback', 'Explicit ratings adjust prompt preferences', 'partial']
];

function failure(message, statusCode = 400) {
  return Object.assign(new Error(message), { statusCode });
}

export function readBody(request, limit = 1_000_000) {
  return new Promise((resolve, reject) => {
    const parts = [];
    let length = 0;
    let tooLarge = false;
    request.on('data', (part) => {
      if (tooLarge) return;
      length += part.length;
      if (length > limit) { tooLarge = true; parts.length = 0; reject(failure('Payload too large', 413)); }
      else parts.push(part);
    });
    request.on('end', () => resolve(Buffer.concat(parts)));
    request.on('error', reject);
  });
}

function normalize(payload) {
  if (!payload || !payload.id || !Array.isArray(payload.line_items) || !payload.line_items.length) {
    throw failure('Order id and nonempty line_items are required');
  }
  return payload.line_items.map((item) => {
    if (!item.id || typeof item.title !== 'string') throw failure('Each line item needs an id and title');
    return {
      store: 'shopify', orderId: String(payload.id), lineItemId: String(item.id),
      customerEmail: payload.email || payload.customer?.email, productTitle: item.title,
      quantity: item.quantity,
      properties: Object.fromEntries((item.properties || []).map((property) => [property.name, property.value]))
    };
  });
}

const publicJob = (job) => ({
  id: job.id, orderId: job.order.orderId, productTitle: job.order.productTitle,
  store: job.order.store, stage: job.stage, status: job.status, attempts: job.attempts,
  createdAt: job.createdAt, completedAt: job.completedAt, handoff: job.handoff,
  assetUrl: job.assetUrl, error: job.error, catalogId: job.order.properties?.catalogId
});

export function createApplication(options = {}) {
  const settings = options.config || config;
  if (!['midjourney', 'local', 'http'].includes(settings.creationExecutor)) throw failure('Unknown CREATION_EXECUTOR');
  const journal = options.journal || new Journal();
  const catalog = options.catalog || loadCatalog();
  const creativeAgent = options.creativeAgent || new CreativePromptAgent({ catalog });
  const creativeOrchestrator = options.creativeOrchestrator || new LangGraphCreativeOrchestrator({
    creativeAgent,
    apiKey: settings.openaiApiKey || process.env.OPENAI_API_KEY,
    model: settings.creativeModel
  });
  // Batch creation intentionally runs in local-review mode. This keeps one-click
  // generation fast and predictable, and prevents an accidental 50-call model bill.
  const batchOrchestrator = new LangGraphCreativeOrchestrator({ creativeAgent, apiKey: '', model: settings.creativeModel });
  const queue = options.queue || new JobQueue({
    journal, catalog, renderer: new Renderer(settings), storage: new Storage(settings),
    delivery: new Delivery(settings), config: settings
  });
  const catalogProducts = [...catalog.values()].map((row) => ({
    id: String(row.ID), title: row.Product_Title, category: row.Archetype_Category,
    aspectRatio: (row.Aspect_Ratio_DPI.match(/--ar\s+([0-9]+:[0-9]+)/i) || [])[1] || '4:5',
    subject: row.Subject, material: row.Medium_Texture, lighting: row.Lighting_Atmosphere,
    palette: row.Color_Palette, interior: row.Target_Interior_Style
  })).filter((product) => product.id && product.title);
  const catalogById = new Map(catalogProducts.map((product) => [product.id, product]));
  const selectedArtPath = options.selectedArtPath || path.resolve('data/selected-artworks.json');
  const portraitCollectionPath = options.portraitCollectionPath || path.resolve('data/collection-02-varnished-noir.json');
  const approvalPath = options.approvalPath || path.resolve('data/approval-decisions.json');
  const autonomousPromptPath = options.autonomousPromptPath || path.resolve('data/autonomous-creative-prompts.json');
  const autonomousControlPath = options.autonomousControlPath || path.resolve('data/autonomous-control.json');
  const readJson = (file, fallback) => {
    try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
  };
  const writeJson = (file, value) => {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n');
  };
  const approvalBoard = () => {
    const source = readJson(selectedArtPath, { collection: 'Collection 01', selections: [] });
    const portraits = readJson(portraitCollectionPath, { collection: 'Women of Modern Life', artworks: [] });
    const selectedPortraits = (portraits.artworks || []).filter((artwork) => artwork.status === 'generated' && artwork.assetPath);
    const portraitSelections = selectedPortraits.map((artwork) => ({
      promptId: artwork.id,
      title: artwork.title,
      status: 'selected',
      suggestedPresentation: 'Collection 02 · varnished portrait',
      artworks: [{ label: 'Final portrait', assetUrl: '/' + artwork.assetPath.replaceAll('\\', '/') }]
    }));
    const decisions = readJson(approvalPath, {});
    return {
      collection: source.collection + ' · ' + portraits.collection,
      artworks: [...source.selections, ...portraitSelections].map((selection) => ({
        ...selection,
        approval: decisions[selection.promptId] || {
          status: 'pending', productModes: ['digital'], selectedArtworkLabels: selection.artworks.map((artwork) => artwork.label)
        }
      }))
    };
  };
  const pictures = options.pictures || new PictureInputs({root:options.pictureRoot});
  const pictureDrafts = new PictureDrafts({pictures,file:options.pictureDraftPath});
  const masterSourceRoot = path.resolve('assets');
  const resolveMasterSource = (assetUrl) => {
    const file = path.resolve(masterSourceRoot, String(assetUrl).replace(/^\/assets\//, ''));
    if (!file.startsWith(masterSourceRoot + path.sep)) throw failure('Invalid master source path');
    return file;
  };
  const rustCore = options.rustCore || createRustImageCore({
    enabled: settings.rustImageCoreEnabled,
    directory: settings.rustImageCoreDirectory || undefined,
  });
  const upscale = options.upscale || new UpscaleService({
    token: settings.replicateToken || '', file: options.upscalePath,
    provider: replicateTopazProvider({ model: settings.upscaleModel, enhanceModel: settings.upscaleEnhanceModel }),
    readSource: async (assetUrl) => fs.readFileSync(resolveMasterSource(assetUrl)),
    resolveSourcePath: resolveMasterSource,
    rustCore,
    onReady: async (job) => productionReview.inspect(job.sourceJobId),
  });
  // With a Replicate token the 4 MP generation goes to the upscaler, not to review: it is not a sellable file.
  const flux = options.flux || new FluxStudio({ key: process.env.BFL_API_KEY || '', file: options.fluxPath, referenceImage:id=>pictures.providerImage(id), onReady: async job => {
    if (upscale.token && job.dimensions) { upscale.enqueue({ sourceJobId: 'flux:' + job.id, title: job.title, sourcePath: job.assetUrl, width: job.dimensions.width, height: job.dimensions.height }); void upscale.tick().catch(() => {}); return; }
    await productionReview.inspect('flux:' + job.id);
  } });
  const productionReview = new ProductionReview({ file: options.productionReviewPath, assetRoot:options.productionReviewAssetRoot, fileRoot:options.productionReviewFileRoot, sources: () => {
    const selected = approvalBoard().artworks.flatMap(item => item.artworks.map((art, index) => ({
      id: `${item.promptId}:${index}`, title: item.title + (item.artworks.length > 1 ? ' · ' + art.label : ''), assetUrl: art.assetUrl
    })));
    const returned = [...journal.records.values()].filter(job => job.order.store === 'studio' && job.assetUrl).map(job => ({
      id: 'job:' + job.id, title: job.order.productTitle, assetUrl: job.assetUrl
    }));
    // A ready print master replaces the 4 MP original as the file under review; the original stays on disk for provenance.
    const masters = new Map(upscale.list().filter(job => job.status === 'master_ready' && job.assetUrl).map(job => [job.sourceJobId, job]));
    const fluxImages = flux.list().filter(job => job.assetUrl).map(job => {
      const master = masters.get('flux:' + job.id);
      return { id: 'flux:' + job.id, title: job.title, assetUrl: master ? master.assetUrl : job.assetUrl, ...(master ? { master: { id: master.id, dimensions: master.dimensions, detail: master.detail, sourceUrl: job.assetUrl } } : {}) };
    });
    const imported = readJson(path.resolve('data/imported-artworks.json'), []);
    return [...imported, ...selected, ...returned, ...fluxImages];
  }});
  const updateApproval = (promptId, input) => {
    const board = approvalBoard();
    const artwork = board.artworks.find((entry) => entry.promptId === promptId);
    if (!artwork) throw failure('Artwork selection not found', 404);
    const allowedStatuses = new Set(['pending', 'approved', 'rejected']);
    const allowedModes = new Set(['digital', 'print', 'framed_print']);
    if (!allowedStatuses.has(input.status)) throw failure('Choose pending, approved, or rejected');
    const productModes = Array.isArray(input.productModes) ? [...new Set(input.productModes)] : [];
    if (!productModes.length || productModes.some((mode) => !allowedModes.has(mode))) throw failure('Choose at least one valid product type');
    const labels = Array.isArray(input.selectedArtworkLabels) ? [...new Set(input.selectedArtworkLabels)] : [];
    if (!labels.length || labels.some((label) => !artwork.artworks.some((image) => image.label === label))) throw failure('Choose at least one artwork');
    const decisions = readJson(approvalPath, {});
    decisions[promptId] = { status: input.status, productModes, selectedArtworkLabels: labels, updatedAt: new Date().toISOString() };
    writeJson(approvalPath, decisions);
    return approvalBoard();
  };
  const createAutonomousPrompts = async () => {
    const prompts = [];
    for (const product of catalogProducts) {
      const row = [...catalog.values()].find((entry) => String(entry.ID) === product.id);
      const generated = await batchOrchestrator.run({
        productTitle: product.title,
        subject: product.subject || product.title,
        goal: 'create a distinctive, collectible digital wall-art concept',
        audience: 'design-conscious collectors decorating modern homes',
        mood: product.lighting || 'refined, tactile, and emotionally resonant',
        palette: product.palette || 'a restrained gallery palette',
        medium: product.material || '',
        aspectRatio: product.aspectRatio
      });
      const choice = generated.candidates[0];
      const handoff = buildMidjourneyHandoff({ compiledPrompt: choice.prompt, aspectRatio: product.aspectRatio });
      prompts.push({
        id: product.id,
        title: product.title,
        status: 'ready_for_approval',
        prompt: handoff.prompt,
        rationale: choice.creativeRationale,
        artDirectorNote: generated.orchestration.artDirectorNote,
        createdAt: new Date().toISOString()
      });
    }
    const batch = { collection: 'The Dark Matters · First 50', generatedAt: new Date().toISOString(), promptCount: prompts.length, prompts };
    writeJson(autonomousPromptPath, batch);
    return batch;
  };
  const autopilot = () => {
    const batch = readJson(autonomousPromptPath, { collection: 'The Dark Matters · First 50', promptCount: 0, prompts: [] });
    const control = readJson(autonomousControlPath, { status: 'idle', startedAt: null, updatedAt: null });
    const prompts = batch.prompts || [];
    return {
      ...control,
      collection: batch.collection,
      planned: prompts.length,
      next: prompts.find((prompt) => prompt.status === 'ready_for_approval') || null,
      rules: [
        'Create and art-direct every prompt locally',
        'Never submit to Midjourney, Shopify, or customers without your action',
        'Keep every approved artwork ready for delivery'
      ]
    };
  };
  const startAutopilot = async () => {
    await createAutonomousPrompts();
    writeJson(autonomousControlPath, { status: 'active', startedAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
    return autopilot();
  };
  const pauseAutopilot = () => {
    const previous = readJson(autonomousControlPath, {});
    writeJson(autonomousControlPath, { ...previous, status: 'paused', updatedAt: new Date().toISOString() });
    return autopilot();
  };
  // Short-lived draft cache. Once selected, the prompt is persisted on the job.
  const drafts = new Map();
  const batchDraftPath = options.batchDraftPath || path.resolve('data/artwork-batch-draft.json');
  const savedBatch = readJson(batchDraftPath, null);
  if (savedBatch?.result?.kind === 'artwork-batch') drafts.set(savedBatch.result.promptId, savedBatch);
  const pipelineMonitor = new PipelineMonitor({productionReview,flux,upscale,creativeOrchestrator,creativeAgent,drafts,settings});
  function overview() {
    const jobs = [...journal.records.values()].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    const counts = Object.fromEntries(['awaiting_creation', 'working', 'artwork_ready', 'fulfilled', 'failed'].map((status) =>
      [status, jobs.filter((job) => job.status === status).length]));
    const stages = lifecycle.map(([id, label, detail, state]) => ({
      id, label, detail,
      state: jobs.some((job) => job.stage === id && job.status === 'failed') ? 'attention'
        : jobs.some((job) => job.stage === id && job.status === 'awaiting_creation') ? 'waiting'
        : jobs.some((job) => job.stage === id && job.status === 'working') ? 'active' : state
    }));
    return {
      executor: settings.creationExecutor,
      mode: settings.creationExecutor === 'midjourney' ? 'Midjourney · manual handoff' : 'Development · ' + settings.creationExecutor,
      queueDepth: queue.pending.length, counts, stages,
      integrations: {
        midjourney: settings.creationExecutor === 'midjourney' ? 'Selected · manual generation' : 'Not selected',
        langchain: creativeOrchestrator.model ? `Enabled · ${creativeOrchestrator.modelName}` : 'Installed · local review mode until OPENAI_API_KEY is set',
        langgraph: 'Enabled · creative approval graph',
        langsmith: process.env.LANGSMITH_TRACING === 'true' && process.env.LANGSMITH_API_KEY
          ? `Enabled · ${settings.langsmithProject}` : 'Ready · set LANGSMITH_TRACING=true and LANGSMITH_API_KEY',
        shopify: settings.shopifySecret ? 'Signing secret configured · connection unverified' : 'Not configured',
        storage: settings.storageEndpoint ? 'Endpoint configured · unverified' : 'Local only',
        delivery: settings.deliveryWebhookUrl ? 'Endpoint configured · unverified' : 'Local only'
      },
      waitingJobs: jobs.filter((job) => job.status === 'awaiting_creation').map(publicJob),
      recentJobs: jobs.slice(0, 12).map(publicJob)
    };
  }

  const server = http.createServer(async (request, response) => {
    const json = (status, body) => {
      response.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
      response.end(JSON.stringify(body));
    };
    try {
      const url = new URL(request.url, 'http://localhost');
      const route = url.pathname;
      const hostname = new URL('http://' + (request.headers.host || 'localhost')).hostname;
      const localHost = ['localhost', '127.0.0.1', '[::1]'].includes(hostname);
      // Local preview must not be accessible through an arbitrary Host header.
      if (!settings.adminToken && !localHost) throw failure('Local access only', 403);
      if (route.startsWith('/api/') || route.startsWith('/jobs/')) {
        if (settings.adminToken) {
          const supplied = Buffer.from(String(request.headers.authorization || '').replace(/^Bearer /, ''));
          const expected = Buffer.from(settings.adminToken);
          if (supplied.length !== expected.length || !crypto.timingSafeEqual(supplied, expected)) throw failure('Admin token required', 401);
        } else if (!['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(request.socket.remoteAddress)) {
          throw failure('Local access only', 403);
        }
        if (request.method === 'POST') {
          if (request.headers['sec-fetch-site'] === 'cross-site') throw failure('Same-origin request required', 403);
          const origin = request.headers.origin;
          if (origin && new URL(origin).host !== request.headers.host) throw failure('Same-origin request required', 403);
          if (route === '/api/creative/pictures' || /^\/api\/production-review\/[^/]+\/file$/.test(route)) {
            if (!['image/png','image/jpeg'].includes(request.headers['content-type'])) throw failure('Choose a PNG or JPEG picture',415);
          } else if (!(request.headers['content-type'] || '').startsWith('application/json')) throw failure('JSON body required', 415);
        }
      }
      const body = async () => {
        let data;
        try { data = JSON.parse((await readBody(request)).toString('utf8')); }
        catch (error) { if (error.statusCode) throw error; throw failure('Invalid JSON'); }
        if (!data || typeof data !== 'object' || Array.isArray(data)) throw failure('Expected a JSON object');
        return data;
      };

      if (request.method === 'GET' && route === '/') {
        response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
        return response.end(dashboard.replace('</head>', () => canvasStyles + pictureStudioStyles + pipelineStyles + themeStyles + '</head>').replace('<section class="card approval-studio">', () => pipelinePanel + fluxPanel + reviewPanel + '<section class="card approval-studio">').replace('</body>', () => reviewScript + fluxScript + canvasScript + guideScript + batchStudioScript + pictureStudioScript + pipelineScript + '</body>'));
      }
      if (request.method === 'GET' && route === '/spaces') {
        response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
        return response.end(spacesPage);
      }
      if (request.method === 'GET' && route === '/size-preview') {
        response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
        return response.end(customerSizePreview);
      }
      if (request.method === 'GET' && route === '/gallery') {
        response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
        return response.end(gallery);
      }
      if (request.method === 'GET' && route === '/product') {
        response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
        return response.end(productPage());
      }
      if (request.method === 'GET' && route.startsWith('/assets/')) {
        const assetsRoot = path.resolve('assets');
        const asset = path.resolve(assetsRoot, decodeURIComponent(route.slice('/assets/'.length)));
        if (!asset.startsWith(assetsRoot + path.sep) || !fs.existsSync(asset)) throw failure('Asset not found', 404);
        const extension = path.extname(asset).toLowerCase();
        const contentType = extension === '.png' ? 'image/png' : extension === '.jpg' || extension === '.jpeg' ? 'image/jpeg' : 'application/octet-stream';
        response.writeHead(200, { 'content-type': contentType, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
        return response.end(fs.readFileSync(asset));
      }
      if (request.method === 'GET' && route === '/health') return json(200, { ok: true, executor: settings.creationExecutor });
      if (request.method === 'GET' && route === '/api/overview') return json(200, overview());
      if (request.method === 'GET' && route === '/api/user-guide') return json(200, { documents: readUserGuide() });
      if(request.method==='GET'&&route==='/api/pipeline/status')return json(200,pipelineMonitor.snapshot());
      if(request.method==='POST'&&route==='/api/pipeline/check'){
        const input=await body();return json(200,await pipelineMonitor.check(input.stageId,{artworkId:input.artworkId}));
      }
      if (request.method === 'GET' && route === '/api/creative/pictures') return json(200,{pictures:pictures.list()});
      if (request.method === 'POST' && route === '/api/creative/pictures') {
        const name = decodeURIComponent(String(request.headers['x-file-name'] || 'Picture'));
        const bytes = await readBody(request,10*1024*1024);
        return json(201,{picture:await pictures.add(bytes,{name,contentType:request.headers['content-type']})});
      }
      const pictureImage=route.match(/^\/api\/creative\/pictures\/([^/]+)\/image$/);
      if(request.method==='GET'&&pictureImage){
        const image=await pictures.image(pictureImage[1]);
        response.writeHead(200,{'content-type':image.contentType,'cache-control':'no-store','x-content-type-options':'nosniff'});
        return response.end(image.bytes);
      }
      if(request.method==='POST'&&route==='/api/creative/picture-drafts')return json(201,{draft:pictureDrafts.prepare(await body())});
      const pictureGenerate=route.match(/^\/api\/creative\/picture-drafts\/([^/]+)\/generate$/);
      if(request.method==='POST'&&pictureGenerate){
        const input=await body();
        if(input.approved!==true)throw failure('Approve sharing the selected pictures with Black Forest Labs and paid generation first.');
        const draft=pictureDrafts.get(pictureGenerate[1]);
        const jobs=flux.createBatch({approvalId:'pictures:'+draft.id,artworks:draft.artworks});
        void flux.tick().catch(()=>{});
        return json(202,{jobs:jobs.map(({pollingUrl,...job})=>job)});
      }
      if (request.method === 'GET' && route === '/api/flux/jobs') return json(200, { configured: !!flux.key, jobs: flux.list() });
      if (request.method === 'GET' && route === '/api/flux/connection') return json(200, await flux.connection());
      if (request.method === 'GET' && route === '/api/upscale/jobs') return json(200, { configured: !!upscale.token, jobs: upscale.list() });
      if (request.method === 'GET' && route === '/api/upscale/connection') return json(200, await upscale.connection());
      if (request.method === 'GET' && route === '/api/creative/batches/latest') {
        const saved = readJson(batchDraftPath, null);
        return json(200, { batch: saved?.result ? { ...saved.result, expired: saved.expiresAt < Date.now() } : null });
      }
      if (request.method === 'POST' && route === '/api/flux/generate-batch') {
        const input = await body();
        if (input.approved !== true) throw failure('Review and approve every artwork before paid batch generation');
        const draft = drafts.get(input.promptId);
        if (!draft || draft.expiresAt < Date.now() || draft.result.kind !== 'artwork-batch') throw failure('Prepare your batch again before approving it', 404);
        if (draft.result.artworks.some(artwork => artwork.issue || !artwork.generation)) throw failure('Correct the marked artwork ratios before approving this batch');
        const jobs = flux.createBatch({ approvalId: input.promptId + ':batch', artworks: draft.result.artworks });
        void flux.tick();
        return json(202, { jobs: jobs.map(({ pollingUrl, ...job }) => job) });
      }
      if (request.method === 'POST' && route === '/api/flux/generate') {
        const input = await body();
        if (input.approved !== true) throw failure('Approve the creative direction before generation');
        const draft = drafts.get(input.promptId);
        if (!draft || draft.expiresAt < Date.now()) throw failure('Prepare your creative directions again', 404);
        if (!Number.isInteger(input.candidateIndex) || !draft.result.candidates[input.candidateIndex]) throw failure('Choose a creative direction');
        const count = Number(draft.result.brief.imageCount || 1);
        const created = flux.create({ approvalId: input.promptId + ':' + input.candidateIndex,
          title: draft.result.brief.collectionName || draft.result.brief.subject,
          prompt: draft.result.candidates[input.candidateIndex].prompt, ratio: draft.result.brief.aspectRatio, count });
        void flux.tick();
        return json(202, { jobs: created.map(({ pollingUrl, ...job }) => job) });
      }
      if (request.method === 'GET' && route === '/api/production-review') {
        const artworks=productionReview.list();
        return json(200, { artworks, counts:Object.fromEntries(['pending','approved','rejected'].map(zone=>[zone,artworks.filter(a=>reviewZone(a)===zone).length])) });
      }
      if(request.method==='POST'&&route==='/api/production-review/archive-decisions'){await body();return json(200,await productionReview.archiveDecisions());}
      const archivedImage=route.match(/^\/api\/production-review\/archive\/(Approved|Rejected)\/([^/]+)$/);
      if(request.method==='GET'&&archivedImage){const image=productionReview.archiveFile(archivedImage[1],archivedImage[2]);response.writeHead(200,{'content-type':image.contentType,'cache-control':'no-store','x-content-type-options':'nosniff'});return response.end(image.bytes);}
      const reviewFile=route.match(/^\/api\/production-review\/([^/]+)\/file$/);
      if(reviewFile&&request.method==='POST'){
        const name=decodeURIComponent(String(request.headers['x-file-name']||'Original image'));
        return json(201,await productionReview.attachFile(decodeURIComponent(reviewFile[1]),await readBody(request,40*1024*1024),{name}));
      }
      if(reviewFile&&request.method==='GET'){
        const image=await productionReview.fileImage(decodeURIComponent(reviewFile[1]));
        response.writeHead(200,{'content-type':image.contentType,'cache-control':'no-store','x-content-type-options':'nosniff'});
        return response.end(image.bytes);
      }
      const reviewAction = route.match(/^\/api\/production-review\/([^/]+)\/(inspect|decide)$/);
      if (request.method === 'POST' && reviewAction) {
        const input = await body();
        const id = decodeURIComponent(reviewAction[1]);
        return json(200, reviewAction[2] === 'inspect' ? await productionReview.inspect(id) : await productionReview.decide(id, input));
      }
      if (request.method === 'GET' && route === '/api/approvals') return json(200, approvalBoard());
      const approval = route.match(/^\/api\/approvals\/([^/]+)$/);
      if (request.method === 'POST' && approval) return json(201, updateApproval(decodeURIComponent(approval[1]), await body()));
      if (request.method === 'GET' && route === '/api/catalog') return json(200, { products: catalogProducts });
      if (request.method === 'GET' && route === '/api/creative/insights') return json(200, creativeAgent.insights());
      if (request.method === 'GET' && route === '/api/creative/autonomous') return json(200, readJson(autonomousPromptPath, { collection: 'The Dark Matters · First 50', generatedAt: null, promptCount: 0, prompts: [] }));
      if (request.method === 'POST' && route === '/api/creative/autonomous') {
        await body(); // Explicit operator action; the batch remains local and unsubmitted.
        return json(201, await createAutonomousPrompts());
      }
      if (request.method === 'GET' && route === '/api/autopilot') return json(200, autopilot());
      if (request.method === 'POST' && route === '/api/autopilot/start') {
        await body();
        return json(201, await startAutopilot());
      }
      if (request.method === 'POST' && route === '/api/autopilot/pause') {
        await body();
        return json(201, pauseAutopilot());
      }
      if (request.method === 'POST' && route === '/api/creative/prompts') {
        const brief = await body();
        if (typeof brief.subject !== 'string' || !brief.subject.trim()) throw failure('Describe the artwork subject first');
        const batch = prepareArtworkBatch(brief.subject, brief.collectionName);
        if (batch) {
          for (const [key, value] of drafts) if (value.expiresAt < Date.now()) drafts.delete(key);
          if (drafts.size >= 100) drafts.delete(drafts.keys().next().value);
          const saved = { result: batch, expiresAt: Date.now() + 24 * 60 * 60 * 1000 };
          writeJson(batchDraftPath, saved);
          drafts.set(batch.promptId, saved);
          return json(201, batch);
        }
        if (brief.subject.length > 9000) throw failure('This form supports one prompt up to 9000 characters. Split longer or multi-artwork briefs first.');
        const result = await creativeOrchestrator.run(brief);
        result.generation = null;
        result.generationMessage = 'Shape is free. Add a ratio or square image to your prompt before using FLUX; no fixed ratio was added.';
        if (result.brief.aspectRatio) {
          try { result.generation = { ...highestFluxSize(result.brief.aspectRatio), quality: 'Highest native resolution for this shape', format: 'PNG' }; }
          catch (error) { result.generationMessage = error.message; }
        }
        result.executor = 'midjourney';
        result.candidates = result.candidates.map((candidate) => ({
          ...candidate, handoff: buildMidjourneyHandoff({ compiledPrompt: candidate.prompt, aspectRatio: result.brief.aspectRatio })
        }));
        for (const [key, value] of drafts) if (value.expiresAt < Date.now()) drafts.delete(key);
        if (drafts.size >= 100) drafts.delete(drafts.keys().next().value);
        drafts.set(result.promptId, { result, expiresAt: Date.now() + 60 * 60 * 1000 });
        return json(201, result);
      }
      if (request.method === 'POST' && route === '/api/creation/handoffs') {
        if (settings.creationExecutor !== 'midjourney') throw failure('Midjourney is not the selected executor', 409);
        const selection = await body();
        const draft = drafts.get(selection.promptId);
        if (!draft || draft.expiresAt < Date.now()) throw failure('Draft expired. Prepare the directions again.', 404);
        if (!Number.isInteger(selection.candidateIndex) || !draft.result.candidates[selection.candidateIndex]) throw failure('Choose a valid direction');
        const candidate = draft.result.candidates[selection.candidateIndex];
        const { job, duplicate } = queue.enqueue({
          store: 'studio', orderId: selection.promptId, lineItemId: String(selection.candidateIndex),
          productTitle: draft.result.brief.subject, properties: {}, quantity: 1
        }, { creative: { compiledPrompt: candidate.handoff.prompt, aspectRatio: draft.result.brief.aspectRatio } });
        return json(202, { job: publicJob(job), duplicate });
      }
      const catalogHandoff = route.match(/^\/api\/catalog\/([^/]+)\/handoff$/);
      if (request.method === 'POST' && catalogHandoff) {
        if (settings.creationExecutor !== 'midjourney') throw failure('Midjourney is not the selected executor', 409);
        await body(); // Require an intentional, same-origin operator action.
        const product = catalogById.get(decodeURIComponent(catalogHandoff[1]));
        if (!product) throw failure('Catalogue product not found', 404);
        const row = [...catalog.values()].find((entry) => String(entry.ID) === product.id);
        const handoff = buildMidjourneyHandoff({
          compiledPrompt: row.Full_Automated_Prompt,
          negativePrompt: row.Negative_Prompt,
          aspectRatio: product.aspectRatio
        });
        const { job, duplicate } = queue.enqueue({
          store: 'studio', orderId: 'catalog-' + product.id, lineItemId: 'midjourney',
          productTitle: product.title, properties: { catalogId: product.id }, quantity: 1
        }, { creative: { compiledPrompt: handoff.prompt, aspectRatio: product.aspectRatio } });
        return json(202, { job: publicJob(job), duplicate });
      }
      const completion = route.match(/^\/api\/creation\/jobs\/([^/]+)\/result$/);
      if (request.method === 'POST' && completion) {
        const result = await queue.completeCreation(completion[1], await body());
        let review = null;
        if (result.job.order.store === 'studio') {
          try { review = await productionReview.inspect('job:' + result.job.id); }
          catch { review = { status: 'needs_quality_check', message: 'Artwork received. The resolution check could not read the image; retry from the review panel.' }; }
        }
        return json(202, { job: publicJob(result.job), duplicate: result.duplicate, review });
      }
      if (request.method === 'POST' && route === '/api/creative/feedback') return json(201, creativeAgent.learn(await body()));
      if (request.method === 'GET' && route.startsWith('/jobs/')) {
        const job = [...journal.records.values()].find((entry) => entry.id === route.split('/').pop());
        return job ? json(200, publicJob(job)) : json(404, { error: 'Job not found' });
      }
      if (request.method === 'GET' && route.startsWith('/downloads/')) {
        const data = readDownloadToken(decodeURIComponent(route.slice('/downloads/'.length)), settings.downloadSecret);
        return json(200, { orderId: data.orderId, assetUrl: data.assetUrl });
      }
      if (request.method === 'POST' && route === '/webhooks/shopify/orders-paid') {
        const raw = await readBody(request);
        if (!validShopifySignature(raw, request.headers['x-shopify-hmac-sha256'], settings.shopifySecret)) return json(401, { error: 'Invalid webhook signature' });
        const results = normalize(JSON.parse(raw)).map((order) => queue.enqueue(order));
        return json(202, { accepted: results.map(({ job, duplicate }) => ({ jobId: job.id, duplicate, status: job.status })) });
      }
      return json(404, { error: 'Not found' });
    } catch (error) { return json(error.statusCode || 400, { error: error.message }); }
  });
  server.requestTimeout = 30_000;
  let fluxTimer;
  server.on('listening', () => { fluxTimer = setInterval(() => { void flux.tick().catch(() => {}); void upscale.tick().catch(() => {}); }, 3000); fluxTimer.unref(); });
  server.on('close', () => clearInterval(fluxTimer));
  return { server, queue, journal, creativeAgent, productionReview };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (!['127.0.0.1', 'localhost', '::1'].includes(config.host) && !config.adminToken) {
    throw new Error('Set DMAS_ADMIN_TOKEN before listening on a public interface');
  }
  const { server, productionReview } = createApplication();
  server.listen(config.port, config.host, () => {
    console.log('DMAS listening on ' + config.host + ':' + config.port + ' · ' + config.creationExecutor);
    // Reconcile earlier human decisions once at startup, never create or publish products.
    void productionReview.archiveDecisions().then(result=>console.log('Review archives: '+result.archived+' saved; '+result.errors.length+' need attention.')).catch(()=>console.error('Review archive reconciliation needs attention. Use Back up earlier decisions in Review.'));
  });
}
