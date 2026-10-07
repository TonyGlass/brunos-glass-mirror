/* Photo analysis keeps preliminary AI estimates distinct from customer confirmation. */
(() => {
  const unavailableProvider = Object.freeze({
    id: 'unavailable', available: false,
    async measure() { return {status: 'unavailable'}; }
  });
  const unavailableMessage = 'Photo analysis is unavailable. Enter dimensions manually or try again later.';
  const configurations = ['Sliding Door','Swing Door + Fixed Panel','90° Corner','Fixed Panel / Walk-In','Tub Enclosure','Not Sure / Let Bruno’s recommend it'];
  const geometries = Object.freeze(['straight_tub_alcove','straight_shower_opening','corner_90','neo_angle','unclear']);
  const geometryNames = Object.freeze({straight_tub_alcove:'Straight bathtub / alcove',straight_shower_opening:'Straight shower opening',corner_90:'90° corner opening',neo_angle:'Neo-angle opening',unclear:'Opening geometry unclear'});
  const compatibleConfigurations = Object.freeze({
    straight_tub_alcove:['Tub Enclosure','Sliding Door','Not Sure / Let Bruno’s recommend it'],
    straight_shower_opening:['Sliding Door','Swing Door + Fixed Panel','Fixed Panel / Walk-In','Not Sure / Let Bruno’s recommend it'],
    corner_90:['90° Corner','Not Sure / Let Bruno’s recommend it'],
    neo_angle:['Not Sure / Let Bruno’s recommend it'],
    unclear:['Not Sure / Let Bruno’s recommend it']
  });
  const recommendationPriority = Object.freeze({
    straight_tub_alcove:['Tub Enclosure','Sliding Door'],
    straight_shower_opening:['Sliding Door','Swing Door + Fixed Panel','Fixed Panel / Walk-In'],
    corner_90:['90° Corner'],neo_angle:[],unclear:[]
  });
  const configurationImages = Object.freeze({
    straight_tub_alcove:Object.freeze({'Tub Enclosure':'images/reference/shower-tub.jpg','Sliding Door':'images/configurations/tub-sliding.svg'}),
    straight_shower_opening:Object.freeze({'Sliding Door':'images/reference/shower-sliding.jpg','Swing Door + Fixed Panel':'images/configurations/shower-swing-fixed.svg','Fixed Panel / Walk-In':'images/reference/shower-walk-in.jpg'}),
    corner_90:Object.freeze({'90° Corner':'images/reference/shower-corner.jpg'})
  });
  const categoryNames = {shower_glass:'Shower Glass',mirror:'Mirror',architectural_glass:'Architectural & Custom Glass',unclear:'Could not identify the project'};
  const visionUnavailableProvider = Object.freeze({id:'server-vision',available:true,async analyze(){throw new Error('Vision analysis is not configured.');}});
  function getConfigurationImage(geometry, configuration, uploadedPhoto = '') {
    return configuration===configurations[5] ? uploadedPhoto : configurationImages[geometry]?.[configuration] || uploadedPhoto;
  }
  function createVisionProvider({endpoint, apiKey, fetchImpl = fetch} = {}) {
    return Object.freeze({id:'server-vision',available:true,async analyze({file,signal}) {
      if (!(file instanceof Blob) || !['image/jpeg','image/png','image/webp'].includes(file.type) || file.size < 1 || file.size > 8*1024*1024) throw new Error('Choose a JPG, PNG or WebP photo no larger than 8 MB.');
      if (!endpoint) throw new Error('Photo analysis is not configured.');
      const dataUrl = await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=()=>reject(new Error('Could not read that photo.'));reader.readAsDataURL(file);});
      const response=await fetchImpl(endpoint,{method:'POST',headers:{'content-type':'application/json',...(apiKey?{apikey:apiKey,authorization:`Bearer ${apiKey}`}:{})},body:JSON.stringify({image:dataUrl}),signal});
      const payload=await response.json().catch(()=>({}));
      if (!response.ok) throw new Error(typeof payload.error==='string'?payload.error:'Photo analysis is temporarily unavailable.');
      if (!categoryNames[payload.category] || !Number.isFinite(payload.confidence) || payload.confidence<0 || payload.confidence>1 || typeof payload.reasoning!=='string' || !geometries.includes(payload.geometry) || !Number.isFinite(payload.geometryConfidence) || typeof payload.geometryReasoning!=='string' || !Array.isArray(payload.recommendations)) throw new Error('Photo analysis returned an invalid response.');
      const confidentGeometry=payload.geometry!=='unclear'&&payload.geometryConfidence>=0.65;
      const geometry=confidentGeometry?payload.geometry:'unclear';
      const allowed=new Set(compatibleConfigurations[geometry]);
      const byConfiguration=new Map(payload.recommendations
        .filter(item=>allowed.has(item.configuration)&&item.configuration!==configurations[5]&&typeof item.reason==='string')
        .map(item=>[item.configuration,item]));
      const recommendations=payload.category==='shower_glass'
        ?recommendationPriority[geometry].map(configuration=>byConfiguration.get(configuration)||{configuration,reason:'Catalog option for the classified opening geometry; Bruno will confirm the layout and clearances.'}).slice(0,3)
        :[];
      if(payload.category==='shower_glass'&&!recommendations.length)recommendations.push({configuration:configurations[5],reason:'The photo does not show enough detail for a compatible layout recommendation. Bruno can review it with you.'});
      const raw=payload.measurement;
      const responsible=Number.isFinite(raw?.widthInches)&&Number.isFinite(raw?.heightInches)&&raw.widthInches>=12&&raw.widthInches<=240&&raw.heightInches>=12&&raw.heightInches<=240&&Number.isFinite(raw.confidence)&&raw.confidence>=.75&&typeof raw.basis==='string'&&raw.basis.trim().length>=12;
      const box=payload.openingBox;
      const openingBox=box&&[box.x,box.y,box.width,box.height].every(n=>Number.isFinite(n)&&n>=0&&n<=1)&&box.width>0&&box.height>0&&box.x+box.width<=1&&box.y+box.height<=1?box:null;
      return {category:payload.category,confidence:payload.confidence,reasoning:payload.reasoning.slice(0,500),geometry,geometryConfidence:payload.geometryConfidence,geometryReasoning:payload.geometryReasoning.slice(0,400),recommendations,openingBox,
        measurement:responsible?{width:Math.round(raw.widthInches),height:Math.round(raw.heightInches),confidence:raw.confidence,basis:raw.basis.slice(0,300),referenceSuggestion:''}:{width:null,height:null,confidence:Number.isFinite(raw?.confidence)?Math.max(0,Math.min(1,raw.confidence)):0,basis:typeof raw?.basis==='string'?raw.basis.slice(0,300):'',referenceSuggestion:typeof raw?.referenceSuggestion==='string'&&raw.referenceSuggestion.trim()?raw.referenceSuggestion.slice(0,240):'Add one straight-on photo with a clearly known-size reference, or provide one known measurement.'}};
    }});
  }
  const previewUnavailableProvider = Object.freeze({
    id:'server-preview',
    available:false,
    async preview(){throw new Error('AI shower preview is not configured.');}
  });

  function createPreviewProvider({endpoint, apiKey, fetchImpl = fetch} = {}) {
    return Object.freeze({
      id:'server-preview',
      available:Boolean(endpoint),
      async preview({file,configuration,geometry,glassType='',hardwareFinish='',handleStyle='',signal}) {
        if (!(file instanceof Blob) ||
            !['image/jpeg','image/png','image/webp'].includes(file.type) ||
            file.size < 1 ||
            file.size > 8*1024*1024) {
          throw new Error('Choose a JPG, PNG or WebP photo no larger than 8 MB.');
        }

        if (!endpoint) {
          throw new Error('AI shower preview is not configured.');
        }

        if (!configurations.includes(configuration) ||
            configuration === configurations[5]) {
          throw new Error('Choose a confirmed shower configuration first.');
        }

        if (!geometries.includes(geometry) ||
            geometry === 'unclear' ||
            !compatibleConfigurations[geometry]?.includes(configuration)) {
          throw new Error('The selected shower configuration is not compatible with this opening.');
        }

        const dataUrl = await new Promise((resolve,reject)=>{
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result);
          reader.onerror = () => reject(new Error('Could not read that photo.'));
          reader.readAsDataURL(file);
        });

        const response = await fetchImpl(endpoint,{
          method:'POST',
          headers:{
            'content-type':'application/json',
            ...(apiKey ? {apikey:apiKey,authorization:`Bearer ${apiKey}`} : {})
          },
          body:JSON.stringify({
            image:dataUrl,
            configuration,
            geometry,
            glassType,
            hardwareFinish,
            handleStyle
          }),
          signal
        });

        const payload = await response.json().catch(()=>({}));

        if (!response.ok) {
          throw new Error(
            typeof payload.error === 'string'
              ? payload.error
              : 'AI shower preview is temporarily unavailable.'
          );
        }

        if (typeof payload.image !== 'string' ||
            !payload.image.startsWith('data:image/') ||
            payload.configuration !== configuration ||
            payload.geometry !== geometry ||
            payload.conceptual !== true) {
          throw new Error('AI shower preview returned an invalid response.');
        }

        return {
          image:payload.image,
          configuration:payload.configuration,
          geometry:payload.geometry,
          conceptual:true
        };
      }
    });
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
  function mount({host, photosInput, widthInput, heightInput, getContext, onConfigurationSelect=()=>{}, visionProvider=visionUnavailableProvider, previewProvider=previewUnavailableProvider, provider = unavailableProvider}) {
    const session = createSession(provider);
    const panel = document.createElement('section');
    panel.className = 'scan-result'; panel.hidden = true;
    panel.setAttribute('aria-label','Photo and approximate measurements');
    panel.innerHTML = `<div class="scan-preview" hidden><img alt="Your selected opening photo — dimensions have not been verified" /><span class="scan-preview-label">PROJECT PHOTO</span></div>
      <div class="scan-result-content"><p class="eyebrow">PHOTO / MEASURE</p><h3>Review your space</h3>
      <p class="scan-result-status" role="status" aria-live="polite"></p>
      <button type="button" class="button button-dark" data-analyze-photo>Analyze photo</button><div data-vision-result hidden></div>
      <div class="ai-photo-preview" data-ai-photo-preview hidden>
        <p class="eyebrow">AI VISUALIZATION — CONCEPTUAL</p>
        <img data-ai-preview-image alt="Conceptual Bruno's shower glass visualization on your project photo" />
        <p class="scan-approximate-note">Conceptual visualization only. Final glass dimensions and installation details require Bruno's professional field measurement.</p>
      </div>
      <p class="ai-estimate-label" data-ai-estimate-label hidden>AI ESTIMATED — PLEASE CONFIRM</p>
      <dl class="scan-dimensions" hidden><div><dt>AI estimated width</dt><dd data-scan-width></dd></div><div><dt>AI estimated height</dt><dd data-scan-height></dd></div><div><dt>Visual confidence</dt><dd data-scan-quality></dd></div></dl>
      <label class="ai-measurement-confirmation" data-ai-confirmation hidden><input type="checkbox" data-confirm-ai-measurement /> I reviewed these AI estimates and confirm or edited the width and height for a preliminary quote.</label>
      <p class="scan-approximate-note">AI dimensions are approximate, not verified. Your confirmation is for preliminary estimating only. Bruno’s professional field measurement is required before fabrication.</p>
      <button type="button" class="button button-dark" data-use-measurement hidden>Use approximate suggestion</button>
      <p class="scan-correction-note" role="status"></p></div>`;
    host.append(panel);
    const status = panel.querySelector('.scan-result-status');
    const analyzeButton=panel.querySelector('[data-analyze-photo]'), visionResult=panel.querySelector('[data-vision-result]');
    const aiPhotoPreview=panel.querySelector('[data-ai-photo-preview]');
    const aiPreviewImage=panel.querySelector('[data-ai-preview-image]');
    const dimensions = panel.querySelector('.scan-dimensions');
    const use = panel.querySelector('[data-use-measurement]');
    const correction = panel.querySelector('.scan-correction-note');
    const preview = panel.querySelector('.scan-preview');
    const image = preview.querySelector('img');
    const aiEstimateLabel=panel.querySelector('[data-ai-estimate-label]');
    const aiConfirmation=panel.querySelector('[data-ai-confirmation]');
    const confirmAi=panel.querySelector('[data-confirm-ai-measurement]');
    const measurementGuide = document.createElement('div');
    measurementGuide.className = 'scan-measure-guide';
    measurementGuide.setAttribute('aria-hidden','true');
    measurementGuide.innerHTML = '<span class="scan-width-guide">WIDTH &middot; measure with tape below</span><span class="scan-height-guide">HEIGHT &middot; measure with tape below</span>';
    preview.append(measurementGuide);
    const renderOpeningBox=(box,measurement)=>{
      measurementGuide.style.right='auto';measurementGuide.style.bottom='auto';
      measurementGuide.style.left=`${(box?.x??.1)*100}%`;measurementGuide.style.top=`${(box?.y??.14)*100}%`;
      measurementGuide.style.width=`${(box?.width??.8)*100}%`;measurementGuide.style.height=`${(box?.height??.72)*100}%`;
      measurementGuide.classList.toggle('has-ai-measurement',Boolean(measurement));
      measurementGuide.querySelector('.scan-width-guide').textContent=measurement?`WIDTH · ${measurement.width} in (AI estimate)`:'WIDTH · opening width';
      measurementGuide.querySelector('.scan-height-guide').textContent=measurement?`HEIGHT · ${measurement.height} in (AI estimate)`:'HEIGHT · opening height';
    };
    const recordMeasurement=(width,height)=>({aiEstimatedWidth:aiEstimate?.width??null,aiEstimatedHeight:aiEstimate?.height??null,
      customerConfirmedWidth:width,customerConfirmedHeight:height,measurementConfidence:aiEstimate?.confidence??null,
      measurementSource:aiEstimate?(aiEdited?'ai_estimated_edited':'ai_estimated_confirmed'):'customer_manual',explicitlyConfirmed:!aiEstimate||confirmAi.checked});
    let objectUrl, generation = 0;
    let analysisController;
    let previewController;
    let aiEstimate=null, aiEdited=false, applyingAI=false;
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
      if(aiEstimate&&!applyingAI){aiEdited=true;confirmAi.checked=false;correction.textContent='You edited the AI estimate. Review both dimensions and confirm them below before submitting.';}
      else if(!aiEstimate)correction.textContent = 'Your entered measurements are used for this estimate. You can edit them at any time.';
    }
    analyzeButton.addEventListener('click',async()=>{
      const file=[...photosInput.files].find(item=>['image/jpeg','image/png','image/webp'].includes(item.type)&&item.size>0&&item.size<=8*1024*1024);
      if(!file){status.textContent='Choose a JPG, PNG or WebP photo up to 8 MB. Manual tape measurements are always available.';return;}
      analysisController?.abort();analysisController=new AbortController();previewController?.abort();aiPhotoPreview.hidden=true;aiPreviewImage.removeAttribute('src');const analysisGeneration=generation;analyzeButton.disabled=true;visionResult.hidden=true;visionResult.replaceChildren();
      if(aiEstimate){widthInput.value='';heightInput.value='';widthInput.dispatchEvent(new Event('input',{bubbles:true}));heightInput.dispatchEvent(new Event('input',{bubbles:true}));aiEstimate=null;aiEdited=false;aiEstimateLabel.hidden=true;aiConfirmation.hidden=true;confirmAi.checked=false;}
      status.textContent='Analyzing the selected photo securely…';
      try {
        const result=await visionProvider.analyze({file,context:getContext?.()||{},signal:analysisController.signal});
        if(analysisGeneration!==generation)return;
        const title=document.createElement('strong');title.textContent=`Likely project: ${categoryNames[result.category]}`;
        const summary=document.createElement('p');summary.textContent=`Confidence: ${Math.round(result.confidence*100)}% (AI estimate). ${result.reasoning}`;visionResult.append(title,summary);
        if(result.category==='shower_glass'){
          const geometrySummary=document.createElement('p');geometrySummary.textContent=`Opening geometry: ${geometryNames[result.geometry]} (${Math.round(result.geometryConfidence*100)}% AI estimate). ${result.geometryReasoning}`;visionResult.append(geometrySummary);
          for(const [index,recommendation] of result.recommendations.entries()){
            const figure=document.createElement('figure');
            figure.className='vision-recommendation';
            const needsReview=recommendation.configuration===configurations[5];

            const example=document.createElement('img');
            example.src=getConfigurationImage(result.geometry,recommendation.configuration,objectUrl);
            example.alt=needsReview
              ? 'Your photo for Bruno to review'
              : `${geometryNames[result.geometry]} — ${recommendation.configuration} reference`;
            example.loading='lazy';

            const caption=document.createElement('figcaption');
            const rank=needsReview
              ? 'Bruno review'
              : index===0
                ? 'Best match'
                : index===1
                  ? 'Alternative'
                  : 'Compatible option';

            caption.textContent=needsReview
              ? 'Not Sure — Let Bruno’s recommend it'
              : `${rank}: ${recommendation.configuration} · ${geometryNames[result.geometry]}`;

            figure.append(example,caption);

            const button=document.createElement('button');
            button.type='button';
            button.className='button button-quiet';
            button.textContent=needsReview
              ? 'Ask Bruno to recommend a layout'
              : `Choose ${recommendation.configuration}`;

            const reason=document.createElement('p');
            reason.textContent=recommendation.reason;

            button.addEventListener('click',()=>{
              onConfigurationSelect(recommendation.configuration);
              status.textContent=`You selected ${recommendation.configuration}. You can change it before continuing.`;
            });

            visionResult.append(figure,reason,button);

            if(!needsReview){
              const previewButton=document.createElement('button');
              previewButton.type='button';
              previewButton.className='button button-dark';
              previewButton.textContent='Preview on My Photo';

              previewButton.addEventListener('click',async()=>{
                const context=getContext?.()||{};
                const glassType=context.glassType||'';
                const hardwareFinish=context.hardwareFinish||'';
                const handleStyle=context.handleStyle||'';

                if(!glassType || glassType==='Other'){
                  status.textContent='Choose an approved shower glass type before generating your preview.';
                  return;
                }

                if(!hardwareFinish || hardwareFinish==='Other'){
                  status.textContent='Choose an approved hardware finish before generating your preview.';
                  return;
                }

                const previewFile=[...photosInput.files].find(item=>
                  ['image/jpeg','image/png','image/webp'].includes(item.type) &&
                  item.size>0 &&
                  item.size<=8*1024*1024
                );

                if(!previewFile){
                  status.textContent='Choose a JPG, PNG or WebP photo up to 8 MB before generating your preview.';
                  return;
                }

                onConfigurationSelect(recommendation.configuration);

                previewController?.abort();
                previewController=new AbortController();
                const previewGeneration=generation;

                previewButton.disabled=true;
                aiPhotoPreview.hidden=true;
                aiPreviewImage.removeAttribute('src');
                status.textContent='Creating your conceptual Bruno’s Glass preview on the original photo…';

                try{
                  const generated=await previewProvider.preview({
                    file:previewFile,
                    configuration:recommendation.configuration,
                    geometry:result.geometry,
                    glassType,
                    hardwareFinish,
                    handleStyle,
                    signal:previewController.signal
                  });

                  if(previewGeneration!==generation)return;

                  aiPreviewImage.src=generated.image;
                  aiPhotoPreview.hidden=false;
                  status.textContent='Conceptual preview ready. Your original room remains unchanged; only the selected shower glass and hardware are visualized.';
                  aiPhotoPreview.scrollIntoView({behavior:'smooth',block:'nearest'});
                }catch(error){
                  if(previewGeneration!==generation)return;
                  if(error?.name==='AbortError')return;
                  status.textContent=error?.message||'AI shower preview is temporarily unavailable.';
                }finally{
                  if(previewGeneration===generation)previewButton.disabled=false;
                }
              });

              visionResult.append(previewButton);
            }
          }
        }
        const measure=result.measurement;
        renderOpeningBox(result.openingBox,measure?.width!=null?measure:null);
        if(measure?.width!=null&&measure?.height!=null){
          aiEstimate={width:measure.width,height:measure.height,confidence:measure.confidence,basis:measure.basis};aiEdited=false;confirmAi.checked=false;
          applyingAI=true;widthInput.value=String(aiEstimate.width);heightInput.value=String(aiEstimate.height);widthInput.dispatchEvent(new Event('input',{bubbles:true}));heightInput.dispatchEvent(new Event('input',{bubbles:true}));applyingAI=false;
          aiEstimateLabel.hidden=false;aiConfirmation.hidden=false;dimensions.hidden=false;
          panel.querySelector('[data-scan-width]').textContent=`${aiEstimate.width} in`;
          panel.querySelector('[data-scan-height]').textContent=`${aiEstimate.height} in`;
          const level=aiEstimate.confidence>=.9?'Higher visual confidence':aiEstimate.confidence>=.82?'Moderate visual confidence':'Limited visual confidence';
          panel.querySelector('[data-scan-quality]').textContent=`${level} · ${Math.round(aiEstimate.confidence*100)}%. ${aiEstimate.basis}`;
          const note=document.createElement('p');note.textContent=`AI ESTIMATED — PLEASE CONFIRM. ${aiEstimate.basis} These dimensions are approximate and for preliminary estimating only.`;visionResult.append(note);
          correction.textContent='Confirm or correct both AI estimated dimensions before submitting your preliminary quote.';
        }else{
          aiEstimate=null;aiEdited=false;aiEstimateLabel.hidden=true;aiConfirmation.hidden=true;confirmAi.checked=false;dimensions.hidden=true;
          const note=document.createElement('p');note.textContent=`The photo does not show a reliable known-size reference, so no dimensions were invented. ${measure?.referenceSuggestion||'Add one straight-on photo with a clearly known-size reference, or provide one known measurement.'}`;visionResult.append(note);
        }
        visionResult.hidden=false;status.textContent='Photo analysis complete. Review the project recommendation and any AI estimated dimensions.';
      } catch(error){if(analysisGeneration===generation)status.textContent=error?.message||'Photo analysis is unavailable. Continue with manual configuration and tape measurements.';}
      finally{if(analysisGeneration===generation)analyzeButton.disabled=false;}
    });
    widthInput.addEventListener('input', edit); heightInput.addEventListener('input', edit);
    confirmAi.addEventListener('change',()=>{if(confirmAi.checked)correction.textContent='AI estimated dimensions confirmed by you for preliminary estimating. Bruno will verify field measurements before fabrication.';});
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
      const current = ++generation; session.cancel(); analysisController?.abort(); previewController?.abort(); aiPhotoPreview.hidden=true;aiPreviewImage.removeAttribute('src');clearPreview();visionResult.hidden=true;visionResult.replaceChildren();
      if(aiEstimate){widthInput.value='';heightInput.value='';widthInput.dispatchEvent(new Event('input',{bubbles:true}));heightInput.dispatchEvent(new Event('input',{bubbles:true}));}
      aiEstimate=null;aiEdited=false;aiEstimateLabel.hidden=true;aiConfirmation.hidden=true;confirmAi.checked=false;dimensions.hidden=true;renderOpeningBox(null,null);
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
    const reset = () => { ++generation; session.cancel(); analysisController?.abort(); clearPreview(); panel.hidden = true;aiEstimate=null;aiEdited=false;aiEstimateLabel.hidden=true;aiConfirmation.hidden=true;confirmAi.checked=false; };
    window.addEventListener('pagehide', reset);
    return Object.freeze({snapshot:session.snapshot, confirm:session.confirm, reset,
      isConfirmed(){return !aiEstimate||confirmAi.checked;},getMeasurementRecord(width,height){return recordMeasurement(width,height);}});
  }
  globalThis.BrunoMeasurement = Object.freeze({unavailableProvider, unavailableMessage, visionUnavailableProvider, createVisionProvider, previewUnavailableProvider, createPreviewProvider, normalizeSuggestion, inches, createSession, recommend, mount, compatibleConfigurations, getConfigurationImage});
})();
