export const pictureStudioStyles = `<style>
.picture-studio{margin:22px;max-width:1220px;border:1px solid #81956c;border-radius:14px;background:#20291b;color:#f5faef;box-shadow:0 10px 32px #0003}.picture-studio>summary{padding:20px 24px;cursor:pointer;font-size:23px;font-weight:700;color:#edffd7}.picture-studio>summary::marker{color:#cdeaac}.picture-studio-body{padding:0 24px 24px;font-size:15px;line-height:1.6}.picture-studio p{margin:8px 0 16px}.picture-studio .picture-muted{color:#d0ddc4}.picture-studio h3{font-size:19px;margin:0 0 10px}.picture-studio input,.picture-studio select,.picture-studio textarea{font-size:16px;border-color:#839575;color:#fff;background:#10170d}.picture-studio textarea{min-height:116px;resize:vertical}.picture-studio label{font-size:15px;color:#edf5e6}.picture-studio input[type=checkbox],.picture-studio input[type=radio]{width:20px;height:20px;padding:0;margin:3px 0;flex:0 0 20px;accent-color:#cdeaac}.picture-studio button,.picture-studio .button{font-size:15px;min-height:44px}.picture-studio button:disabled,.picture-studio input:disabled{cursor:not-allowed;opacity:.65}.picture-studio [hidden]{display:none!important}.picture-studio fieldset{padding:0;margin:0;min-width:0;border:0}.picture-studio .picture-layout{display:grid;grid-template-columns:minmax(0,1.1fr) minmax(0,1fr);gap:26px}.picture-studio .picture-upload{display:block;padding:16px;background:#172111;border:1px dashed #9aac89;border-radius:10px;margin-top:0}.picture-upload strong,.picture-upload span{display:block}.picture-upload input{margin-top:10px;width:100%;padding:10px}.picture-upload input::file-selector-button{background:#d3ecb4;color:#18210f;border:0;border-radius:5px;padding:8px 10px;margin-right:10px;font:inherit;font-weight:600;cursor:pointer}.picture-library-head{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;margin:18px 0 12px}.picture-library-head h3,.picture-library-head p{margin:0}.picture-library{display:grid;grid-template-columns:repeat(auto-fill,minmax(135px,1fr));gap:10px;max-height:440px;overflow:auto;padding:3px}.picture-card{min-width:0;position:relative;display:block;margin:0!important;padding:8px;background:#131c0f;border:1px solid #687d58;border-radius:9px;cursor:pointer;overflow-wrap:anywhere}.picture-card:has(input:checked){border:2px solid #dbfdb9;padding:7px;background:#304226}.picture-card img{width:100%;height:105px;object-fit:contain;border-radius:5px;background:#0c1109;display:block}.picture-card-choice{display:flex;align-items:flex-start;gap:8px;margin:8px 0 3px}.picture-card small{display:block;font-size:12px;color:#d0ddc4}.picture-card-name{font-size:14px;line-height:1.35}.picture-studio .picture-mode-options{display:grid;grid-template-columns:1fr 1fr;gap:10px}.picture-mode-options label{display:flex;align-items:center;gap:9px;margin:0;padding:12px;border:1px solid #718662;border-radius:8px;background:#172111;cursor:pointer}.picture-mode-options label:has(input:checked){border-color:#d3efb5;background:#304226}.picture-studio legend{font-size:16px;font-weight:650;margin-bottom:10px;color:#f2f8e9}.picture-studio #picture-mode-help{margin:12px 0 18px}.picture-studio .picture-status{margin:14px 0 0;white-space:pre-line;overflow-wrap:anywhere}.picture-status[data-error=true]{color:#ffbdb5}.picture-plan{margin-top:22px;padding-top:22px;border-top:1px solid #718662}.picture-plan-list{display:grid;gap:12px;padding:0;list-style:none;counter-reset:picture-output}.picture-plan-item{display:grid;grid-template-columns:130px minmax(0,1fr);gap:16px;padding:16px;border:1px solid #687d58;border-radius:10px;background:#162010;overflow-wrap:anywhere}.picture-plan-item h4{font-size:17px;margin:0 0 7px}.picture-plan-item p{margin:4px 0 8px}.picture-plan-references{display:flex;gap:5px;flex-wrap:wrap;align-content:start}.picture-plan-references img{display:block;width:100%;height:105px;object-fit:contain;background:#0c1109;border-radius:5px}.picture-plan-references:has(img:nth-child(2)) img{width:60px;height:60px}.picture-plan-item summary{font-size:15px;cursor:pointer;color:#e5f3d6}.picture-plan-item pre{white-space:pre-wrap;overflow-wrap:anywhere;font:inherit;color:#e3eddb;margin:10px 0 0}.picture-studio .picture-approval{display:flex;gap:12px;align-items:flex-start;padding:16px;margin:18px 0 12px;border:1px solid #a3b78d;border-radius:9px;background:#303e25;line-height:1.6}.picture-next{display:flex;gap:10px;flex-wrap:wrap;margin-top:14px}.picture-studio .picture-empty{grid-column:1/-1;padding:14px;border:1px solid #687d58;border-radius:8px;margin:0}.picture-form-note{font-size:14px}.picture-studio #picture-prepare{margin-top:15px}
.picture-studio .picture-pixel-fields{display:grid;grid-template-columns:1fr 1fr;gap:12px}.picture-studio .picture-pixel-fields label{min-width:0}.picture-studio #picture-resolution-help{margin:8px 0;font-size:14px}.picture-studio select:disabled{opacity:.65;cursor:not-allowed}
@media(max-width:900px){.picture-studio{margin:16px}.picture-studio .picture-layout{grid-template-columns:1fr;gap:24px}.picture-studio>summary{font-size:21px;padding:17px}.picture-studio-body{padding:0 17px 20px}.picture-library{max-height:360px}.picture-plan-item{grid-template-columns:100px minmax(0,1fr)}}@media(max-width:480px){.picture-studio{margin:12px}.picture-studio>summary{font-size:20px}.picture-studio .picture-mode-options{grid-template-columns:1fr}.picture-plan-item{grid-template-columns:1fr}.picture-plan-references img{width:100px;height:90px}.picture-studio #picture-generate,.picture-studio #picture-prepare{width:100%}}
</style>`;

export const pictureStudioScript = String.raw`<script>
(() => {
  const viewport = document.querySelector('.canvas-viewport');
  if (!viewport || document.querySelector('#picture-studio')) return;
  const make = (tag, className, text) => {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text !== undefined) element.textContent = text;
    return element;
  };
  const studio = make('details', 'picture-studio');
  studio.id = 'picture-studio';
  studio.open = true;
  studio.innerHTML = '<summary>Pictures → artwork or collection</summary>' +
    '<div class="picture-studio-body"><p class="picture-muted">Start with your own pictures. Save them locally, describe the transformation, then review an artwork plan before approving paid generation.</p>' +
    '<form id="picture-form"><fieldset id="picture-controls"><div class="picture-layout"><section aria-labelledby="picture-library-heading">' +
    '<label class="picture-upload" for="picture-files"><strong>Upload pictures</strong><span class="picture-muted">PNG or JPEG · up to 8 selected · 10 MiB and 20 megapixels maximum per picture · at least 64 px on each side</span><input id="picture-files" name="pictureFiles" type="file" accept="image/png,image/jpeg,.png,.jpg,.jpeg" multiple aria-describedby="picture-local-note"></label>' +
    '<p class="picture-form-note picture-muted" id="picture-local-note">Your library stores JPEG reference copies with orientation corrected and metadata removed. Transparent backgrounds become white. The originals on your computer stay untouched. Uploading and preparing a plan do not start generation or send pictures to Black Forest Labs.</p>' +
    '<div class="picture-library-head"><div><h3 id="picture-library-heading">Your picture library</h3><p id="picture-selection-count" class="picture-muted">0 of 8 pictures selected</p></div><button type="button" class="secondary" id="picture-clear" disabled>Clear selection</button></div>' +
    '<div id="picture-library" class="picture-library" aria-label="Saved pictures"><p class="picture-empty picture-muted">Loading saved pictures…</p></div>' +
    '<p class="picture-form-note picture-muted">Tick a picture to select it. Untick it or clear the selection to remove it from this plan; the reference copy stays in your library.</p>' +
    '</section><section aria-label="Picture transformation settings"><fieldset><legend>What would you like to create?</legend><div class="picture-mode-options">' +
    '<label><input type="radio" name="pictureMode" value="single" checked>One artwork</label><label><input type="radio" name="pictureMode" value="collection">Collection</label></div></fieldset>' +
    '<p id="picture-mode-help" class="picture-muted"></p>' +
    '<label for="picture-title" id="picture-title-label">Artwork title</label><input id="picture-title" name="pictureTitle" maxlength="200" placeholder="e.g. Quiet Light">' +
    '<label for="picture-instructions">How should your pictures become art?</label><textarea id="picture-instructions" name="pictureInstructions" maxlength="9000" rows="4" placeholder="e.g. Turn these photographs into expressive oil paintings, keeping the subjects and using warm evening light."></textarea>' +
    '<label for="picture-ratio">Artwork shape · width : height</label><select id="picture-ratio" name="pictureAspectRatio"><option value="source">Keep each picture’s shape</option><option value="1:1">1:1 · square</option><option value="2:3">2:3 · portrait</option><option value="3:2">3:2 · landscape</option><option value="4:5">4:5 · portrait</option></select>' +
    '<label for="picture-resolution">Output resolution</label><select id="picture-resolution" name="pictureResolution" aria-describedby="picture-resolution-help picture-native-note"><option value="highest">Highest native · up to 4 MP</option><option value="2mp">Up to 2 MP</option><option value="1mp">Up to 1 MP</option><option value="custom">Custom pixels</option></select>' +
    '<div id="picture-custom-pixels" class="picture-pixel-fields" hidden><label for="picture-width">Width · pixels<input id="picture-width" name="picturePixelWidth" type="number" step="16" min="64" max="4096" value="2048" disabled></label><label for="picture-height">Height · pixels<input id="picture-height" name="picturePixelHeight" type="number" step="16" min="64" max="4096" value="2048" disabled></label></div>' +
    '<p id="picture-resolution-help" class="picture-muted"></p><p id="picture-native-note" class="picture-form-note picture-muted">Native output only. Custom dimensions must use multiples of 16 and stay within 4 MP; 8K needs a separate upscale.</p>' +
    '<button id="picture-prepare" type="submit" disabled>Prepare artwork plan · no generation cost</button>' +
    '</section></div></fieldset></form><p id="picture-status" class="picture-status" role="status" aria-live="polite"></p><section id="picture-plan" class="picture-plan" aria-label="Prepared picture artwork plan" hidden></section></div>';
  viewport.insertBefore(studio, viewport.querySelector('.canvas-space'));

  const find = selector => studio.querySelector(selector);
  const form = find('#picture-form');
  const controls = find('#picture-controls');
  const files = find('#picture-files');
  const library = find('#picture-library');
  const clear = find('#picture-clear');
  const prepare = find('#picture-prepare');
  const status = find('#picture-status');
  const plan = find('#picture-plan');
  const selected = new Set();
  let pictures = [], draft = null, busy = false, libraryReady = false, revision = 0;

  function message(text, error = false) {
    status.textContent = text;
    status.dataset.error = String(error);
  }
  function mode() { return find('input[name="pictureMode"]:checked').value; }
  function updateControls() {
    controls.disabled = busy;
    prepare.disabled = busy || !libraryReady || !selected.size;
    clear.disabled = busy || !selected.size;
    const customPixels = find('#picture-resolution').value === 'custom';
    find('#picture-custom-pixels').hidden = !customPixels;
    find('#picture-ratio').disabled = busy || customPixels;
    for (const input of [find('#picture-width'), find('#picture-height')]) {
      input.disabled = busy || !customPixels;
      input.required = customPixels;
    }
    find('#picture-resolution-help').textContent = customPixels
      ? 'Custom width and height define the output shape and replace the artwork shape setting above.'
      : 'The prepared plan shows the actual dimensions, rounded to provider increments while following your selected shape.';
    find('#picture-selection-count').textContent = selected.size + ' of 8 pictures selected';
    find('#picture-title-label').textContent = mode() === 'collection' ? 'Collection title' : 'Artwork title';
    find('#picture-mode-help').textContent = mode() === 'collection'
      ? 'One separate artwork per selected picture, up to 8 artworks. Each uses its own picture as a reference; they are never combined into a collage.'
      : 'One artwork uses all selected pictures as references. With different picture shapes, the prepared plan shows the final shape.';
    for (const checkbox of library.querySelectorAll('input[type="checkbox"]')) {
      checkbox.disabled = busy || (!checkbox.checked && selected.size >= 8);
    }
  }
  function invalidate() {
    revision++;
    const hadDraft = Boolean(draft);
    draft = null;
    plan.replaceChildren();
    plan.hidden = true;
    if (hadDraft) message('Your choices changed. Prepare a new plan and review it before approving generation.');
    updateControls();
  }
  async function request(url, options) {
    const response = await fetch(url, options);
    let data;
    try { data = await response.json(); }
    catch { throw Object.assign(new Error('The studio returned an unreadable response. Please try again.'), { status: response.status }); }
    if (!response.ok) throw Object.assign(new Error(data.error || 'The studio could not complete this request.'), { status: response.status });
    return data;
  }
  function addReferenceImage(picture, target) {
    if (!picture) return;
    const image = make('img');
    image.src = picture.previewUrl;
    image.alt = picture.name;
    image.loading = 'lazy';
    target.append(image);
  }
  function renderLibrary() {
    library.replaceChildren();
    if (!pictures.length) library.append(make('p', 'picture-empty picture-muted', 'No saved pictures yet. Upload a PNG or JPEG to begin.'));
    for (const picture of pictures) {
      const card = make('label', 'picture-card');
      addReferenceImage(picture, card);
      const line = make('span', 'picture-card-choice');
      const checkbox = make('input');
      checkbox.type = 'checkbox';
      checkbox.name = 'pictureSelection';
      checkbox.value = picture.id;
      checkbox.checked = selected.has(picture.id);
      checkbox.setAttribute('aria-label', 'Select ' + picture.name);
      checkbox.addEventListener('change', () => {
        if (checkbox.checked && selected.size >= 8) {
          checkbox.checked = false;
          message('You can select up to 8 pictures. Remove one from the selection before choosing another.', true);
          return;
        }
        if (checkbox.checked) selected.add(picture.id); else selected.delete(picture.id);
        invalidate();
      });
      line.append(checkbox, make('span', 'picture-card-name', picture.name));
      card.append(line, make('small', '', picture.width + ' × ' + picture.height + ' px · ' + (picture.bytes / 1048576).toFixed(1) + ' MiB'));
      library.append(card);
    }
    updateControls();
  }
  function nextLinks(target) {
    const links = make('div', 'picture-next');
    for (const [title, hash] of [['Open Pipeline', '#flux-studio'], ['Open Review', '#production-review']]) {
      const link = make('a', 'button secondary', title);
      link.href = hash;
      links.append(link);
    }
    target.append(links);
  }
  function renderPlan(prepared, preparedRevision) {
    plan.replaceChildren();
    plan.hidden = false;
    const count = prepared.artworks.length;
    plan.append(make('h3', '', prepared.title + ' · ' + count + (count === 1 ? ' artwork' : ' separate artworks')));
    plan.append(make('p', 'picture-muted', 'Prepared locally. Review the references, instructions and native output dimensions below. No images have been generated.'));
    const list = make('ol', 'picture-plan-list');
    for (const artwork of prepared.artworks) {
      const item = make('li', 'picture-plan-item');
      const references = make('div', 'picture-plan-references');
      for (const id of artwork.referenceIds) addReferenceImage(pictures.find(picture => picture.id === id), references);
      const content = make('div');
      content.append(make('h4', '', artwork.number + '. ' + artwork.title));
      content.append(make('p', 'picture-muted', 'Shape ' + artwork.aspectRatio + ' · ' + artwork.generation.width + ' × ' + artwork.generation.height + ' native pixels'));
      if (artwork.shapeNote) content.append(make('p', 'picture-muted', artwork.shapeNote));
      content.append(make('p', 'picture-muted', 'References: ' + artwork.referenceIds.map(id => pictures.find(picture => picture.id === id)?.name || 'Saved picture').join(', ')));
      const details = make('details');
      details.append(make('summary', '', 'Read the transformation instructions'), make('pre', '', artwork.prompt));
      content.append(details);
      item.append(references, content);
      list.append(item);
    }
    plan.append(list, make('p', 'picture-muted', 'FLUX generation is paid per output. Native image dimensions are shown above; final print quality is checked after generation.'));
    const approvalLabel = make('label', 'picture-approval');
    const approval = make('input');
    approval.type = 'checkbox';
    approval.id = 'picture-approve';
    approval.name = 'picturePaidApproval';
    approval.checked = false;
    approvalLabel.append(approval, document.createTextNode('I have permission to use these pictures. I reviewed this plan and approve sharing the selected pictures with Black Forest Labs and paid generation of ' + count + (count === 1 ? ' artwork.' : ' separate artworks.')));
    const generate = make('button', '', 'Generate approved ' + (count === 1 ? 'artwork' : 'collection') + ' · ' + count + (count === 1 ? ' image' : ' images'));
    generate.id = 'picture-generate';
    generate.type = 'button';
    generate.disabled = true;
    const generationStatus = make('p', 'picture-status');
    generationStatus.setAttribute('role', 'status');
    let submitted = false;
    approval.addEventListener('change', () => {
      generate.disabled = !approval.checked || submitted || busy || draft?.id !== prepared.id || revision !== preparedRevision;
    });
    generate.addEventListener('click', async () => {
      if (!approval.checked || submitted || busy || draft?.id !== prepared.id || revision !== preparedRevision) return;
      busy = true;
      generate.disabled = true;
      approval.disabled = true;
      updateControls();
      generationStatus.textContent = 'Submitting your approved ' + (count === 1 ? 'artwork' : 'collection') + '…';
      generationStatus.dataset.error = 'false';
      try {
        const result = await request('/api/creative/picture-drafts/' + encodeURIComponent(prepared.id) + '/generate', {
          method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ approved: true })
        });
        submitted = true;
        const queued = result.jobs.length;
        generationStatus.textContent = queued + (queued === 1 ? ' artwork queued.' : ' artworks queued.') + ' Follow generation in Pipeline, then inspect the results in Review.';
        nextLinks(plan);
      } catch (error) {
        approval.checked = false;
        generationStatus.dataset.error = 'true';
        if (!error.status || error.status >= 500 || (error.status >= 200 && error.status < 300)) {
          submitted = true;
          generationStatus.textContent = error.message + ' The generation request could not be confirmed. Check Pipeline before starting another generation.';
          nextLinks(plan);
        } else {
          generationStatus.textContent = error.message + ' Review the plan again before retrying.';
          approval.disabled = false;
        }
      } finally {
        busy = false;
        updateControls();
      }
    });
    plan.append(approvalLabel, generate, generationStatus);
  }

  form.addEventListener('input', event => {
    if (event.target.matches('#picture-title, #picture-instructions, #picture-width, #picture-height')) invalidate();
  });
  form.addEventListener('change', event => {
    if (event.target.matches('[name="pictureMode"], #picture-ratio, #picture-resolution, #picture-width, #picture-height')) invalidate();
  });
  clear.addEventListener('click', () => {
    selected.clear();
    invalidate();
    renderLibrary();
    message('Selection cleared. Your reference copies remain saved in the local library.');
  });
  files.addEventListener('change', async () => {
    const incoming = Array.from(files.files || []);
    files.value = '';
    if (!incoming.length || busy) return;
    invalidate();
    busy = true;
    updateControls();
    const errors = [];
    let uploaded = 0;
    for (let index = 0; index < incoming.length; index++) {
      const file = incoming[index];
      if (selected.size >= 8) {
        errors.push(file.name + ': not uploaded; the selection already contains 8 pictures.');
        continue;
      }
      const type = file.type || (/\.png$/i.test(file.name) ? 'image/png' : /\.jpe?g$/i.test(file.name) ? 'image/jpeg' : '');
      if (!['image/png', 'image/jpeg'].includes(type)) {
        errors.push(file.name + ': choose a PNG or JPEG file.');
        continue;
      }
      if (!file.size || file.size > 10 * 1024 * 1024) {
        errors.push(file.name + ': the picture must be nonempty and no larger than 10 MiB.');
        continue;
      }
      message('Saving picture ' + (index + 1) + ' of ' + incoming.length + ' locally: ' + file.name);
      try {
        const result = await request('/api/creative/pictures', {
          method: 'POST', headers: { 'content-type': type, 'x-file-name': encodeURIComponent(file.name) }, body: file
        });
        const picture = result.picture;
        pictures = [picture, ...pictures.filter(saved => saved.id !== picture.id)];
        selected.add(picture.id);
        uploaded++;
        renderLibrary();
      } catch (error) {
        errors.push(file.name + ': ' + error.message);
      }
    }
    busy = false;
    libraryReady = true;
    renderLibrary();
    message(uploaded + (uploaded === 1 ? ' picture saved locally. ' : ' pictures saved locally. ') + selected.size + ' selected. No generation has started.' + (errors.length ? '\n' + errors.join('\n') : ''), errors.length > 0);
  });
  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (busy || !selected.size || !libraryReady) return;
    invalidate();
    const preparedRevision = revision;
    const payload = {
      pictureIds: [...selected], mode: mode(), title: find('#picture-title').value.trim(),
      instructions: find('#picture-instructions').value.trim(), aspectRatio: find('#picture-ratio').value,
      resolution: find('#picture-resolution').value,
      pixelWidth: Number(find('#picture-width').value), pixelHeight: Number(find('#picture-height').value)
    };
    busy = true;
    updateControls();
    message('Preparing your artwork plan locally…');
    try {
      const result = await request('/api/creative/picture-drafts', {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload)
      });
      if (revision !== preparedRevision) return;
      draft = result.draft;
      renderPlan(draft, preparedRevision);
      message('Your plan is ready below. Review it, then explicitly approve picture sharing and paid generation to continue.');
    } catch (error) {
      message(error.message, true);
    } finally {
      busy = false;
      updateControls();
    }
  });
  async function loadLibrary() {
    busy = true;
    updateControls();
    try {
      const result = await request('/api/creative/pictures');
      pictures = result.pictures;
      libraryReady = true;
      renderLibrary();
    } catch (error) {
      library.replaceChildren(make('p', 'picture-empty picture-muted', 'Saved pictures could not be loaded. Reload the page to try again, or upload a picture.'));
      message(error.message, true);
    } finally {
      busy = false;
      updateControls();
    }
  }
  updateControls();
  loadLibrary();
})();
</script>`;
