import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const STAGES = [
  ['brief', 'Creative brief', '#canvas'],
  ['directions', 'Creative directions', '#canvas'],
  ['generation-approval', 'Approve generation', '#canvas'],
  ['provider', 'Image provider', '#flux-studio'],
  ['creation-queue', 'Creation queue', '#flux-studio'],
  ['generation', 'Image generation', '#flux-studio'],
  ['originals', 'Original files', '#production-review'],
  ['resolution', 'Resolution check', '#production-review'],
  ['visual-review', 'Visual review', '#production-review'],
  ['pricing', 'Price suggestion', '#production-review'],
  ['product-approval', 'Approve product', '#production-review'],
  ['backups', 'Decision backups', '#production-review'],
  ['product-fields', 'Product details', '#production-review'],
  ['shopify', 'Shopify connection', '#production-review'],
  ['digital-delivery', 'Digital delivery', '#production-review'],
  ['publishing', 'Publish product', '#production-review'],
  ['monitoring', 'Pipeline monitoring', '#pipeline-control'],
];
const ARTWORK_CHECKS = new Set(['originals', 'resolution', 'pricing']);
const PACKAGE_NAMES = new Set(['langchain', '@langchain/core', '@langchain/langgraph', '@langchain/openai', 'langsmith']);
const BLOCKED_JOBS = new Set(['failed', 'paused', 'submission_uncertain', 'needs_attention']);
const RUNNING_JOBS = new Set(['submitting', 'polling', 'running', 'working']);
const ARCHIVE_NAME = /^[a-f0-9]{16}-[a-f0-9]{64}\.(png|jpg)$/;
const PROVIDER_CHECK_MAX_AGE_MS = 5 * 60 * 1000;
const PROVIDER_CHECK_FAILURE = 'Provider verification failed; check connection in FLUX controls.';
const hasValue = value => typeof value === 'string' ? value.trim().length > 0 : Boolean(value);
const truthyFlag = value => value === true || String(value).toLowerCase() === 'true';
const zone = artwork => artwork.status === 'approved_product_prepared' ? 'approved' : artwork.status === 'rejected' ? 'rejected' : 'pending';
const qualityPresent = artwork => Number.isInteger(artwork.quality?.width) && artwork.quality.width > 0 && Number.isInteger(artwork.quality?.height) && artwork.quality.height > 0;
const usablePrice = value => value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value)) && Number(value) > 0;
const fail = (message, statusCode = 400) => { throw Object.assign(new Error(message), { statusCode }); };

function packageInfo(root, name) {
  if (!PACKAGE_NAMES.has(name)) return { installed: false, version: null };
  let file = path.join(root, 'node_modules', ...name.split('/'), 'package.json');
  if (name === 'langsmith' && !fs.existsSync(file)) {
    try {
      // pnpm links the public package directory into its store; transitive
      // dependencies resolve beside the real package, not beside that link.
      const require = createRequire(fs.realpathSync(path.join(root, 'node_modules', '@langchain', 'core', 'package.json')));
      try { file = require.resolve('langsmith/package.json'); }
      catch {
        let directory = path.dirname(require.resolve('langsmith'));
        while (directory !== path.dirname(directory)) {
          const candidate = path.join(directory, 'package.json');
          if (fs.existsSync(candidate) && JSON.parse(fs.readFileSync(candidate, 'utf8')).name === 'langsmith') { file = candidate; break; }
          directory = path.dirname(directory);
        }
      }
    } catch { /* A missing optional tracing package is reported, never installed here. */ }
  }
  try {
    const metadata = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (metadata.name !== name) return { installed: false, version: null };
    const version = typeof metadata.version === 'string' && /^\d+\.\d+\.\d+(?:[-+][a-z0-9.-]+)?$/i.test(metadata.version) ? metadata.version : null;
    return { installed: true, version };
  } catch { return { installed: false, version: null }; }
}

function presentFile(directory, fileName) {
  if (!directory || typeof fileName !== 'string') return false;
  try {
    const base = path.resolve(directory), candidate = path.resolve(base, fileName);
    if (!candidate.startsWith(base + path.sep)) return false;
    if (!fs.realpathSync(candidate).startsWith(fs.realpathSync(base) + path.sep)) return false;
    return fs.statSync(candidate).isFile();
  } catch { return false; }
}

export class PipelineMonitor {
  constructor({ productionReview, flux, upscale = null, creativeOrchestrator, creativeAgent, drafts = new Map(), settings = {}, env = process.env, root = process.cwd(), now = () => new Date() } = {}) {
    Object.assign(this, { productionReview, flux, upscale, creativeOrchestrator, creativeAgent, drafts, settings, env, root: path.resolve(root), now });
    this.providerVerification = null;
  }

  freshProviderVerification(checkedAt) {
    const cached = this.providerVerification;
    if (!cached) return null;
    const age = Date.parse(checkedAt) - Date.parse(cached.checkedAt);
    return age >= 0 && age < PROVIDER_CHECK_MAX_AGE_MS ? cached : null;
  }

  systems(checkedAt = new Date(this.now()).toISOString()) {
    const langchain = packageInfo(this.root, 'langchain');
    const graph = packageInfo(this.root, '@langchain/langgraph');
    const smith = packageInfo(this.root, 'langsmith');
    const openai = packageInfo(this.root, '@langchain/openai');
    const modelPresent = Boolean(this.creativeOrchestrator?.model);
    const graphPresent = Boolean(this.creativeOrchestrator?.graph);
    const tracing = hasValue(this.env.LANGSMITH_API_KEY) && (truthyFlag(this.env.LANGSMITH_TRACING) || truthyFlag(this.env.LANGCHAIN_TRACING_V2));
    const openaiConfigured = modelPresent || hasValue(this.settings.openaiApiKey) || hasValue(this.env.OPENAI_API_KEY);
    const fluxConfigured = hasValue(this.flux?.key) || hasValue(this.env.BFL_API_KEY);
    const replicateConfigured = hasValue(this.upscale?.token) || hasValue(this.settings.replicateToken) || hasValue(this.env.REPLICATE_API_TOKEN);
    const providerCheck = this.freshProviderVerification(checkedAt);
    const providerDetail = providerCheck?.verified
      ? `BFL connection verified at ${providerCheck.checkedAt}.${providerCheck.credits !== null ? ` Available credits: ${providerCheck.credits}.` : ' Credit balance was not provided as a number.'}`
      : providerCheck ? PROVIDER_CHECK_FAILURE
        : fluxConfigured ? 'A BFL key is configured. Account access and credits are unverified by this monitor.' : 'A BFL key is needed before approved image generation can be submitted.';
    const shopifyConfigured = [this.settings.shopifySecret, this.env.SHOPIFY_WEBHOOK_SECRET, this.env.SHOPIFY_ADMIN_ACCESS_TOKEN, this.env.SHOPIFY_ACCESS_TOKEN, this.env.SHOPIFY_API_KEY, this.env.SHOPIFY_CLIENT_ID].some(hasValue);
    return [
      { id: 'langchain', name: 'LangChain', role: 'Model integration for creative direction review', ...langchain, configured: modelPresent, verified: false,
        status: !langchain.installed ? 'not-connected' : modelPresent ? 'ready' : 'manual',
        detail: modelPresent ? 'Package and model object are present. Model access was not checked over the network.' : 'Creative review uses local rules until a model is configured; this does not inspect artwork pixels.' },
      { id: 'langgraph', name: 'LangGraph', role: 'Runs the creative steps and stops for owner approval', ...graph, configured: graphPresent, verified: graphPresent,
        status: graphPresent ? 'ready' : 'not-connected',
        detail: graphPresent ? 'A local graph is present. Readiness does not mean a brief or generation has completed.' : 'No creative graph is available in this running application.' },
      { id: 'langsmith', name: 'LangSmith', role: 'Optional traces and debugging; does not orchestrate the pipeline', ...smith, configured: tracing, verified: false,
        status: smith.installed && tracing ? 'ready' : 'not-connected',
        detail: tracing ? 'Tracing credentials and a tracing flag are configured. Trace delivery and account access remain unverified.' : 'Tracing needs a key and an enabled tracing flag. No trace delivery was checked.' },
      { id: 'openai', name: 'OpenAI', role: 'Optional text review of creative directions', ...openai, configured: openaiConfigured, verified: false,
        status: modelPresent ? 'ready' : openaiConfigured ? 'blocked' : 'not-connected',
        detail: modelPresent ? 'The creative model object is configured. No API call, credit check or visual scoring was performed.' : openaiConfigured ? 'A key is configured, but this application has no creative model object.' : 'No creative model connection is configured. Local creative directions remain available.' },
      { id: 'flux', name: 'FLUX', role: 'Paid image generation through BFL', installed: null, version: null, configured: fluxConfigured, verified: providerCheck?.verified === true,
        status: providerCheck ? providerCheck.verified ? 'ready' : 'blocked' : fluxConfigured ? 'ready' : 'not-connected',
        detail: providerDetail },
      { id: 'replicate', name: 'Replicate', role: 'Print-master upscaling (Topaz) to 300 PPI', installed: null, version: null, configured: replicateConfigured, verified: false,
        status: replicateConfigured ? 'ready' : 'not-connected',
        detail: replicateConfigured ? 'REPLICATE_API_TOKEN is set. The connection and the model schema are verified on the first master request, not here.' : 'No REPLICATE_API_TOKEN. Generated images stay at 4 MP and cannot pass the resolution check. BFL has no still-image upscale; add the token to enable print masters.' },
      { id: 'midjourney', name: 'Midjourney', role: 'Manual image generation and original-file import', installed: null, version: null, configured: this.settings.creationExecutor === 'midjourney', verified: false,
        status: 'manual', detail: 'Generate in Midjourney yourself, then import the selected original. This application has no verified Midjourney API connection.' },
      { id: 'shopify', name: 'Shopify', role: 'Product publishing and store administration', installed: null, version: null, configured: shopifyConfigured, verified: false,
        status: 'not-connected', detail: 'Automatic product publishing and the Admin API integration are not implemented. Configured keys or a webhook signing secret do not establish publishing access.' },
      { id: 'digital-products', name: 'Digital Products', role: 'Attach purchased files and deliver customer downloads', installed: true, version: null, configured: null, verified: false,
        status: 'not-connected', detail: 'Installation was reported by the owner, not verified through an API. File attachment and a customer download test are still required.' },
      { id: 'gelato', name: 'Gelato', role: 'Optional print production and fulfillment', installed: true, version: null, configured: null, verified: false,
        status: 'not-connected', detail: 'Installation was reported by the owner, not verified through an API. Product mapping, production files and fulfillment are not connected here.' },
    ];
  }

  hasOriginal(artwork) {
    if (artwork.reviewImageUrl && ARCHIVE_NAME.test(artwork.localFile?.fileName || '')
      && artwork.localFile.hash === artwork.hash && artwork.localFile.sourceUrl === artwork.assetUrl) {
      return presentFile(this.productionReview?.fileRoot, artwork.localFile.fileName);
    }
    return typeof artwork.assetUrl === 'string' && artwork.assetUrl.startsWith('/assets/')
      && presentFile(this.productionReview?.assetRoot, artwork.assetUrl.slice('/assets/'.length));
  }

  hasBackup(artwork) {
    const archive = artwork.archive;
    const expected = zone(artwork) === 'approved' ? 'Approved' : zone(artwork) === 'rejected' ? 'Rejected' : null;
    return Boolean(expected && archive?.bucket === expected && archive.hash === artwork.hash && ARCHIVE_NAME.test(archive.fileName)
      && presentFile(this.productionReview?.archiveRoot && path.join(this.productionReview.archiveRoot, expected), archive.fileName));
  }

  snapshot() {
    const checkedAt = new Date(this.now()).toISOString(), issues = [];
    let artworks = [], jobs = [], readFailed = false;
    const issue = (stageId, message, count = 1) => issues.push({ stageId, message, count });
    try {
      artworks = this.productionReview?.list() ?? [];
      if (!Array.isArray(artworks)) throw new Error('Invalid local artwork list');
    } catch { artworks = []; readFailed = true; issue('originals', 'The local artwork review state could not be read.'); }
    try {
      jobs = this.flux?.list() ?? [];
      if (!Array.isArray(jobs)) throw new Error('Invalid local creation queue');
    } catch { jobs = []; readFailed = true; issue('creation-queue', 'The local creation queue could not be read.'); }
    const systems = this.systems(checkedAt);
    const system = id => systems.find(item => item.id === id);
    const pending = artworks.filter(item => zone(item) === 'pending');
    const approved = artworks.filter(item => zone(item) === 'approved');
    const rejected = artworks.filter(item => zone(item) === 'rejected');
    const queued = jobs.filter(job => job.status === 'queued').length;
    const running = jobs.filter(job => RUNNING_JOBS.has(job.status)).length;
    const failed = jobs.filter(job => job.status === 'failed').length;
    const blockedJobs = jobs.filter(job => BLOCKED_JOBS.has(job.status)).length;
    const uncertain = jobs.filter(job => ['paused', 'submission_uncertain'].includes(job.status)).length;
    const generated = jobs.filter(job => job.status === 'artwork_ready').length;
    const originals = artworks.filter(item => this.hasOriginal(item)).length;
    let masterJobs = [];
    try { masterJobs = this.upscale?.list() ?? []; if (!Array.isArray(masterJobs)) masterJobs = []; } catch { masterJobs = []; }
    const mastersReady = masterJobs.filter(job => job.status === 'master_ready').length;
    const mastersPending = masterJobs.filter(job => ['queued', 'submitting', 'polling'].includes(job.status)).length;
    const mastersLow = masterJobs.filter(job => job.status === 'master_low_detail').length;
    const mastersStuck = masterJobs.filter(job => ['needs_attention', 'submission_uncertain', 'failed'].includes(job.status)).length;
    if (mastersStuck) issue('originals', `${mastersStuck} print-master jobs need attention; uncertain submissions are never retried by this monitor.`, mastersStuck);
    if (mastersLow) issue('originals', `${mastersLow} print masters added no measurable detail over a plain stretch and must not be sold as print files.`, mastersLow);
    const quality = artworks.filter(qualityPresent).length;
    const unmeasured = artworks.length - quality;
    const pendingQuality = pending.filter(qualityPresent).length;
    const suggested = pending.filter(item => qualityPresent(item) && usablePrice(item.pricing?.amount)).length;
    const decisions = [...approved, ...rejected];
    const backups = decisions.filter(item => this.hasBackup(item)).length;
    const products = approved.filter(item => item.product?.title && item.product?.sku && item.product?.currency && usablePrice(item.product?.price)).length;
    const activeDrafts = this.drafts instanceof Map ? [...this.drafts.entries()].filter(([, draft]) => !draft.expiresAt || draft.expiresAt >= Date.parse(checkedAt)) : [];
    const awaitingGeneration = activeDrafts.filter(([id, draft]) => !jobs.some(job => typeof job.approvalId === 'string' && job.approvalId.startsWith((draft.result?.promptId || id) + ':'))).length;
    const canCreate = typeof this.creativeAgent?.create === 'function';
    if (system('flux').status === 'blocked') issue('provider', PROVIDER_CHECK_FAILURE);
    if (blockedJobs) issue('creation-queue', `${blockedJobs} creation jobs need attention. Paused or uncertain submissions are never retried by this monitor.`, blockedJobs);
    if (artworks.length > originals) issue('originals', `${artworks.length - originals} artwork originals are not present locally; remote file availability is unverified.`, artworks.length - originals);
    if (unmeasured) issue('resolution', `${unmeasured} artworks still need a measured resolution check.`, unmeasured);
    if (pendingQuality > suggested) issue('pricing', `${pendingQuality - suggested} measured pending artworks have no current price suggestion.`, pendingQuality - suggested);
    if (decisions.length > backups) issue('backups', `${decisions.length - backups} saved decisions have no matching backup file present.`, decisions.length - backups);
    if (approved.length > products) issue('product-fields', `${approved.length - products} approved artworks need complete local product details.`, approved.length - products);
    if (approved.length) issue('shopify', 'Approved products remain local; Shopify publishing and digital download delivery are not connected.', approved.length);
    const states = {
      brief: [canCreate ? 'ready' : 'not-connected', activeDrafts.length, canCreate ? `${activeDrafts.length} current briefs are cached. The local brief builder is available; this is readiness, not completion.` : 'The local creative brief builder is unavailable.'],
      directions: [canCreate ? 'ready' : 'not-connected', activeDrafts.length, `${activeDrafts.length} current creative drafts are available. ${this.creativeOrchestrator?.model ? 'Text model review is configured but network access is unverified.' : 'Creative direction review uses local rules.'}`],
      'generation-approval': [awaitingGeneration ? 'manual' : 'waiting', awaitingGeneration, `${awaitingGeneration} current drafts await an explicit owner choice before paid generation.`],
      provider: [system('flux').status === 'not-connected' ? 'manual' : system('flux').status, Number(system('flux').configured), `${system('flux').detail} Use Check stage to verify BFL without starting generation. Midjourney remains a manual option.`],
      'creation-queue': [blockedJobs ? 'blocked' : running ? 'running' : queued ? 'waiting' : 'ready', queued + running + blockedJobs, `${queued} queued, ${running} running and ${blockedJobs} needing attention. ${uncertain} paused or uncertain submissions will not be retried here.`],
      generation: [blockedJobs ? 'blocked' : running ? 'running' : queued ? 'waiting' : generated ? 'ready' : 'waiting', generated, `${generated} generated files are recorded locally; ${running} jobs are running. Checking this stage never starts generation.`],
      originals: [artworks.length > originals ? 'blocked' : originals ? 'ready' : 'waiting', originals, `${originals} original files are present locally out of ${artworks.length} artworks. Remote files are unverified. Presence does not verify file integrity.${masterJobs.length ? ` Print masters: ${mastersReady} ready, ${mastersPending} in progress, ${mastersLow} low-detail, ${mastersStuck} need attention.` : ''}`],
      resolution: [unmeasured ? 'waiting' : quality ? 'ready' : 'waiting', quality, `${quality} of ${artworks.length} artworks have measured pixels. Choose one artwork to read its original and refresh the resolution report.`],
      'visual-review': [pendingQuality ? 'manual' : 'waiting', pendingQuality, `${pendingQuality} measured pending artworks await owner visual review. Automatic AI visual scoring is not connected.`],
      pricing: [pendingQuality > suggested ? 'blocked' : suggested || approved.length ? 'ready' : 'waiting', suggested + approved.length, `${suggested} pending artworks have current rule-based price suggestions from measured pixels and market samples. ${approved.length} saved approved prices are preserved. No pricing AI is running.`],
      'product-approval': [pending.length ? 'manual' : approved.length ? 'ready' : 'waiting', approved.length, `${approved.length} approved, ${rejected.length} rejected and ${pending.length} pending. Only the owner approves the artwork and selling price.`],
      backups: [decisions.length > backups ? 'blocked' : backups ? 'ready' : 'waiting', backups, `${backups} of ${decisions.length} decision backup files are present. These are saved-file checks, not fresh integrity verification.`],
      'product-fields': [approved.length > products ? 'blocked' : products ? 'ready' : 'waiting', products, `${products} approved artworks have local product details ready. A prepared product has not been published.`],
      shopify: ['not-connected', products, 'Automatic Shopify product publishing and Admin API integration are not implemented, even when credentials are configured.'],
      'digital-delivery': ['not-connected', approved.length, 'Digital Products installation is owner-reported. Customer files still need attaching and an end-to-end download test.'],
      publishing: [approved.length ? 'blocked' : 'waiting', approved.length, `${approved.length} approved artworks remain local. Publishing awaits a Shopify connection and verified customer delivery.`],
      monitoring: [readFailed ? 'blocked' : 'ready', issues.length, 'This monitor reads local state. Refreshing does not start paid work, change decisions, retry jobs or verify external services.'],
    };
    const stages = STAGES.map(([id, title, openHash], index) => ({ id, number: index + 1, title, status: states[id][0], count: states[id][1], detail: states[id][2], canCheckArtwork: ARTWORK_CHECKS.has(id), openHash }));
    if (readFailed) for (const stage of stages) if (['creation-queue', 'generation', 'originals', 'resolution', 'pricing'].includes(stage.id)) stage.status = 'blocked';
    return { checkedAt, summary: { total: artworks.length, pending: pending.length, approved: approved.length, rejected: rejected.length, queued, running, failed }, stages, systems,
      artworks: artworks.map(item => {
        const hasQuality = qualityPresent(item);
        const price = zone(item) === 'approved' ? item.product?.price ?? item.approval?.price : zone(item) === 'pending' ? item.pricing?.amount : undefined;
        return { id: item.id, title: item.title, status: item.status, ...(hasQuality ? { width: item.quality.width, height: item.quality.height } : {}), ...(usablePrice(price) ? { price } : {}), hasLocalOriginal: this.hasOriginal(item), hasQuality };
      }), issues };
  }

  async check(stageId, { artworkId } = {}) {
    if (!STAGES.some(([id]) => id === stageId)) fail('Choose a known pipeline stage.');
    let providerMessage;
    if (artworkId !== undefined) {
      if (!ARTWORK_CHECKS.has(stageId)) fail('Artwork checks are available only for originals, resolution and pricing.');
      if (typeof artworkId !== 'string' || !artworkId.trim() || artworkId.length > 500 || /[\u0000-\u001f\u007f]/.test(artworkId)) fail('Choose a valid artwork.');
      if (!this.productionReview?.list().some(artwork => artwork.id === artworkId)) fail('Artwork not found in the current review list.', 409);
      await this.productionReview.inspect(artworkId);
    } else if (stageId === 'provider') {
      let verified = false, credits = null;
      const available = typeof this.flux?.connection === 'function';
      if (available) {
        try {
          const result = await this.flux.connection();
          verified = result?.verified === true;
          if (verified && typeof result.credits === 'number' && Number.isFinite(result.credits) && result.credits >= 0) credits = result.credits;
        } catch { /* Never return provider errors, response payloads or credentials. */ }
      }
      this.providerVerification = { verified, checkedAt: new Date(this.now()).toISOString(), credits };
      providerMessage = verified ? `BFL connection verified.${credits !== null ? ` Available credits: ${credits}.` : ''} No generation was started.`
        : available ? PROVIDER_CHECK_FAILURE : 'Provider verification is unavailable in this application. Check connection in FLUX controls.';
    }
    const snapshot = this.snapshot();
    return { checkedAt: snapshot.checkedAt, stage: snapshot.stages.find(stage => stage.id === stageId), snapshot,
      message: providerMessage || (artworkId !== undefined ? 'The selected original was checked and its resolution report refreshed. Existing decisions remain bound to their saved file.' : 'Local stage status refreshed. No external connections were checked and no work was started.') };
  }
}
