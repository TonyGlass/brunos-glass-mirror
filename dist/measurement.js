/* Photo classification boundary. Vision classification never supplies dimensions. */
(() => {
  const unavailableProvider = Object.freeze({
    id: 'unavailable', available: false,
    async measure() { return {status: 'unavailable'}; }
  });
  const unavailableMessage = 'Photo received. Automatic measurement is not available yet. Enter or confirm your measurements below.';
  const configurations = ['Sliding Door','Swing Door + Fixed Panel','90° Corner','Fixed Panel / Walk-In','Tub Enclosure','Not Sure / Let Bruno’s recommend it'];
  const categoryNames = {shower_glass:'Shower Glass',mirror:'Mirror',architectural_glass:'Architectural & Custom Glass',unclear:'Could not identify the project'};
  const visionUnavailableProvider = Object.freeze({id:'server-vision',available:true,async analyze(){throw new Error('Vision analysis is not configured.');}});
  function createVisionProvider({endpoint, apiKey, fetchImpl = fetch} = {}) {
    return Object.freeze({id:'server-vision',available:true,async analyze({file,signal}) {
      if (!(file instanceof Blob) || !['image/jpeg','image/png','image/webp'].includes(file.type) || file.size < 1 || file.size > 8*1024*1024) throw new Error('Choose a JPG, PNG or WebP photo no larger than 8 MB.');
      if (!endpoint) throw new Error('Photo analysis is not configured.');
      const dataUrl = await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=()=>reject(new Error('Could not read that photo.'));reader.readAsDataURL(file);});
      const response=await fetchImpl(endpoint,{method:'POST',headers:{'content-type':'application/json',...(apiKey?{apikey:apiKey,authorization:`Bearer ${apiKey}`}:{})},body:JSON.stringify({image:dataUrl}),signal});
      const payload=await response.json().catch(()=>({}));
      if (!response.ok) throw new Error(typeof payload.error==='string'?payload.error:'Photo analysis is temporarily unavailable.');
      if (!categoryNames[payload.category] || !Number.isFinite(payload.confidence) || payload.confidence<0 || payload.confidence>1 || typeof payload.reasoning!=='string' || !Array.isArray(payload.recommendations)) throw new Error('Photo analysis returned an invalid response.');
      const recommendations=payload.recommendations.filter(item=>configurations.includes(item.configuration)&&typeof item.reason==='string').slice(0,3);
      return {category:payload.category,confidence:payload.confidence,reasoning:payload.reasoning.slice(0,500),recommendations};
    }});
  }
  function normalizeSuggestion(result) {
    if (result?.status !== 'suggested') return null;
    if (result.unit !== 'in' || !Number.isFinite(result.width) || result.width <= 0 ||
        !Number.isFinite(result.height) || result.height <= 0 ||
        (result.confidence != null && (!Number.isFinite(result.confidence) || result.confidence < 0 || result.confidence > 1))) return null;
    return Object.freeze({width:result.width, height:result.height, unit:'in', approximate:true,
      confidence:result.confidence ?? null, quality:typeof result.quality === 'string' ? result.quality.slice(0,160) : null});
  }
  function inches(value) {
    const ticks = value * 16;
    if (!Number.isSafeInteger(ticks)) return String(value);
    const whole = Math.floor(ticks / 16); let numerator = ticks % 16, denominator = 16;
    while (numerator && numerator % 2 === 0) { numerator /= 2; denominator /= 2; }
    return numerator ? `${whole ? whole + ' ' : ''}${numerator}/${denominator}` : String(whole);
  }
  function createSession(provider = unavailableProvider) {
    let version = 0, controller;
    let state = {status:'idle', suggestion:null, source:'manual', width:'', height:'', confirmed:false};
    const snapshot = () => ({...state, suggestion:state.suggestion ? {...state.suggestion} : null});
    return {
      snapshot,
      edit(width, height) { state = {...state, width:String(width), height:String(height), source:'customer', confirmed:false}; return snapshot(); },
      confirm() { state.confirmed = true; return snapshot(); },
      useSuggestion() {
        if (!state.suggestion) return null;
        state = {...state, width:inches(state.suggestion.width), height:inches(state.suggestion.height), source:'approximate-suggestion', confirmed:false};
        return snapshot();
      },
      cancel() { ++version; controller?.abort(); state = {...state, status:'idle', suggestion:null, confirmed:false}; },
      async analyze(files, context = {}) {
        const requestVersion = ++version; controller?.abort(); controller = new AbortController();
        state = {...state, status:provider.available === true ? 'analyzing' : 'preparing', suggestion:null, confirmed:false};
        try {
          const result = await provider.measure({files:[...files], context, signal:controller.signal});
          if (requestVersion !== version) return null;
          const suggestion = normalizeSuggestion(result);
          state = {...state, suggestion, status:suggestion ? 'suggested' : result?.status === 'unavailable' ? 'unavailable' : 'error'};
        } catch {
          if (requestVersion !== version) return null;
          state = {...state, status:'error', suggestion:null};
        }
        return snapshot();
      }
    };
  }
  // Only explicit customer facts support these recommendations. No pixel inference.
  function recommend({projectType, placement, openingGeometry} = {}) {
    if (projectType !== 'Shower Doors') return [];
    if (placement === 'tub') return [{configuration:'Tub Enclosure', reason:'You selected an enclosure over a bathtub.'}];
    if (placement === 'shower' && openingGeometry === 'corner') return [{configuration:'90° Corner', reason:'You selected a shower with a corner opening.'}];
    return [];
  }
  function mount({host, photosInput, widthInput, heightInput, getContext, onConfigurationSelect=()=>{}, visionProvider=visionUnavailableProvider, provider = unavailableProvider}) {
    const session = createSession(provider);
    const panel = document.createElement('section');
    panel.className = 'scan-result'; panel.hidden = true;
    panel.setAttribute('aria-label','Photo and approximate measurements');
    panel.innerHTML = `<div class="scan-preview" hidden><img alt="Your selected opening photo — dimensions have not been verified" /><span class="scan-preview-label">PROJECT PHOTO</span></div>
      <div class="scan-result-content"><p class="eyebrow">PHOTO / MEASURE</p><h3>Review your space</h3>
      <p class="scan-result-status" role="status" aria-live="polite"></p>
      <button type="button" class="button button-dark" data-analyze-photo>Analyze photo</button><div data-vision-result hidden></div>
      <dl class="scan-dimensions" hidden><div><dt>Approx. width</dt><dd data-scan-width></dd></div><div><dt>Approx. height</dt><dd data-scan-height></dd></div><div><dt>Confidence / measurement quality</dt><dd data-scan-quality></dd></div></dl>
      <p class="scan-approximate-note">Approximate only. Confirm with a tape measure; Bruno must field-measure before fabrication.</p>
      <button type="button" class="button button-dark" data-use-measurement hidden>Use approximate suggestion</button>
      <p class="scan-correction-note" role="status"></p></div>`;
    host.append(panel);
    const status = panel.querySelector('.scan-result-status');
    const analyzeButton=panel.querySelector('[data-analyze-photo]'), visionResult=panel.querySelector('[data-vision-result]');
    const dimensions = panel.querySelector('.scan-dimensions');
    const use = panel.querySelector('[data-use-measurement]');
    const correction = panel.querySelector('.scan-correction-note');
    const preview = panel.querySelector('.scan-preview');
    const image = preview.querySelector('img');
    let objectUrl, generation = 0;
    let analysisController;
    const clearPreview = () => { if (objectUrl) URL.revokeObjectURL(objectUrl); objectUrl = null; image.removeAttribute('src'); preview.hidden = true; };
    function render(state) {
      panel.dataset.state = state.status;
      panel.setAttribute('aria-busy', String(['preparing','analyzing'].includes(state.status)));
      const suggestion = state.suggestion;
      dimensions.hidden = !suggestion; use.hidden = !suggestion;
      status.textContent = state.status === 'suggested' ? 'Approximate suggestion ready. Review both dimensions before using it.'
        : state.status === 'analyzing' ? 'Checking your photo for approximate measurements…'
        : state.status === 'preparing' ? 'Preparing your selected photo…'
        : state.status === 'unavailable' ? unavailableMessage
        : 'Automatic measurement could not provide a usable result. Enter or confirm your tape measurements below.';
      if (suggestion) {
        panel.querySelector('[data-scan-width]').textContent = `${inches(suggestion.width)} in (Approximate)`;
        panel.querySelector('[data-scan-height]').textContent = `${inches(suggestion.height)} in (Approximate)`;
        panel.querySelector('[data-scan-quality]').textContent = [suggestion.confidence == null ? 'Confidence not supplied' : `${Math.round(suggestion.confidence * 100)}% provider confidence`, suggestion.quality].filter(Boolean).join(' · ');
        use.textContent = widthInput.value || heightInput.value ? 'Use suggestion — replace entered dimensions' : 'Use approximate suggestion';
      }
    }
    function edit() {
      session.edit(widthInput.value, heightInput.value);
      correction.textContent = 'Your entered measurements are used for this estimate. You can edit them at any time.';
    }
    analyzeButton.addEventListener('click',async()=>{
      const file=[...photosInput.files].find(item=>['image/jpeg','image/png','image/webp'].includes(item.type)&&item.size>0&&item.size<=8*1024*1024);
      if(!file){status.textContent='Choose a JPG, PNG or WebP photo up to 8 MB. Manual tape measurements are always available.';return;}
      analysisController?.abort();analysisController=new AbortController();const analysisGeneration=generation;analyzeButton.disabled=true;visionResult.hidden=true;visionResult.replaceChildren();status.textContent='Analyzing the selected photo securely…';
      try {
        const result=await visionProvider.analyze({file,context:getContext?.()||{},signal:analysisController.signal});
        if(analysisGeneration!==generation)return;
        const title=document.createElement('strong');title.textContent=`Likely project: ${categoryNames[result.category]}`;
        const summary=document.createElement('p');summary.textContent=`Confidence: ${Math.round(result.confidence*100)}%. ${result.reasoning}`;visionResult.append(title,summary);
        if(result.category==='shower_glass') for(const recommendation of result.recommendations){const button=document.createElement('button');button.type='button';button.className='button button-quiet';button.textContent=`Use ${recommendation.configuration} recommendation`;const reason=document.createElement('p');reason.textContent=recommendation.reason;button.addEventListener('click',()=>{onConfigurationSelect(recommendation.configuration);status.textContent=`You selected ${recommendation.configuration}. You can change it before continuing.`;});visionResult.append(button,reason);}
        const note=document.createElement('p');note.textContent='Photo analysis does not measure dimensions. Enter or correct width and height with a tape measure before pricing.';visionResult.append(note);visionResult.hidden=false;status.textContent='Photo analysis complete. Review and confirm or change the recommendation.';
      } catch(error){if(analysisGeneration===generation)status.textContent=error?.message||'Photo analysis is unavailable. Continue with manual configuration and tape measurements.';}
      finally{if(analysisGeneration===generation)analyzeButton.disabled=false;}
    });
    widthInput.addEventListener('input', edit); heightInput.addEventListener('input', edit);
    use.addEventListener('click', () => {
      const state = session.useSuggestion(); if (!state) return;
      widthInput.value = state.width; heightInput.value = state.height;
      widthInput.dispatchEvent(new Event('input',{bubbles:true}));
      heightInput.dispatchEvent(new Event('input',{bubbles:true}));
      // Record the explicit adoption after notifying the existing calculator.
      session.useSuggestion();
      correction.textContent = 'Approximate suggestion applied at your request. Correct either dimension below before continuing.';
      widthInput.focus();
    });
    async function selected() {
      const current = ++generation; session.cancel(); analysisController?.abort(); clearPreview();visionResult.hidden=true;visionResult.replaceChildren();
      const files = [...photosInput.files]; panel.hidden = !files.length; correction.textContent = '';
      if (!files.length) return;
      const photo = files.find(file => ['image/jpeg','image/png','image/webp'].includes(file.type) && file.size > 0 && file.size <= 50*1024*1024);
      if (!photo) {
        render({status:'error'});
        status.textContent = 'Choose a JPG, PNG or WebP photo up to 50 MB for visual measurement. Your tape measurements remain available.';
        return;
      }
      session.edit(widthInput.value, heightInput.value);
      status.textContent='Photo ready. Select Analyze photo to request a project recommendation. Manual configuration and tape measurements remain available.';
      objectUrl = URL.createObjectURL(photo); image.src = objectUrl;
      try { await image.decode(); if (current === generation) preview.hidden = false; } catch { if (current === generation) clearPreview(); }
      if (current !== generation) return;
      analyzeButton.hidden=false;
    }
    photosInput.addEventListener('change', selected);
    const reset = () => { ++generation; session.cancel(); analysisController?.abort(); clearPreview(); panel.hidden = true; };
    window.addEventListener('pagehide', reset);
    return Object.freeze({snapshot:session.snapshot, confirm:session.confirm, reset});
  }
  globalThis.BrunoMeasurement = Object.freeze({unavailableProvider, unavailableMessage, visionUnavailableProvider, createVisionProvider, normalizeSuggestion, inches, createSession, recommend, mount});
})();
