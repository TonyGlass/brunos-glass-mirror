const SUPABASE_URL = globalThis.BRUNO_PUBLIC_CONFIG.supabaseUrl;
const SUPABASE_PUBLISHABLE_KEY = globalThis.BRUNO_PUBLIC_CONFIG.supabasePublishableKey;

const supabaseClient = window.supabase.createClient(
  SUPABASE_URL,
  SUPABASE_PUBLISHABLE_KEY
);
const menuToggle = document.querySelector('.menu-toggle');
const siteNav = document.querySelector('#site-nav');
const quoteForm = document.querySelector('#quote-form');
const photosInput = document.querySelector('#photos');
const photosSelected = document.querySelector('#photos-selected');
const QUOTE_FUNCTION_URL = `${SUPABASE_URL}/functions/v1/submit-quote`;
const MAX_QUOTE_FILES = 5;
const MAX_QUOTE_FILE_SIZE = 50 * 1024 * 1024;
const ALLOWED_QUOTE_FILE_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'video/mp4',
  'video/webm',
  'video/quicktime'
]);
const PRICING_FUNCTION_URL = `${SUPABASE_URL}/functions/v1/pricing`;
let lastEstimateRecord = null;
let estimateRequestVersion = 0;
let estimateTimer;
let customQuoteService = '';
let submittedOrderNumber = '';
let currentEstimatedDeposit = null;
const referralNameByCode = Object.freeze({jeff:'Jeff', tony:'Tony', hamy:'Hamy'});
const referralCandidate = new URLSearchParams(window.location.search).get('ref')?.trim().toLowerCase() || '';
const referralCode = Object.hasOwn(referralNameByCode, referralCandidate) ? referralCandidate : '';
const referralName = referralCode ? referralNameByCode[referralCode] : '';
function currentPricingProject() {
  return {service:serviceSelect.value, glassType:glassTypeSelect.value,
    width:parseConstructionMeasurement(widthInput.value), height:parseConstructionMeasurement(heightInput.value),
    quantity:Number(document.querySelector('#quantity').value), counts:getHardwareCounts(), enduroShield:serviceSelect.value !== "Mirror" && document.querySelector("#enduro-shield").checked,
    mirrorFrame:serviceSelect.value === 'Mirror' && document.querySelector('#mirror-frame')?.value === 'yes'};
}
async function requestEstimatedPrice(project) {
  const response = await fetch(PRICING_FUNCTION_URL, {
    signal:AbortSignal.timeout(15000),
    method:'POST', headers:{'Content-Type':'application/json', apikey:SUPABASE_PUBLISHABLE_KEY,
      Authorization:`Bearer ${SUPABASE_PUBLISHABLE_KEY}`},
    body:JSON.stringify({action:'estimate',project})
  });
  const body = await response.json();
  if (!response.ok) throw Error(body.error || 'Central pricing is unavailable. Please try again.');
  const result = body.estimate;
  if (!result || typeof result.complete !== 'boolean' || !Number.isSafeInteger(result.revision) || result.revision < 0 ||
      (result.complete && (!Number.isFinite(result.low) || !Number.isFinite(result.high) || !Number.isFinite(result.baseLow) || !Number.isFinite(result.baseHigh) || result.low < 0 || result.high < result.low || result.baseLow < 0 || result.baseHigh < result.baseLow))) {
    throw Error('Invalid pricing response. Please try again.');
  }
  return result;
}
const formStatus = document.querySelector('#form-status');
const currentYear = document.querySelector('#current-year');
const quoteReferralNote = document.querySelector('#quote-referral-note');
if (referralCode && quoteReferralNote) {
  quoteReferralNote.textContent = `Referred by ${referralName}`;
  quoteReferralNote.hidden = false;
}

const serviceSelect = document.querySelector('#service');

const productGroup = document.querySelector('#product-group');
const productSelect = document.querySelector('#product');

const glassTypeGroup = document.querySelector('#glass-type-group');
const glassTypeSelect = document.querySelector('#glass-type');

const doorTypeGroup = document.querySelector('#door-type-group');
const doorTypeSelect = document.querySelector('#door-type');

const hardwareGroup = document.querySelector('#hardware-group');
const hardwareFinishSelect = document.querySelector('#hardware-finish');
const handleStyleSelect = document.querySelector('#handle-style');
const glassOtherGroup = document.querySelector('#glass-other-group');
const glassOtherDescription = document.querySelector('#glass-other-description');
const hardwareOtherGroup = document.querySelector('#hardware-other-finish-group');
const hardwareOtherFinish = document.querySelector('#hardware-other-finish');
function isUnpricedGlass() { return glassTypeSelect?.value === 'Other'; }
function isManualReviewQuote() { return Boolean(customQuoteService || isUnpricedGlass()); }
function updateCustomOptionFields() {
  const otherGlass = isUnpricedGlass();
  if (glassOtherGroup) glassOtherGroup.hidden = !otherGlass;
  if (glassOtherDescription) glassOtherDescription.required = otherGlass;
  const otherHardware = hardwareFinishSelect?.value === 'Other';
  if (hardwareOtherGroup) hardwareOtherGroup.hidden = !otherHardware;
  if (hardwareOtherFinish) hardwareOtherFinish.required = otherHardware;
}
const projectReferenceImage = document.querySelector('[data-project-reference-image]');
const projectReferenceTitle = document.querySelector('[data-project-reference-title]');
const projectReferenceCaption = document.querySelector('[data-project-reference-caption]');
const projectReferenceByService = {
  'Shower Doors': {src:'images/work-04.jpeg', title:'Shower enclosure', alt:"Bruno's frameless shower enclosure with navy tile and brass hardware"},
  Mirror: {src:'images/inspiration/WhatsApp Image 2026-09-11 at 5.43.05 PM.jpeg', title:'Custom mirror', alt:'Bruno project photo of a large illuminated custom bathroom mirror'},
  Glass: {src:'images/reference/glass-partitions.jpg', title:'Architectural glass', alt:'Reference image of architectural glass partitions'},
  'Glass Door': {src:'images/reference/glass-doors.jpg', title:'Glass doors', alt:'Reference image of interior glass doors'},
  'Glass Railings & Balcony Systems': {src:'images/reference/glass-railings.jpg', title:'Glass railings & balcony systems', alt:'Reference image of glass stair railings'},
  'Commercial Interior Glazing / Glass Partitions': {src:'images/reference/glass-partitions.jpg', title:'Commercial interior glazing', alt:'Reference image of glass office partitions'},
  'Wine Room Enclosures': {src:'images/reference/glass-wine-room.jpg', title:'Wine room enclosure', alt:'Reference image of a glass wine room enclosure'},
  'Glass Floors': {src:'images/reference/glass-partitions.jpg', title:'Architectural glass inquiry', alt:'Architectural glass reference; this photo does not depict a glass floor'},
  'Back Painted Glass': {src:'images/work-02.jpeg', title:'Back painted glass enquiry', alt:'Context photo of architectural interior glass; finish is not identified'},
  'Textured & Decorative Glass': {src:'images/work-02.jpeg', title:'Textured & decorative glass enquiry', alt:'Context photo of architectural interior glass; finish is not identified'},
  'Smart Glass / Privacy Glass': {src:'images/work-02.jpeg', title:'Smart & privacy glass enquiry', alt:'Context photo of architectural interior glass; privacy-glass function is not identified'},
  'Custom Fabrication & Finishes': {src:'images/work-02.jpeg', title:'Custom fabrication & finishes', alt:'Context photo of architectural interior glass; product finish is not identified'}
};
function updateProjectReference() {
  if (!projectReferenceImage || !projectReferenceTitle || !projectReferenceCaption) return;
  const service = customQuoteService || serviceSelect?.value || '';
  const referenceFigure = document.querySelector('#quote-visual-reference');
  if (referenceFigure) referenceFigure.hidden = !service;
  const model = !customQuoteService && service === 'Shower Doors'
    ? products.find((item) => item.name === productSelect?.value)
    : null;
  const reference = model
    ? {src:model.image,title:model.name,alt:model.imageAlt,configuration:true,source:model.source}
    : projectReferenceByService[service];
  if (!reference) {
    if (customQuoteService) {
      const fallback = projectReferenceByService['Custom Fabrication & Finishes'];
      projectReferenceImage.src = fallback.src;
      projectReferenceImage.alt = fallback.alt;
      projectReferenceTitle.textContent = customQuoteService;
      projectReferenceCaption.textContent = 'Context photo only; it may not depict this specialty product. Ask Bruno to confirm the service and glass specification.';
      return;
    }
    projectReferenceTitle.textContent = 'Bruno\'s project references';
    projectReferenceCaption.textContent = 'Choose a project; this image will update. Project photos are contextual and may not show your selected glass specification.';
    return;
  }
  projectReferenceImage.src = reference.src;
  projectReferenceImage.alt = reference.alt;
  projectReferenceTitle.textContent = reference.title;
  const material = customQuoteService || !glassTypeSelect?.value ? '' : glassTypeSelect.selectedOptions?.[0]?.textContent?.trim();
  projectReferenceCaption.textContent = reference.configuration
    ? `${reference.source}. Configuration reference only; it does not identify the glass material${material ? ` (selected: ${material})` : ''}.`
    : material
    ? `Project reference only. Selected glass: ${material}. This photograph is not a material sample; confirm appearance with Bruno.`
    : reference.src.includes('/magazine/') || reference.src.includes('tmpa6tg0twq')
      ? 'Magazine reference only. Ask Bruno to confirm the project details and glass specification.'
      : customQuoteService && reference.src === 'images/work-02.jpeg'
        ? `Context photo only; it may not depict ${customQuoteService}. Ask Bruno to confirm the service and glass specification.`
      : 'Bruno project reference. This is not a material sample; confirm the selected specification and appearance with Bruno.';
}

function renderChoiceCards(select, choiceList) {
  if (!select || !choiceList) {
    return;
  }

  choiceList.replaceChildren();

  Array.from(select.options)
    .filter((option) => option.value)
    .forEach((option) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'choice-card option-card';
      button.dataset.value = option.value;
      button.setAttribute('aria-pressed', String(select.value === option.value));

      const title = document.createElement('span');
      title.className = 'choice-card-title';
      title.textContent = option.textContent.trim();
      button.appendChild(title);

      // Presentation only: retain the option value and existing change event.
      if (select.id === 'product') {
        const model = products.find((item) => item.name === option.value);
        const image = document.createElement('img');
        image.className = 'model-card-image';
        image.src = model?.image || 'images/reference/shower-not-sure.jpg';
        image.alt = model?.imageAlt || 'Neutral shower configuration diagram';
        image.loading = 'lazy';
        button.prepend(image);
        button.classList.add('model-card');
        const description = document.createElement('span');
        description.className = 'choice-card-description';
        description.textContent = model?.description || 'Choose glass material separately in the next step.';
        const caption = document.createElement('span');
        caption.className = 'model-card-caption';
        caption.textContent = 'Configuration example \u00b7 glass appearance may vary';
        button.append(description, caption);
      }
      const indicator = document.createElement('span');
      indicator.className = 'selection-indicator';
      indicator.setAttribute('aria-hidden', 'true');
      indicator.textContent = '\u2713';
      button.append(indicator);

      button.addEventListener('click', () => {
        select.value = option.value;
        select.dispatchEvent(new Event('change', { bubbles: true }));
      });

      choiceList.appendChild(button);
    });

  choiceList.hidden = choiceList.children.length === 0;
}

function syncChoiceCards(select) {
  const choiceList = document.querySelector(
    `[data-choice-list-for="${select.id}"]`
  );

  if (!choiceList) {
    return;
  }

  choiceList.querySelectorAll('.choice-card').forEach((button) => {
    const isSelected = button.dataset.value === select.value;
    button.classList.toggle('is-selected', isSelected);
    button.setAttribute('aria-pressed', String(isSelected));
  });
}

[
  productSelect,
  doorTypeSelect,
  glassTypeSelect,
  hardwareFinishSelect,
  handleStyleSelect
].forEach((select) => {
  if (!select) {
    return;
  }

  const choiceList = document.querySelector(
    `[data-choice-list-for="${select.id}"]`
  );

  renderChoiceCards(select, choiceList);
  select.addEventListener('change', () => syncChoiceCards(select));

  new MutationObserver(() => {
    renderChoiceCards(select, choiceList);
    syncChoiceCards(select);
  }).observe(select, { childList: true });
});

document.querySelectorAll('[data-select="service"]').forEach((button) => {
  button.addEventListener('click', () => {
    serviceSelect.value = button.dataset.value;
    serviceSelect.dispatchEvent(new Event('change', { bubbles: true }));
  });
});

function syncServiceCards() {
  document.querySelectorAll('[data-select="service"]').forEach((button) => {
    const isSelected = button.dataset.value === serviceSelect.value;
    button.classList.toggle('is-selected', isSelected);
    button.setAttribute('aria-pressed', String(isSelected));
  });
}

serviceSelect?.addEventListener('change', syncServiceCards);

function getChoiceList(select) {
  return document.querySelector(
    `[data-choice-list-for="${select.id}"]`
  );
}

function getFieldLabel(field) {
  const label = document.querySelector(`label[for="${field.id}"]`)
    || field.closest('.conditional-field')?.querySelector('label');

  return label?.textContent.trim() || field.name || 'this field';
}

function clearFieldError(field) {
  field.classList.remove('field-error');
  getChoiceList(field)?.classList.remove('choice-list-error');
}

function validateQuoteForm() {
  const invalidMeasurement = [widthInput, heightInput].find((field) => {
    const measurement = parseConstructionMeasurement(field.value);
    return !Number.isFinite(measurement) || measurement <= 0;
  });
  if (invalidMeasurement) {
    invalidMeasurement.classList.add('field-error');
    formStatus.classList.add('form-status-error');
    formStatus.textContent = 'Enter a valid width and height in inches. Use whole inches or fractions with a denominator of 4, 8, or 16.';
    invalidMeasurement.focus();
    return false;
  }

  if (window.QuoteMeasurement && !window.QuoteMeasurement.isConfirmed()) {
    const confirmation=document.querySelector('[data-confirm-ai-measurement]');
    formStatus.classList.add('form-status-error');
    formStatus.textContent='Review and confirm the AI estimated width and height before submitting.';
    confirmation?.focus();
    confirmation?.scrollIntoView({behavior:'smooth',block:'center'});
    return false;
  }

  const requiredFields = Array.from(quoteForm.querySelectorAll('[required]'));
  const invalidField = requiredFields.find((field) => !field.checkValidity());

  requiredFields.forEach(clearFieldError);

  if (!invalidField) {
    formStatus.classList.remove('form-status-error');
    return true;
  }

  const choiceList = getChoiceList(invalidField);
  invalidField.classList.add('field-error');
  choiceList?.classList.add('choice-list-error');
  formStatus.classList.add('form-status-error');
  formStatus.textContent = `Please complete the required field: ${getFieldLabel(invalidField)}.`;

  const focusTarget = choiceList?.querySelector('.choice-card') || invalidField;
  focusTarget.focus({ preventScroll: true });
  focusTarget.scrollIntoView({ behavior: 'smooth', block: 'center' });
  return false;
}

quoteForm?.querySelectorAll('[required]').forEach((field) => {
  field.addEventListener('input', () => clearFieldError(field));
  field.addEventListener('change', () => clearFieldError(field));
});

function updatePhotoSummary() {
  if (!photosInput || !photosSelected) {
    return;
  }

  const files = Array.from(photosInput.files || []);
  const scanStatus = document.querySelector('.scan-photo-status');
  if (scanStatus) scanStatus.textContent = files.length
    ? `${files.length} file(s) selected. Photo analysis may suggest approximate dimensions when a reliable size reference is visible.`
    : '';

  if (!files.length) {
    photosSelected.textContent = '';
    photosSelected.hidden = true;
    return;
  }

  const fileLabel = files.length === 1 ? 'file selected' : 'files selected';
  photosSelected.textContent = `${files.length} ${fileLabel}: ${files.map((file) => file.name).join(', ')}`;
  photosSelected.hidden = false;
}

photosInput?.addEventListener('change', updatePhotoSummary);


// =====================================================
// PRODUCTS
// =====================================================

const products = [
  {name:'Sliding Door',service:'Shower Doors',doorType:'Sliding Door',image:'images/reference/shower-sliding.jpg',imageAlt:'Sliding shower enclosure with overlapping sliding glass panels',description:'Smooth sliding glass enclosure. Choose glass material separately.',source:'Supplied reference board',images:['images/reference/shower-sliding.jpg']},
  {name:'Swing Door + Fixed Panel',service:'Shower Doors',doorType:'Swing Door + Fixed Panel',image:'images/reference/shower-swing-fixed.jpg',imageAlt:'Hinged shower door beside a fixed glass panel',description:'Hinged door with adjoining fixed glass. Choose glass material separately.',source:'Supplied reference board',images:['images/reference/shower-swing-fixed.jpg']},
  {name:'90° Corner',service:'Shower Doors',doorType:'90° Corner',image:'images/reference/shower-corner.jpg',imageAlt:'Glass shower enclosure meeting at a corner',description:'Corner glass enclosure. Choose glass material separately.',source:'Supplied reference board',images:['images/reference/shower-corner.jpg']},
  {name:'Fixed Panel / Walk-In',service:'Shower Doors',doorType:'Fixed Panel / Walk-In',image:'images/reference/shower-walk-in.jpg',imageAlt:'Fixed shower glass with an open walk-in entry',description:'Fixed glass with an open walk-in entry. Choose glass material separately.',source:'Supplied reference board',images:['images/reference/shower-walk-in.jpg']},
  {name:'Tub Enclosure',service:'Shower Doors',doorType:'Tub Enclosure',image:'images/reference/shower-tub.jpg',imageAlt:'Glass enclosure fitted over a bathtub',description:'Glass enclosure for a bathtub. Choose glass material separately.',source:'Supplied reference board',images:['images/reference/shower-tub.jpg']},
  {name:'Not Sure / Let Bruno’s recommend it',service:'Shower Doors',doorType:'Not Sure / Let Bruno’s recommend it',image:'images/reference/shower-not-sure.jpg',imageAlt:'Frameless shower enclosure reference for configuration review',description:'Let Bruno’s recommend the best configuration. Choose glass material separately.',source:'Supplied reference board',images:['images/reference/shower-not-sure.jpg']}
];

// =====================================================
// PRODUCT GALLERY
// =====================================================

const galleryMainImage =
  document.querySelector('#gallery-main-image');

const galleryMainButton =
  document.querySelector('#gallery-main-button');

const galleryThumbnails =
  document.querySelector('#gallery-thumbnails');

const galleryProductName =
  document.querySelector('#gallery-product-name');

const galleryLightbox =
  document.querySelector('#gallery-lightbox');

const galleryLightboxImage =
  document.querySelector('#gallery-lightbox-image');

const galleryLightboxClose =
  document.querySelector('#gallery-lightbox-close');

// =====================================================
// GALLERY LIGHTBOX / ZOOM
// =====================================================

if (
  galleryMainButton &&
  galleryLightbox &&
  galleryLightboxImage &&
  galleryLightboxClose
) {

  // Open large image
  galleryMainButton.addEventListener('click', () => {

    galleryLightboxImage.src =
      galleryMainImage.src;

    galleryLightboxImage.alt =
      galleryMainImage.alt;

    galleryLightbox.hidden = false;
    galleryLightbox.setAttribute(
      'aria-hidden',
      'false'
    );

    document.body.style.overflow = 'hidden';

  });


  // Close with X
  galleryLightboxClose.addEventListener('click', () => {

    galleryLightbox.hidden = true;
    galleryLightbox.setAttribute(
      'aria-hidden',
      'true'
    );

    document.body.style.overflow = '';

  });


  // Close by clicking outside image
  galleryLightbox.addEventListener('click', (event) => {

    if (event.target === galleryLightbox) {

      galleryLightbox.hidden = true;

      galleryLightbox.setAttribute(
        'aria-hidden',
        'true'
      );

      document.body.style.overflow = '';

    }

  });


  // Close with Escape key
  document.addEventListener('keydown', (event) => {

    if (
      event.key === 'Escape' &&
      !galleryLightbox.hidden
    ) {

      galleryLightbox.hidden = true;

      galleryLightbox.setAttribute(
        'aria-hidden',
        'true'
      );

      document.body.style.overflow = '';

    }

  });

}

// =====================================================
// INSPIRATION GALLERY
// =====================================================

const inspirationImages = [
  { file: 'tmp1x18qlnt.webp', category: 'Custom Glass', alt: 'Black framed glass enclosure with clear panels' },
  { file: 'tmp8ogawz09.webp', category: 'Custom Mirrors', alt: 'Multi-panel bathroom mirror installation above a vanity' },
  { file: 'tmpa6tg0twq.webp', category: 'Custom Mirrors', alt: 'Mirrored ceiling installation reflecting a bathroom interior' },
  { file: 'tmpalrn5bjl.webp', category: 'Custom Mirrors', alt: 'Commercial mirrored bar and display shelving' },
  { file: 'tmpef8fn6l5.webp', category: 'Shower Enclosures', alt: 'Glass shower enclosure beside a freestanding bathtub' },
  { file: 'tmprm_1dilf.webp', category: 'Shower Enclosures', alt: 'Three glass shower enclosure installations' },
  { file: 'tmpt1njs01e.webp', category: 'Custom Mirrors', alt: 'Illuminated bathroom vanity mirrors' },
  { file: 'WhatsApp Image 2026-08-15 at 12.33.52 PM.jpeg', category: 'Custom Mirrors', alt: 'Bathroom vanity with a large framed mirror' },
  { file: 'WhatsApp Image 2026-08-18 at 12.17.55 PM.jpeg', category: 'Shower Enclosures', alt: 'Glass shower enclosure with dark framing and water view' },
  { file: 'WhatsApp Image 2026-08-18 at 2.48.12 PM.jpeg', category: 'Shower Enclosures', alt: 'Clear shower enclosure with gold hardware in a marble bathroom' },
  { file: 'WhatsApp Image 2026-09-11 at 2.21.31 PM.jpeg', category: 'Custom Mirrors', alt: 'Bathroom vanity with illuminated framed mirrors' },
  { file: 'WhatsApp Image 2026-09-11 at 5.43.05 PM.jpeg', category: 'Custom Mirrors', alt: 'Illuminated custom bathroom mirror above a vanity' },
  { file: 'WhatsApp Image 2026-09-11 at 5.43.06 PM (3).jpeg', category: 'Shower Enclosures', alt: 'Glass shower enclosure with gold hardware and stone walls' },
  { file: 'WhatsApp Image 2026-09-11 at 5.43.06 PM.jpeg', category: 'Shower Enclosures', alt: 'Frameless glass shower enclosure with a stone interior' },
  { file: 'WhatsApp Image 2026-09-11 at 5.43.07 PM (5).jpeg', category: 'Custom Mirrors', alt: 'Large mirror reflecting a bathroom interior' },
  { file: 'WhatsApp Image 2026-09-11 at 5.43.07 PM.jpeg', category: 'Shower Enclosures', alt: 'Large custom glass shower enclosure with open entry' },
  { file: 'WhatsApp Image 2026-09-11 at 5.43.08 PM (1).jpeg', category: 'Commercial', alt: 'Glass display enclosure over a bar cabinet' },
  { file: 'WhatsApp Image 2026-09-11 at 5.43.08 PM (5).jpeg', category: 'Commercial', alt: 'Large glass display enclosure in a finished interior' },
  { file: 'WhatsApp Image 2026-09-11 at 5.43.08 PM.jpeg', category: 'Commercial', alt: 'Glass display installation with shelving and cabinetry' },
  { file: 'WhatsApp Image 2026-09-11 at 5.43.09 PM (1).jpeg', category: 'Custom Mirrors', alt: 'Large wall mirror reflecting an arched bathroom interior' },
  { file: 'WhatsApp Image 2026-09-11 at 5.48.41 PM.jpeg', category: 'Shower Enclosures', alt: 'Clear glass shower enclosure with a tiled interior' },
  { file: 'WhatsApp Image 2026-09-14 at 1.18.42 PM.jpeg', category: 'Custom Mirrors', alt: 'Large bathroom mirror above a stone vanity' },
  { file: 'WhatsApp Image 2026-09-14 at 3.48.36 PM.jpeg', category: 'Shower Enclosures', alt: 'Frameless glass shower enclosure in a tiled bathroom' }
];

const inspirationGrid = document.querySelector('#inspiration-grid');
const inspirationLightbox = document.querySelector('#inspiration-lightbox');
const inspirationLightboxImage = document.querySelector('#inspiration-lightbox-image');
const inspirationLightboxCaption = document.querySelector('#inspiration-lightbox-caption');
const inspirationLightboxClose = document.querySelector('#inspiration-lightbox-close');
const inspirationLightboxPrevious = document.querySelector('#inspiration-lightbox-prev');
const inspirationLightboxNext = document.querySelector('#inspiration-lightbox-next');
let inspirationVisibleImages = inspirationImages;
let inspirationLightboxIndex = 0;

function inspirationImageUrl(file) {
  return `images/inspiration/${encodeURIComponent(file).replaceAll('%2F', '/')}`;
}

function renderInspirationGallery(category = 'All') {
  if (!inspirationGrid) {
    return;
  }

  inspirationVisibleImages = category === 'All'
    ? inspirationImages
    : inspirationImages.filter((image) => image.category === category);

  inspirationGrid.innerHTML = inspirationVisibleImages.map((image, index) => `
    <button class="inspiration-card" type="button" data-inspiration-index="${index}" aria-label="Open ${image.alt}">
      <img src="${inspirationImageUrl(image.file)}" alt="${image.alt}" loading="${index < 6 ? 'eager' : 'lazy'}" />
      <span class="inspiration-card-caption">${image.category}</span>
    </button>
  `).join('');

  inspirationGrid.querySelectorAll('[data-inspiration-index]').forEach((card) => {
    card.addEventListener('click', () => openInspirationLightbox(Number(card.dataset.inspirationIndex)));
  });
}

function openInspirationLightbox(index) {
  inspirationLightboxIndex = index;
  const image = inspirationVisibleImages[inspirationLightboxIndex];
  if (!image || !inspirationLightbox) {
    return;
  }

  inspirationLightboxImage.src = inspirationImageUrl(image.file);
  inspirationLightboxImage.alt = image.alt;
  inspirationLightboxCaption.textContent = `${image.category} / ${image.alt}`;
  inspirationLightbox.hidden = false;
  document.body.style.overflow = 'hidden';
  inspirationLightboxClose.focus();
}

function closeInspirationLightbox() {
  inspirationLightbox.hidden = true;
  document.body.style.overflow = '';
}

function moveInspirationLightbox(direction) {
  const total = inspirationVisibleImages.length;
  inspirationLightboxIndex = (inspirationLightboxIndex + direction + total) % total;
  openInspirationLightbox(inspirationLightboxIndex);
}

if (inspirationGrid && inspirationLightbox) {
  renderInspirationGallery();

  document.querySelectorAll('[data-gallery-filter]').forEach((filter) => {
    filter.addEventListener('click', () => {
      document.querySelectorAll('[data-gallery-filter]').forEach((button) => {
        const isActive = button === filter;
        button.classList.toggle('is-active', isActive);
        button.setAttribute('aria-pressed', String(isActive));
      });
      renderInspirationGallery(filter.dataset.galleryFilter);
    });
  });

  inspirationLightboxClose.addEventListener('click', closeInspirationLightbox);
  inspirationLightboxPrevious.addEventListener('click', () => moveInspirationLightbox(-1));
  inspirationLightboxNext.addEventListener('click', () => moveInspirationLightbox(1));
  inspirationLightbox.addEventListener('click', (event) => {
    if (event.target === inspirationLightbox) {
      closeInspirationLightbox();
    }
  });
  document.addEventListener('keydown', (event) => {
    if (inspirationLightbox.hidden) {
      return;
    }
    if (event.key === 'Escape') closeInspirationLightbox();
    if (event.key === 'ArrowLeft') moveInspirationLightbox(-1);
    if (event.key === 'ArrowRight') moveInspirationLightbox(1);
  });
}

function updateProductGallery(product) {

  if (!product || !product.images || !galleryMainImage) {
    return;
  }

  galleryMainImage.src = product.images[0];
  galleryMainImage.alt = product.name;

  galleryProductName.textContent = product.name;

  galleryThumbnails.innerHTML = '';

  product.images.forEach((image, index) => {

    const button = document.createElement('button');

    button.type = 'button';

    button.className =
      index === 0
        ? 'gallery-thumb active'
        : 'gallery-thumb';

    button.innerHTML = `
      <img
        src="${image}"
        alt="${product.name} photo ${index + 1}"
      />
    `;

    button.addEventListener('click', () => {

      galleryMainImage.src = image;
      galleryMainImage.alt = product.name;

      galleryThumbnails
        .querySelectorAll('.gallery-thumb')
        .forEach((thumb) => {
          thumb.classList.remove('active');
        });

      button.classList.add('active');

    });

    galleryThumbnails.appendChild(button);

  });

}
// =====================================================
// GLASS OPTIONS
// =====================================================

const APPROVED_GLASS_OPTIONS = [
  ['Clear Glass - 3/8','3/8" Clear Glass'],['Low-Iron Glass - 3/8','3/8" Low Iron Glass'],
  ['Reeded / Moru - 3/8','3/8" Reeded Glass'],['Satin Acid-Etched - 3/8','3/8" Acid Etched Glass'],
  ['Satin Acid-Etched Low-Iron - 3/8','3/8" Low Iron Acid Etched Glass'],
  ['Other','Other — Bruno to review']
];
const APPROVED_MIRROR_OPTIONS = [
  ['Clear Mirror - 1/4','1/4" Clear Mirror'],['Low-Iron Mirror - 1/4','1/4" Low Iron Mirror'],
  ['Bronze Mirror - 1/4','1/4" Bronze Mirror'],['Gray Mirror - 1/4','1/4" Grey Mirror']
];
const glassTypes = {
  'Shower Doors': APPROVED_GLASS_OPTIONS,
  Glass: APPROVED_GLASS_OPTIONS,
  Mirror: APPROVED_MIRROR_OPTIONS
};


// =====================================================
// DOOR TYPES
// =====================================================

const doorTypes = {
  "Shower Doors": [
    "Shower Enclosure",
    "Sliding Shower Door"
  ]
};


// =====================================================
// SERVICE CHANGE
// =====================================================

if (
  serviceSelect &&
  productGroup &&
  productSelect &&
  glassTypeGroup &&
  glassTypeSelect &&
  doorTypeGroup &&
  doorTypeSelect &&
  hardwareGroup
) {

  serviceSelect.addEventListener('change', () => {

    const selectedService =
  serviceSelect.options[serviceSelect.selectedIndex]?.text.trim() || '';


    // -------------------------------------------------
    // RESET PRODUCT
    // -------------------------------------------------

    productSelect.innerHTML =
      '<option value="">Select a product</option>';

    productSelect.value = "";


    // -------------------------------------------------
    // LOAD PRODUCTS
    // Only Frameless Shower Doors has products for now
    // -------------------------------------------------

    const matchingProducts = products.filter(
      (product) => product.service === selectedService
    );


    matchingProducts.forEach((product) => {

      const option = document.createElement('option');

      option.value = product.name;
      option.textContent = product.name;

      productSelect.appendChild(option);

    });


    if (matchingProducts.length > 0) {

      productGroup.hidden = false;
      productSelect.required = true;

    } else {

      productGroup.hidden = true;
      productSelect.required = false;
      productSelect.value = "";

    }


    // -------------------------------------------------
    // RESET GLASS TYPE
    // -------------------------------------------------

    glassTypeSelect.innerHTML =
      '<option value="">Select glass type</option>';

    glassTypeSelect.value = "";


    // -------------------------------------------------
    // RESET DOOR TYPE
    // -------------------------------------------------

    doorTypeSelect.innerHTML =
      '<option value="">Select an option</option>';

    doorTypeSelect.value = "";


    // -------------------------------------------------
    // LOAD GLASS OPTIONS
    // -------------------------------------------------

    const types = glassTypes[selectedService] || [];

    types.forEach(([value,label]) => {

      const option = document.createElement('option');

      option.value = value;
      option.textContent = label;

      glassTypeSelect.appendChild(option);

    });


    if (types.length > 0) {

      glassTypeGroup.hidden = false;
      glassTypeSelect.required = true;

    } else {

      glassTypeGroup.hidden = true;
      glassTypeSelect.required = false;

    }


    // -------------------------------------------------
    // LOAD DOOR TYPES
    // -------------------------------------------------

    const doors = doorTypes[selectedService] || [];

    doors.forEach((door) => {

      const option = document.createElement('option');

      option.value = door;
      option.textContent = door;

      doorTypeSelect.appendChild(option);

    });


    doorTypeGroup.hidden = true;
    doorTypeSelect.required = false;


    // -------------------------------------------------
    // HARDWARE
    // Only for Frameless Shower Doors
    // -------------------------------------------------

    hardwareGroup.hidden = true;
    hardwareFinishSelect.required = false;
    hardwareFinishSelect.value = '';
    hardwareOtherFinish.value = '';
    handleStyleSelect.required = false;
    updateCustomOptionFields();
    document.querySelector('#enduro-shield-group').hidden = selectedService === 'Mirror';
    if (selectedService === 'Mirror') document.querySelector('#enduro-shield').checked = false;
    const mirrorFrameGroup = document.querySelector('#mirror-frame-group');
    const mirrorFrameSelect = document.querySelector('#mirror-frame');
    if (mirrorFrameGroup) mirrorFrameGroup.hidden = selectedService !== 'Mirror';
    if (mirrorFrameSelect) mirrorFrameSelect.value = 'no';

  });


  // ===================================================
  // PRODUCT CHANGE
  // ===================================================

  productSelect.addEventListener('change', () => {

  const selectedProduct = productSelect.value;

  const product = products.find(
    (item) => item.name === selectedProduct
  );

  if (!product) {
    return;
  }

  const hardwareForShower = serviceSelect.value === 'Shower Doors';
  hardwareGroup.hidden = !hardwareForShower;
  hardwareFinishSelect.required = hardwareForShower;
  updateCustomOptionFields();

  // Store the physical layout separately for quote records.
  doorTypeSelect.innerHTML = '<option value="">Select an option</option>';
  const layout = document.createElement('option');
  layout.value = product.doorType;
  layout.textContent = product.doorType;
  doorTypeSelect.appendChild(layout);
  doorTypeSelect.value = product.doorType;

  // Update product gallery
  updateProductGallery(product);
  updateProjectReference();

});

}

serviceSelect?.addEventListener('change', updateProjectReference);
glassTypeSelect?.addEventListener('change', updateProjectReference);
doorTypeSelect?.addEventListener('change', updateProjectReference);
updateProjectReference();


// =====================================================
// SQUARE FEET CALCULATOR
// =====================================================

const widthInput = document.querySelector('#width');
const heightInput = document.querySelector('#height');
const squareFeetResult = document.querySelector('#square-feet-result');
const estimatedPriceValue = document.querySelector('#estimated-price-value');


function calculateSquareFeet() {
  const width = parseConstructionMeasurement(widthInput.value);
  const height = parseConstructionMeasurement(heightInput.value);


  if (width > 0 && height > 0) {

    const squareFeet = (width * height) / 144;

    squareFeetResult.innerHTML =
      `Square Feet: <strong>${squareFeet.toFixed(2)}</strong>`;

  } else {

    squareFeetResult.innerHTML =
      'Square Feet: <strong>0.00</strong>';

  }

}

function parseConstructionMeasurement(value) {
  const normalizedValue = String(value || '').trim();

  if (!normalizedValue) {
    return NaN;
  }

  const parts = normalizedValue.split(/\s+/);
  const hasStandaloneFraction = parts.length === 1 && parts[0].includes('/');
  const fractionText = hasStandaloneFraction ? parts[0] : parts[1];
  if (fractionText && !/^\d+\/\d+$/.test(fractionText)) return NaN;
  if (!hasStandaloneFraction && parts.length === 2 && !/^\d+$/.test(parts[0])) return NaN;
  const whole = hasStandaloneFraction ? 0 : Number(parts[0]);
  const fraction = (hasStandaloneFraction ? parts[0] : parts[1])?.split('/');

  if (!Number.isFinite(whole) || (!fraction && parts.length !== 1)) {
    return NaN;
  }

  if (parts.length === 1 && !hasStandaloneFraction) {
    return whole;
  }

  const numerator = Number(fraction[0]);
  const denominator = Number(fraction[1]);

  if (
    (!hasStandaloneFraction && parts.length !== 2) ||
    !Number.isFinite(numerator) ||
    !Number.isFinite(denominator) ||
    denominator <= 0 ||
    ![4, 8, 16].includes(denominator) ||
    numerator <= 0 || numerator >= denominator
  ) {
    return NaN;
  }

  if (whole < 0 || (hasStandaloneFraction && parts.length !== 1)) return NaN;
  return whole + (numerator / denominator);
}

// Public diagnostics include selections and estimate status, never private pricing costs.
function diagnoseQuoteEstimate() {
  const project = currentPricingProject();
  const current = lastEstimateRecord?.signature === JSON.stringify(project) ? lastEstimateRecord.result : null;
  return {origin:location.origin, source:'central', service:project.service, model:productSelect.value,
    material:project.glassType, thickness:project.glassType.match(/ - (\d+\/\d+)$/)?.[1] || null,
    width:Number.isFinite(project.width) ? project.width : null, height:Number.isFinite(project.height) ? project.height : null,
    squareFeet:Number.isFinite(project.width*project.height) ? project.width*project.height/144 : null,
    quantity:project.quantity, estimate:current,
    diagnostic:current?.complete ? 'Complete' : 'Check authenticated Admin cost settings for private missing-cost diagnostics.'};
}

function updateEstimatedPrice() {
  const requestVersion = ++estimateRequestVersion;
  clearTimeout(estimateTimer);
  lastEstimateRecord = null;
  if (!estimatedPriceValue) {
    return;
  }
  if (customQuoteService) {
    renderEstimateDisplays(null, 'Custom quote — Bruno will prepare an estimate after reviewing your project.');
    return;
  }

  if (isUnpricedGlass()) {
    renderEstimateDisplays(null, 'Custom glass selected — Bruno will review the requested specification. No automatic price is available.');
    return;
  }

  const width = parseConstructionMeasurement(widthInput.value);
  const height = parseConstructionMeasurement(heightInput.value);
  const quantity = Number(document.querySelector('#quantity').value);
  const projectFields = [
    serviceSelect,
    productSelect,
    doorTypeSelect,
    glassTypeSelect,
    hardwareFinishSelect,
    handleStyleSelect
  ];
  const missingRequiredProjectField = projectFields.some(
    (field) => field.required && !field.value
  );

  if (
    !serviceSelect.value ||
    missingRequiredProjectField ||
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    width <= 0 ||
    height <= 0 ||
    !Number.isFinite(quantity) ||
    quantity <= 0
  ) {
    renderEstimateDisplays(null, 'Complete your project details to see an estimate.');
    return;
  }

  const project = currentPricingProject();
  const signature = JSON.stringify(project);
  lastEstimateRecord = null;
  renderEstimateDisplays(null, 'Checking current project pricing...');
  estimateTimer = setTimeout(async () => {
    try {
      const result = await requestEstimatedPrice(project);
      if (requestVersion !== estimateRequestVersion) return;
      lastEstimateRecord = {signature, result};
      renderEstimateDisplays(result, 'Estimate unavailable: required pricing is not fully configured. You can still request a quote.');
    } catch (error) {
      if (requestVersion !== estimateRequestVersion) return;
      renderEstimateDisplays(null, 'Central pricing is temporarily unavailable. Please try again.');
    }
  }, 180);
}

function syncReviewEstimate() {
  const panel = document.querySelector('#estimated-price-panel');
  const summary = document.querySelector('.quote-review-estimate');
  if (!panel || !summary) return;
  for (const [key, selector] of Object.entries({
    range:'[data-estimate-price]',
    base:'[data-estimate-base]',
    deposit:'[data-estimate-deposit]'
  })) {
    const target = summary.querySelector(`[data-review-estimate="${key}"]`);
    const source = panel.querySelector(selector);
    if (target && source) target.textContent = source.textContent.trim();
  }
}

// Both visible locations receive the same result from the existing engine.
function renderEstimateDisplays(estimate, pendingMessage = '') {
  const complete = Boolean(estimate?.complete);
  const currency = new Intl.NumberFormat('en-US', {
    style: 'currency', currency: 'USD', maximumFractionDigits: 2
  });
  const manualReview = isManualReviewQuote();
  const baseEstimate = complete
    ? estimate.baseLow === estimate.baseHigh
      ? currency.format(estimate.baseLow)
      : `${currency.format(estimate.baseLow)} \u2013 ${currency.format(estimate.baseHigh)}`
    : manualReview ? 'Unavailable until Bruno reviews this custom request.' : 'Base estimate appears when central pricing is available.';
  const price = manualReview
    ? isUnpricedGlass() ? 'Custom glass \u2014 Bruno to review. No automatic estimate.' : 'Custom quote \u2014 estimate prepared after review.'
    : complete
    ? estimate.low === estimate.high ? currency.format(estimate.low) : `${currency.format(estimate.low)} \u2013 ${currency.format(estimate.high)}`
    : pendingMessage;
  const deposit = manualReview
    ? 'Confirmed with your reviewed quote.'
    : complete
    ? currency.format((estimate.baseLow ?? estimate.low) * 0.50)
    : 'Available when an estimate can be calculated.';
  document.querySelectorAll('[data-estimate-breakdown]').forEach(breakdown => {
    const parts = estimate?.breakdown;
    const isMirror = serviceSelect.value === 'Mirror' && !customQuoteService;
    const showBreakdown = complete && parts && (isMirror || parts.enduroShield > 0);
    breakdown.hidden = !showBreakdown;
    breakdown.textContent = showBreakdown
      ? `${isMirror ? 'Mirror' : 'Glass'}: ${currency.format(parts.material)}${parts.enduroShield > 0 ? ` · EnduroShield: ${currency.format(parts.enduroShield)}` : ''}${isMirror ? ` · Metal / Frame: ${currency.format(parts.frame)}` : ''}`
      : '';
  });
  document.querySelectorAll('[data-estimate-price]').forEach(node => {
    const changed = node.textContent !== price;
    node.textContent = price;
    if (complete && changed && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      node.animate([{opacity: .45, transform: 'translateY(5px)'}, {opacity: 1, transform: 'translateY(0)'}], {duration: 220, easing: 'ease-out'});
    }
    node.classList.toggle('has-price', complete);
    node.classList.toggle('estimate-pending', !complete);
  });
  document.querySelectorAll('[data-estimate-deposit]').forEach(node => {
    node.textContent = deposit;
    node.classList.toggle('has-price', complete);
  });
  const depositNumber=complete?(estimate.baseLow??estimate.low)*0.5:null;
  currentEstimatedDeposit=depositNumber;
  const ctaAmount=depositNumber==null?'Estimate needed':new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',maximumFractionDigits:2,minimumFractionDigits:0}).format(depositNumber);
  document.querySelectorAll('[data-deposit-cta-amount]').forEach(node=>{node.textContent=ctaAmount;});
  updateDepositContactLinks(depositNumber);
  document.querySelectorAll('[data-estimate-base]').forEach(node => {
    node.textContent = `Base estimate: ${baseEstimate}`;
    node.classList.toggle('has-price', complete);
  });
  syncReviewEstimate();
}

function updateDepositContactLinks(depositNumber=currentEstimatedDeposit) {
  const estimateAvailable=Number.isFinite(depositNumber)&&depositNumber>=0;
  const order=submittedOrderNumber;
  const name=document.querySelector('#name')?.value.trim()||'Not provided';
  const projectType=customQuoteService||serviceSelect.value||'Not selected';
  const estimateRange=document.querySelector('[data-estimate-price]')?.textContent.trim()||'Unavailable';
  const depositText=estimateAvailable?new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',maximumFractionDigits:2,minimumFractionDigits:0}).format(depositNumber):'Unavailable until a priced estimate is available';
  let href='#submit-quote-request';
  if(order&&estimateAvailable){
    const subject=`Bruno\u2019s Instant Quote \u2014 Deposit Follow-up \u2014 ${order}`;
    const body=[
      'Hello Bruno\u2019s Glass,',
      '',
      'I submitted a quote request and would like to discuss the estimated 50% deposit and next steps.',
      `Customer name: ${name}`,
      `Order Number: ${order}`,
      `Project type: ${projectType}`,
      `Estimated range: ${estimateRange}`,
      `Estimated 50% deposit: ${depositText}`,
      '',
      'Please contact me about the deposit and next steps. No payment has been made through the website.'
    ].join('\n');
    href=`mailto:office@brunosglass.com?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  }
  document.querySelectorAll('[data-deposit-contact]').forEach(link=>{
    link.href=href;
    const successAction=link.classList.contains('confirmation-deposit-cta');
    link.hidden=successAction&&!(order&&estimateAvailable);
    link.setAttribute('aria-disabled',String(!(order&&estimateAvailable)));
  });
  const successNote=document.querySelector('[data-deposit-success-note]');
  if(successNote)successNote.hidden=!(order&&estimateAvailable);
}

function getHardwareCounts() {
  return {
    splitLites: Math.max(0, Number(document.querySelector('#split-lite-count')?.value || 0)),
    hinges: Math.max(0, Number(document.querySelector('#hinge-count')?.value || 0)),
    handles: Math.max(0, Number(document.querySelector('#handle-count')?.value || 0)),
    clips: Math.max(0, Number(document.querySelector('#clip-count')?.value || 0)),
    sweeps: Math.max(0, Number(document.querySelector('#sweep-count')?.value || 0)),
    channels: Math.max(0, Number(document.querySelector('#channel-count')?.value || 0)),
    accessories: Math.max(0, Number(document.querySelector('#accessory-count')?.value || 0))
  };
}

[
  serviceSelect,
  productSelect,
  doorTypeSelect,
  glassTypeSelect,
  document.querySelector('#mirror-frame'),
  hardwareFinishSelect,
  handleStyleSelect,
  document.querySelector('#quantity'),
  widthInput,
  heightInput
].forEach((field) => {
  field?.addEventListener(
    field === widthInput || field === heightInput ? 'input' : 'change',
    updateEstimatedPrice
  );
});
document.querySelectorAll('[data-deposit-contact]').forEach(link=>link.addEventListener('click',event=>{
  if(link.href.startsWith('mailto:office@brunosglass.com?')&&submittedOrderNumber&&currentEstimatedDeposit!=null)return;
  event.preventDefault();
  const followup=document.querySelector('[data-deposit-followup]');
  if(followup){
    followup.textContent=currentEstimatedDeposit==null
      ?'Submit your quote request first. Bruno will review it and confirm any deposit in the Final Quote; no estimated deposit or Order Number is available yet.'
      :'Submit your quote request first. Bruno will issue your Order Number after submission; then this button can open a pre-addressed deposit follow-up email.';
    followup.hidden=false;
  }
  document.querySelector('#submit-quote-request')?.focus({preventScroll:true});
}));


if (widthInput && heightInput && squareFeetResult) {

  widthInput.addEventListener(
    'input',
    calculateSquareFeet
  );

  heightInput.addEventListener(
    'input',
    calculateSquareFeet
  );

}


// =====================================================
// CURRENT YEAR
// =====================================================

if (currentYear) {

  currentYear.textContent =
    new Date().getFullYear();

}


// =====================================================
// MOBILE MENU
// =====================================================

if (menuToggle && siteNav) {

  menuToggle.addEventListener('click', () => {

    const isOpen =
      menuToggle.getAttribute('aria-expanded') === 'true';

    menuToggle.setAttribute(
      'aria-expanded',
      String(!isOpen)
    );

    siteNav.classList.toggle(
      'is-open',
      !isOpen
    );

  });


  siteNav.querySelectorAll('a').forEach((link) => {

    link.addEventListener('click', () => {

      menuToggle.setAttribute(
        'aria-expanded',
        'false'
      );

      siteNav.classList.remove(
        'is-open'
      );

    });

  });

}


// =====================================================
// QUOTE FORM
// =====================================================

if (quoteForm && formStatus) {
  quoteForm.addEventListener('submit', async (event) => {
    event.preventDefault();

    if (!validateQuoteForm()) {
      return;
    }

    const submitButton = quoteForm.querySelector('button[type="submit"]');
    const selectedFiles = Array.from(photosInput?.files || []);

    if (selectedFiles.length > MAX_QUOTE_FILES) {
      formStatus.textContent = 'Please select no more than 5 files.';
      return;
    }

    const invalidFile = selectedFiles.find(
      (file) =>
        !ALLOWED_QUOTE_FILE_TYPES.has(file.type) ||
        file.size > MAX_QUOTE_FILE_SIZE
    );

    if (invalidFile) {
      formStatus.textContent =
        `${invalidFile.name} must be a JPEG, PNG, WebP, MP4, WebM, or MOV file no larger than 50 MB.`;
      return;
    }

    const width = parseConstructionMeasurement(widthInput.value) || null;
    const height = parseConstructionMeasurement(heightInput.value) || null;

    const squareFeet =
      width && height ? Number(((width * height) / 144).toFixed(2)) : null;
const pricingProject = currentPricingProject();
const signature = JSON.stringify(pricingProject);
const customGlassRequest = isUnpricedGlass();
const customQuote = Boolean(customQuoteService || customGlassRequest);
const previousEstimate = lastEstimateRecord?.signature === signature ? lastEstimateRecord.result : null;
clearTimeout(estimateTimer);
++estimateRequestVersion;
let estimatedPrice;
if (submitButton.disabled) return;
submitButton.disabled = true;
formStatus.textContent = 'Checking current pricing before submission...';
try {
  estimatedPrice = customQuote ? {complete:false,revision:null} : await requestEstimatedPrice(pricingProject);
  if (JSON.stringify(currentPricingProject()) !== signature || !validateQuoteForm()) {
    throw Error('Project details changed. Review your configuration and submit again.');
  }
  if (!customQuote) lastEstimateRecord = {signature,result:estimatedPrice};
  renderEstimateDisplays(estimatedPrice, 'Estimate unavailable: required pricing is not fully configured. You can still request a quote.');
  if (!customQuote && ((!previousEstimate && estimatedPrice.complete) ||
      (previousEstimate && JSON.stringify(previousEstimate) !== JSON.stringify(estimatedPrice)))) {
    throw Error('Current pricing is shown above. Please review it and select REQUEST A QUOTE again.');
  }
} catch (error) {
  formStatus.textContent = error.message;
  submitButton.disabled = false;
  return;
}
const completeEstimate = estimatedPrice?.complete ? estimatedPrice : null;
const hardwareCounts = getHardwareCounts();
const hardwareSummary = Object.entries(hardwareCounts)
  .filter(([, count]) => count > 0)
  .map(([item, count]) => `${item}: ${count}`)
  .join(', ');
const projectMessage = document.querySelector('#project').value.trim();
const measurementRecord = window.QuoteMeasurement?.getMeasurementRecord(width,height);
    const quoteData = {
  name: document.querySelector('#name').value.trim(),
  phone: document.querySelector('#phone').value.trim(),
  email: document.querySelector('#email').value.trim(),
  city: document.querySelector('#city').value,
  installation_address: document.querySelector('#installation-address')?.value.trim() || null,

  service: serviceSelect.value,
  product: customQuoteService || productSelect.value || (customGlassRequest ? 'Custom Glass — Bruno review' : null),
  door_type: doorTypeSelect.value || null,
  glass_type: customQuote ? 'Custom quote — no automatic pricing' : glassTypeSelect.value || null,
  hardware_finish: hardwareFinishSelect.value || null,
  handle_style: handleStyleSelect.value || null,

  quantity:
    parseInt(document.querySelector('#quantity').value, 10) || 1,

  width: width,
  height: height,
  ai_estimated_width:measurementRecord?.aiEstimatedWidth ?? null,
  ai_estimated_height:measurementRecord?.aiEstimatedHeight ?? null,
  customer_confirmed_width:measurementRecord?.customerConfirmedWidth ?? width,
  customer_confirmed_height:measurementRecord?.customerConfirmedHeight ?? height,
  measurement_confidence:measurementRecord?.measurementConfidence ?? null,
  measurement_source:measurementRecord?.measurementSource || 'customer_manual',
  square_feet:
  width > 0 && height > 0
    ? (width * height) / 144
    : null,

  message: [projectMessage, serviceSelect.value === 'Mirror' && document.querySelector('#mirror-layout')?.value ? `Mirror placement: ${document.querySelector('#mirror-layout').value}` : '', customQuoteService ? `Requested custom service: ${customQuoteService}` : '', customGlassRequest ? `Requested glass: ${glassOtherDescription.value.trim()}` : '', hardwareFinishSelect.value === 'Other' ? `Requested hardware finish: ${hardwareOtherFinish.value.trim()}` : '', referralCode ? `Referral code: ${referralCode}` : '', pricingProject.enduroShield ? 'EnduroShield: selected' : '', pricingProject.mirrorFrame ? `Metal / Frame: Yes (${new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(estimatedPrice?.breakdown?.frame || 0)})` : '', hardwareSummary ? `Hardware quantities: ${hardwareSummary}` : ''].filter(Boolean).join('\n\n'),

  estimated_price: completeEstimate
  ? completeEstimate.low
  : null,

estimated_price_low: completeEstimate
  ? completeEstimate.low
  : null,

estimated_price_high: completeEstimate
  ? completeEstimate.high
  : null,

final_price: null,

  status: 'New'
};

    formStatus.textContent = 'Sending your quote request...';

    if (submitButton) {
      submitButton.disabled = true;
    }

    let acceptedOrder = null;
    try {
      const functionHeaders = {
        'Content-Type': 'application/json',
        apikey: SUPABASE_PUBLISHABLE_KEY,
        Authorization: `Bearer ${SUPABASE_PUBLISHABLE_KEY}`
      };

      const createResponse = await fetch(QUOTE_FUNCTION_URL, {
        method: 'POST',
        headers: functionHeaders,
        body: JSON.stringify({
          action: 'create',
          quote: quoteData,
          pricing: customQuote ? {customQuote:true} : {revision:estimatedPrice.revision, counts:pricingProject.counts, enduroShield:pricingProject.enduroShield, mirrorFrame:pricingProject.mirrorFrame},
          files: selectedFiles.map((file) => ({
            name: file.name,
            size: file.size,
            type: file.type
          }))
        })
      });

      const createResult = await createResponse.json();

      if (!createResponse.ok) {
        if (createResponse.status === 409 && createResult.estimate) {
          lastEstimateRecord = {signature,result:createResult.estimate};
          renderEstimateDisplays(createResult.estimate, 'Estimate unavailable pending pricing review.');
        }
        throw new Error(createResult.error || 'Could not create the quote.');
      }
      acceptedOrder = createResult;
      if (createResult.uploadPreparationError) throw new Error(createResult.uploadPreparationError);

      for (const [index, upload] of createResult.uploads.entries()) {
        const file = selectedFiles[index];
        const { error: uploadError } = await supabaseClient.storage
          .from('quote-photos')
          .uploadToSignedUrl(upload.path, upload.token, file);

        if (uploadError) {
          throw uploadError;
        }
      }

      const finalizeResponse = await fetch(QUOTE_FUNCTION_URL, {
        method: 'POST',
        headers: functionHeaders,
        body: JSON.stringify({
          action: 'finalize',
          finalizeToken: createResult.finalizeToken
        })
      });

      const finalizeResult = await finalizeResponse.json();

      if (!finalizeResponse.ok) {
        throw new Error(finalizeResult.error || 'Could not save uploaded files.');
      }

      formStatus.textContent =
        'Thank you! Your quote request has been sent successfully.';
      renderRequestTracking(createResult);
      showRequestConfirmation();

      // Keep the submitted configuration and estimate available for review and diagnostics.
      // Clear only attachments that have already been uploaded successfully.
      photosInput.value = '';
      window.QuoteMeasurement?.reset();
      updatePhotoSummary();
      updateEstimatedPrice();

} catch (error) {
  console.error('Quote submission error:', error);
  if (acceptedOrder) {
    renderRequestTracking(acceptedOrder);
    const processingNote = document.querySelector('#request-processing-note');
    processingNote.hidden = false;
    processingNote.textContent = 'Your request was received, but photo processing did not finish. Keep any tracking details shown here and contact Bruno before submitting again.';
    showRequestConfirmation();
  } else {
    formStatus.textContent = `Sorry, we could not send your request. ${error.message || 'Please try again.'}`;
  }
} finally {
      if (submitButton) {
        submitButton.disabled = false;
      }
    }
  });
}

function scrollToQuoteContent(element) {
  element.scrollIntoView({behavior:window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block:'start'});
}
function renderRequestTracking(result) {
  const order = typeof result?.trackingNumber === 'string' ? result.trackingNumber.trim() : '';
  const code = typeof result?.accessCode === 'string' ? result.accessCode.trim() : '';
  submittedOrderNumber=order;
  const available = Boolean(order && code);
  document.querySelector('.tracking-credentials').hidden = !available;
  document.querySelector('#request-order-number').textContent = available ? order : '';
  document.querySelector('#request-tracking-access-code').textContent = available ? code : '';
  const notice = document.querySelector('#request-tracking-notice');
  notice.hidden = available;
  notice.textContent = available ? '' : 'Your request was received, but complete tracking details were not returned. Contact Bruno’s Glass & Mirror for help; do not submit the same request again.';
  const tracking = document.querySelector('#tracking-form');
  tracking.elements.orderNumber.value = available ? order : '';
  tracking.elements.accessCode.value = available ? code : '';
  updateDepositContactLinks();
  const processingNote = document.querySelector('#request-processing-note');
  processingNote.hidden = true; processingNote.textContent = '';
}
function showRequestConfirmation() {
  const confirmation = document.querySelector('#request-confirmation');
  if (!confirmation) return;
  quoteForm.hidden = true;
  confirmation.hidden = false;
  const credentialCard = document.querySelector('#tracking-credentials-card');
  const hasCredentials = !credentialCard.hidden;
  const focusTarget = hasCredentials ? document.querySelector('#tracking-credentials-title') : document.querySelector('#request-confirmation-title');
  if (hasCredentials) {
    credentialCard.classList.remove('is-entering');
    credentialCard.querySelectorAll('.credential-value').forEach(value => value.classList.remove('is-emphasized'));
    credentialCard.querySelector('.credential-track')?.classList.remove('is-attention');
    void credentialCard.offsetWidth;
    credentialCard.classList.add('is-entering');
    credentialCard.querySelectorAll('.credential-value').forEach(value => value.classList.add('is-emphasized'));
    credentialCard.querySelector('.credential-track')?.classList.add('is-attention');
    document.querySelector('#credential-copy-status').textContent = '';
  }
  focusTarget.focus({preventScroll:true});
  scrollToQuoteContent(hasCredentials ? credentialCard : confirmation);
}

async function copyCredentialText(text, button) {
  const status = document.querySelector('#credential-copy-status');
  let copied = false;
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      copied = true;
    } else if (document.execCommand) {
      const field = document.createElement('textarea');
      field.value = text;
      field.setAttribute('readonly', '');
      field.style.position = 'fixed';
      field.style.opacity = '0';
      document.body.append(field);
      field.select();
      copied = document.execCommand('copy');
      field.remove();
    }
  } catch {
    copied = false;
  }
  if (!copied) {
    status.textContent = 'Copy was unavailable. Select and copy the details above.';
    return;
  }
  const originalLabel = button.dataset.copyLabel || button.textContent;
  button.dataset.copyLabel = originalLabel;
  button.textContent = 'COPIED ✓';
  button.classList.add('is-copied');
  window.setTimeout(() => {
    button.textContent = originalLabel;
    button.classList.remove('is-copied');
  }, 1800);
}

document.querySelectorAll('[data-copy-credential]').forEach(button => button.addEventListener('click', () => {
  const id = button.dataset.copyCredential === 'order' ? '#request-order-number' : '#request-tracking-access-code';
  copyCredentialText(document.querySelector(id).textContent, button);
}));
document.querySelector('[data-copy-both]')?.addEventListener('click', event => {
  const order = document.querySelector('#request-order-number').textContent;
  const code = document.querySelector('#request-tracking-access-code').textContent;
  copyCredentialText(`Bruno's Glass & Mirror\nOrder Number: ${order}\nPrivate Access Code: ${code}`, event.currentTarget);
});
document.querySelector('[data-review-request]')?.addEventListener('click', () => {
  document.querySelector('#request-confirmation').hidden = true;
  quoteForm.hidden = false;
  submittedOrderNumber='';
  updateDepositContactLinks();
  const heading = quoteForm.querySelector('.wizard-step-panel:not([hidden]) .wizard-panel-heading');
  heading?.focus({preventScroll:true});
  scrollToQuoteContent(quoteForm);
});
document.querySelectorAll('[data-start-project]').forEach(link => link.addEventListener('click', event => {
  event.preventDefault();
  document.querySelector('#request-confirmation').hidden = true;
  quoteForm.hidden = false;
  submittedOrderNumber='';
  updateDepositContactLinks();
  const heading = quoteForm.querySelector('[data-wizard-step="1"] .wizard-panel-heading');
  heading?.focus({preventScroll:true});
  scrollToQuoteContent(quoteForm);
}));

const contactToggle = document.querySelector('.floating-contact');
const contactPopover = document.querySelector('#contact');
contactToggle?.addEventListener('click', () => {
  const isOpen = contactToggle.getAttribute('aria-expanded') === 'true';
  contactToggle.setAttribute('aria-expanded', String(!isOpen));
  contactPopover.hidden = isOpen;
});

function setupQuoteWizard() {
  if (!quoteForm) return;
  const original = [...quoteForm.querySelectorAll(':scope > .form-section')];
  if (original.length !== 4) return;

  const standardLabels = ['Project Type', 'Scan / Measure Space', 'Shower Configuration', 'Glass & Hardware Options', 'Live Estimate', 'Customer Information', 'Review & Submit'];
  const customLabels = ['Project Type', 'Measurements', 'Your Information', 'Review Request'];
  const standardPanelIndexes = [0,1,2,3,4,5,6];
  const customPanelIndexes = [0,1,5,6];
  const standardDescriptions = [
    'Choose a shower, mirror, or custom glass project to begin.',
    'Take or upload photos, or enter dimensions measured with a tape.',
    'Choose the physical layout that best fits your shower opening.',
    'Choose glass and applicable hardware separately from the layout.',
    'Review your preliminary estimate. Bruno confirms the Final Quote after field measurement.',
    'Tell us how Bruno can reach you about the project.',
    'Review your details and send the request for professional review.'
  ];
  let labels = standardLabels;
  let panelIndexes = standardPanelIndexes;
  const panels = [original[0], document.createElement('div'), document.createElement('div'), document.createElement('div'), document.createElement('div'), original[1], original[2]];
  panels.forEach((panel, index) => {
    panel.classList.add('wizard-step-panel');
    panel.dataset.wizardStep = String(index + 1);
    panel.querySelector('.form-step')?.remove();
    const heading = document.createElement('div');
    heading.className = 'wizard-panel-heading';
    heading.innerHTML = `<span>STEP 0${index + 1}</span><h2>${labels[index]}</h2>`;
    heading.tabIndex = -1;
    const description = document.createElement('p');
    description.className = 'wizard-description';
    description.textContent = standardDescriptions[index];
    heading.append(description);
    panel.prepend(heading);
  });

  const move = (selector, panelIndex) => {
    const node = quoteForm.querySelector(selector);
    if (node) panels[panelIndex].append(node);
  };
  move('.service-picker', 0);
  ['.measurement-panel', '#square-feet-result'].forEach((selector) => move(selector, 1));
  ['#product-group', '#door-type-group'].forEach((selector) => move(selector, 2));
  ['#glass-type-group', '#hardware-group', '#enduro-shield-group', '#mirror-frame-group'].forEach((selector) => move(selector, 3));
  move('.upload-field', 1);
  const uploadHelp = original[2].querySelector('.form-help');
  if (uploadHelp) panels[1].append(uploadHelp);
  const scanChoices = document.createElement('section');
  scanChoices.className = 'scan-measure-choices';
  scanChoices.setAttribute('aria-label', 'Measurement method');
  scanChoices.innerHTML = `<p class="measurement-title">Add a photo or enter dimensions</p><div class="scan-measure-actions"><button type="button" class="scan-measure-card" data-scan-camera aria-pressed="false"><span aria-hidden="true">▧</span><strong>Take or Upload a Photo</strong><small>Ask Bruno’s photo analyzer for a project recommendation.</small></button><button type="button" class="scan-measure-card" data-scan-upload aria-pressed="true"><span aria-hidden="true">＋</span><strong>Enter Measurements Manually</strong><small>Measure width and height with a tape. Edit either value before pricing.</small></button></div><p class="scan-ai-notice">AI dimensions are approximate and require your confirmation. If the photo lacks a reliable size reference, add one straight-on photo with a known-size reference or provide one known measurement. Professional field measurement is required before fabrication.</p><p class="scan-photo-status" role="status" aria-live="polite"></p>`;
  panels[1].prepend(scanChoices);
  const scanCamera = scanChoices.querySelector('[data-scan-camera]');
  const scanUpload = scanChoices.querySelector('[data-scan-upload]');
  const scanStatus = scanChoices.querySelector('.scan-photo-status');
  function setMeasureMode(mode) {
    scanCamera.setAttribute('aria-pressed', String(mode === 'camera'));
    scanUpload.setAttribute('aria-pressed', String(mode === 'manual'));
    document.body.dataset.measurementMode = mode;
  }
  scanCamera.addEventListener('click', () => {
    setMeasureMode('camera');
    if (scanStatus) scanStatus.textContent = 'Choose one or more opening photos. Confirm or replace the dimensions below with a tape measure before viewing a price.';
    photosInput?.setAttribute('capture', 'environment');
    photosInput?.click();
    window.setTimeout(() => photosInput?.removeAttribute('capture'), 0);
  });
  scanUpload.addEventListener('click', () => {
    setMeasureMode('manual');
    photosInput?.removeAttribute('capture');
    widthInput?.focus({preventScroll:true});
  });
  window.QuoteMeasurement = window.BrunoMeasurement.mount({host:scanChoices, photosInput, widthInput, heightInput,
    getContext:() => ({
      projectType:customQuoteService || serviceSelect.value,
      manualWidth:widthInput.value,
      manualHeight:heightInput.value,
      glassType:glassTypeSelect.value,
      hardwareFinish:hardwareFinishSelect.value,
      handleStyle:handleStyleSelect.value
    }),
    visionProvider:window.BrunoMeasurement.createVisionProvider({endpoint:`${SUPABASE_URL}/functions/v1/analyze-photo`,apiKey:SUPABASE_PUBLISHABLE_KEY}),
    previewProvider:window.BrunoMeasurement.createPreviewProvider({endpoint:`${SUPABASE_URL}/functions/v1/preview-shower`,apiKey:SUPABASE_PUBLISHABLE_KEY}),
    onConfigurationSelect:name=>{if(products.some(item=>item.name===name)){productSelect.value=name;productSelect.dispatchEvent(new Event('change',{bubbles:true}));}},
    provider:window.BrunoMeasurementProvider || window.BrunoMeasurement.unavailableProvider});
  const geometry = document.createElement('fieldset');
  geometry.className = 'opening-details';
  geometry.innerHTML = `<legend>Help us suggest a shower layout <span>(optional)</span></legend><label>Where is the enclosure?<select id="opening-placement"><option value="">Not sure</option><option value="shower">Shower</option><option value="tub">Over a bathtub</option></select></label><label>Opening shape<select id="opening-geometry"><option value="">Not sure</option><option value="straight">Straight opening</option><option value="corner">90° corner</option></select></label><p>Suggestions use only your selections here. Photos have not been analyzed for layout or clearance.</p>`;
  panels[1].append(geometry);
  const recommendations = document.createElement('p'); recommendations.className = 'configuration-recommendation'; recommendations.hidden = true;
  panels[2].append(recommendations);
  function updateRecommendation() {
    const results = window.BrunoMeasurement.recommend({projectType:customQuoteService || serviceSelect.value,
      placement:geometry.querySelector('#opening-placement').value, openingGeometry:geometry.querySelector('#opening-geometry').value,
      measurements:{width:widthInput.value,height:heightInput.value}, photoAnalysis:null, availableClearance:null});
    recommendations.hidden = !results.length;
    recommendations.textContent = results.length ? `Recommended for your space: ${results[0].configuration}. ${results[0].reason} You can choose any layout or ask Bruno to recommend one.` : '';
    panels[2].querySelectorAll('[data-choice-list-for="product"] button').forEach(button => {
      button.classList.toggle('is-recommended', results.some(result => result.configuration === button.dataset.value));
      button.querySelector('.recommendation-badge')?.remove();
      if (button.classList.contains('is-recommended')) { const badge = document.createElement('span'); badge.className = 'recommendation-badge'; badge.textContent = 'Recommended for your space'; button.append(badge); }
    });
  }
  geometry.addEventListener('change', updateRecommendation);
  serviceSelect.addEventListener('change', () => { geometry.querySelectorAll('select').forEach(select => { select.value = ''; }); window.QuoteMeasurement.reset(); });
  const mirrorConfiguration = document.createElement('section');
  mirrorConfiguration.className = 'mirror-configuration';
  mirrorConfiguration.hidden = true;
  mirrorConfiguration.setAttribute('aria-label', 'Mirror project configuration');
  mirrorConfiguration.innerHTML = `<p class="measurement-title">Mirror configuration</p><p>Choose a placement; Bruno will confirm the design and field dimensions. Mirror materials, thickness, and Metal / Frame are selected separately.</p><figure><img src="images/reference/mirror-custom.jpg" alt="Custom bathroom mirrors above a vanity" loading="lazy"><figcaption>Mirror project reference only. This is not a material sample.</figcaption></figure><label for="mirror-layout">Mirror placement</label><select id="mirror-layout"><option value="">Choose a placement (optional)</option><option>Vanity / Bathroom Mirror</option><option>Wall Mirror</option><option>Decorative / Custom Mirror</option><option>Not Sure / Let Bruno’s recommend it</option></select></section>`;
  panels[2].prepend(mirrorConfiguration);
  const mirrorLayout = mirrorConfiguration.querySelector('#mirror-layout');
  const estimatePanel = document.querySelector('#estimated-price-panel');
  panels[4].append(estimatePanel);
  original[3].querySelector('.submit-request-heading')?.remove();
  panels[6].append(original[3]);
  const review = document.createElement('section');
  review.className = 'quote-review-summary';
  review.setAttribute('aria-label', 'Your request summary');
  panels[6].querySelector('.wizard-panel-heading').after(review);
  function updateReview() {
    review.replaceChildren();
    const title = document.createElement('h3');
    title.textContent = 'Your project at a glance';
    const details = document.createElement('dl');
    const value = id => document.getElementById(id)?.value.trim() || 'Not provided';
    const rows = [
      ['Project', customQuoteService || serviceSelect.value],
      ['Configuration', customQuoteService ? 'Confirmed after review' : serviceSelect.value === 'Mirror' ? mirrorLayout.value || 'Confirm with Bruno' : productSelect.value || 'Custom glass'],
      ['Measurements (approximate)', `${widthInput.value} × ${heightInput.value} in`],
      ['Quantity', value('quantity')],
      ...(!customQuoteService ? [['Material', glassTypeSelect.selectedOptions[0]?.textContent.trim()],
        ['Options', serviceSelect.value === 'Mirror' ? document.querySelector('#mirror-frame').selectedOptions[0].textContent : document.querySelector('#enduro-shield').checked ? 'EnduroShield' : 'Standard hardware included']] : []),
      ['Customer', value('name')], ['Phone', value('phone')], ['Email', value('email')],
      ['Project address', value('installation-address')], ['City', value('city')],
      ['Attachments', [...photosInput.files].map(file => file.name).join(', ') || 'None selected']
    ];
    for (const [label, content] of rows) {
      const term = document.createElement('dt'); term.textContent = label;
      const detail = document.createElement('dd'); detail.textContent = content;
      details.append(term, detail);
    }
    const estimateSummary = document.createElement('section');
    estimateSummary.className = 'quote-review-estimate';
    estimateSummary.setAttribute('aria-label', 'Estimate summary');
    const estimateHeading = document.createElement('h4');
    estimateHeading.textContent = 'Estimate summary';
    const estimateDetails = document.createElement('dl');
    for (const [key, label] of [['range','Estimated range'],['base','Base estimate'],['deposit','Estimated 50% deposit']]) {
      const term = document.createElement('dt'); term.textContent = label;
      const detail = document.createElement('dd'); detail.dataset.reviewEstimate = key;
      estimateDetails.append(term, detail);
    }
    estimateSummary.append(estimateHeading, estimateDetails);
    review.append(title, details, estimateSummary);
    syncReviewEstimate();
  }
  const modelNote = document.createElement('p');
  modelNote.className = 'model-service-note';
  modelNote.textContent = 'Your project is custom-made. Choose glass and thickness separately from the physical layout.';
  panels[2].append(modelNote);

  original[0].replaceWith(...panels);
  let activeStep = 1;
  const stepName = document.querySelector('#wizard-step-name');
  const stepCount = document.querySelector('#wizard-step-count');
  const progressFill = document.querySelector('#wizard-progress-fill');
  const stepList = document.querySelector('#wizard-step-list');
  const validationMessage = document.createElement('p');
  validationMessage.className = 'wizard-validation';
  validationMessage.setAttribute('role', 'alert');
  validationMessage.hidden = true;
  quoteForm.prepend(validationMessage);
  quoteForm.addEventListener('change', (event) => {
    const choices = event.target.id === 'service'
      ? panels[0].querySelector('.service-options') : getChoiceList(event.target);
    choices?.classList.remove('choice-list-error');
    validationMessage.hidden = true;
  });
  function showStep(step, animate = true) {
    if (!customQuoteService) standardLabels[2] = serviceSelect.value === 'Mirror' ? 'Mirror Configuration' : serviceSelect.value === 'Glass' ? 'Glass Configuration' : 'Shower Configuration';
    activeStep = Math.max(1, Math.min(labels.length, step));
    const activePanelIndex = panelIndexes[activeStep - 1];
    document.body.dataset.quoteStep = String(activeStep);
    geometry.hidden = Boolean(customQuoteService) || serviceSelect.value !== 'Shower Doors';
    if (activePanelIndex === 2) updateRecommendation();
    const descriptions = customQuoteService
      ? ['Choose the custom service Bruno will review.', 'Add project photos and preliminary tape measurements.', 'Let us know how to reach you about your request.', 'Review your details and describe the project. Bruno prepares your custom estimate after review.']
      : standardDescriptions.map((description, index) => index === 2 && serviceSelect.value !== 'Shower Doors' ? 'Confirm your project layout; select the material and finish in the next step.' : description);
    panels.forEach((panel, index) => {
      const sectionPosition = panelIndexes.indexOf(index) + 1;
      const isVisible = sectionPosition > 0;
      const isCurrent = index === activePanelIndex;
      panel.hidden = !isVisible;
      panel.classList.toggle('is-current', isCurrent);
      panel.classList.toggle('is-entering', animate && isCurrent);
      panel.setAttribute('aria-hidden', String(!isVisible));
      const heading = panel.querySelector('.wizard-panel-heading');
      if (heading) {
        heading.querySelector('span').textContent = '';
        heading.querySelector('h2').textContent = labels[sectionPosition - 1] || '';
      }
    });
    validationMessage.hidden = true;
    modelNote.hidden = customQuoteService ? true : serviceSelect.value === 'Shower Doors';
    mirrorConfiguration.hidden = customQuoteService || serviceSelect.value !== 'Mirror';
    const activePanel = panels[activePanelIndex];
    const activeHeading = activePanel.querySelector('.wizard-panel-heading');
    activeHeading.querySelector('span').textContent = '';
    activeHeading.querySelector('h2').textContent = labels[activeStep - 1];
    activeHeading.querySelector('.wizard-description').textContent = descriptions[activeStep - 1];
    if (animate) activeHeading.focus({ preventScroll: true });
    stepName.textContent = labels[activeStep - 1];
    stepCount.textContent = `STEP ${activeStep} OF ${labels.length}`;
    progressFill.style.width = `${((activeStep - 1) / (labels.length - 1)) * 100}%`;
    stepList.innerHTML = labels.map((label, index) => `<li><button type="button" data-jump-step="${index + 1}" aria-label="Step ${index + 1}: ${label}"><span>${index + 1}</span><small>${label}</small></button></li>`).join('');
    stepList.querySelectorAll('button').forEach((button, index) => {
      button.disabled = index + 1 >= activeStep;
      button.classList.toggle('is-complete', index + 1 < activeStep);
      button.classList.toggle('is-current', index + 1 === activeStep);
      button.setAttribute('aria-current', index + 1 === activeStep ? 'step' : 'false');
    });
    if ((!customQuoteService && activeStep === 5) || (customQuoteService && activeStep === labels.length)) updateEstimatedPrice();
    if (activeStep === labels.length) updateReview();
    if (animate) scrollToQuoteContent(activePanel);
  }

  function stepIsValid(step = activeStep) {
    const activePanel = panels[panelIndexes[step - 1]];
    const fields = [...activePanel.querySelectorAll('[required]')];
    const invalid = fields.find((field) => !field.checkValidity());
    if (invalid) {
      validationMessage.textContent = 'Please complete the required selection or field below to continue.';
      validationMessage.hidden = false;
      const choices = invalid.id === 'service'
        ? panels[0].querySelector('.service-options') : getChoiceList(invalid);
      if (choices) {
        choices.classList.add('choice-list-error');
        choices.querySelector('button')?.focus();
      } else {
        invalid.focus();
        invalid.reportValidity();
      }
      return false;
    }
    if (panelIndexes[step - 1] === 1) {
      const invalidMeasurement = [widthInput, heightInput].find((field) => {
        const value = parseConstructionMeasurement(field.value);
        return !Number.isFinite(value) || value <= 0;
      });
      if (invalidMeasurement) {
        invalidMeasurement.focus();
        validationMessage.textContent = 'Enter whole inches or a supported 1/4, 1/8, or 1/16 fraction.';
        validationMessage.hidden = false;
        return false;
      }
      window.QuoteMeasurement.confirm();
    }
    return true;
  }

  quoteForm.addEventListener('change', event => {
    if (event.target === mirrorLayout) updateProjectReference();
  });

  function startCustomQuote(serviceName) {
    document.querySelector('#request-confirmation').hidden = true;
    quoteForm.hidden = false;
    customQuoteService = String(serviceName || 'Custom Glass Project').trim();
    document.body.dataset.quoteMode = 'custom';
    labels = customLabels;
    panelIndexes = customPanelIndexes;
    serviceSelect.value = 'Glass';
    serviceSelect.dispatchEvent(new Event('change', {bubbles:true}));
    glassTypeSelect.value = "";
    glassTypeSelect.required = false;
    glassTypeGroup.hidden = true;
    document.querySelector('#enduro-shield').checked = false;
    document.querySelector('#enduro-shield-group').hidden = true;
    document.querySelector('.service-options').hidden = true;
    serviceSelect.hidden = true;
    document.querySelector('#custom-quote-selection-name').textContent = customQuoteService;
    document.querySelector('#custom-quote-selection').hidden = false;
    showStep(2, false);
    renderEstimateDisplays(null, 'Custom quote — Bruno will prepare an estimate after reviewing your project.');
    quoteForm.scrollIntoView({behavior:window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',block:'start'});
  }

  document.querySelectorAll('[data-custom-service]').forEach(button => {
    button.addEventListener('click', event => {
      event.preventDefault();
      startCustomQuote(button.dataset.customService);
    });
  });
  document.querySelector('[data-change-quote-service]')?.addEventListener('click', () => {
    customQuoteService = '';
    delete document.body.dataset.quoteMode;
    labels = standardLabels;
    panelIndexes = standardPanelIndexes;
    document.querySelector('#custom-quote-selection').hidden = true;
    document.querySelector('.service-options').hidden = false;
    serviceSelect.hidden = false;
    serviceSelect.value = '';
    serviceSelect.dispatchEvent(new Event('change', {bubbles:true}));
    showStep(1, false);
    updateEstimatedPrice();
  });

  const submitButton = panels[6].querySelector('button[type="submit"]');
  if (submitButton) submitButton.textContent = 'SUBMIT QUOTE REQUEST';
  panels.forEach((panel,index)=>{
    const position=panelIndexes.indexOf(index)+1;
    if(position<1||position>=labels.length)return;
    const actions=document.createElement('div');actions.className='wizard-actions';actions.hidden=true;actions.setAttribute('aria-hidden','true');
    if(position>1){const back=document.createElement('button');back.type='button';back.className='wizard-back';back.textContent='Back';back.hidden=true;back.setAttribute('aria-hidden','true');back.addEventListener('click',()=>showStep(position-1));actions.append(back);}
    const next=document.createElement('button');next.type='button';next.className='wizard-next';next.textContent='Next';next.hidden=true;next.setAttribute('aria-hidden','true');next.addEventListener('click',()=>{if(stepIsValid(position))showStep(position+1);});actions.append(next);panel.append(actions);
  });
  serviceSelect.addEventListener('change', () => {
    updateProjectReference();
    if (serviceSelect.value && !customQuoteService) showStep(2, false);
    updateCustomOptionFields();
  });
  showStep(1, false);
  quoteForm.addEventListener('input', updateReview);
  quoteForm.addEventListener('change', updateReview);
  updateReview();
  document.querySelector('.sales-hero')?.after(document.querySelector('#quote'));
}

// Native modal: reuse the actual field nodes and existing change handlers.
function setupProjectDialog({ showStep, stepIsValid, panels, modelNote, startCustomQuote }) {
  const dialog = document.createElement('dialog');
  dialog.className = 'project-dialog';
  dialog.setAttribute('aria-labelledby', 'project-dialog-title');
  dialog.setAttribute('aria-describedby', 'project-dialog-description');
  dialog.innerHTML = `
    <div class="project-dialog-top"><span class="eyebrow" id="project-dialog-step">STEP 3 / SHOWER CONFIGURATION</span><button type="button" class="dialog-close" aria-label="Close project selection">&times;</button></div>
    <div class="project-dialog-intro"><img class="dialog-project-image" alt="" /><div><h2 id="project-dialog-title"></h2><p id="project-dialog-description"></p></div></div>
    <div class="project-dialog-fields"></div>
    <p class="dialog-feedback" role="alert" hidden></p>
    <div class="dialog-actions"><button type="button" class="wizard-back dialog-back">Back / Close</button><button type="button" class="button button-dark dialog-continue">CONTINUE <span aria-hidden="true">&rarr;</span></button></div>`;
  quoteForm.append(dialog);
  const host = dialog.querySelector('.project-dialog-fields');
  const title = dialog.querySelector('h2');
  const description = dialog.querySelector('#project-dialog-description');
  const photo = dialog.querySelector('.dialog-project-image');
  const feedback = dialog.querySelector('.dialog-feedback');
  const next = dialog.querySelector('.dialog-continue');
  let moved = [], trigger = null, previousOverflow = '', informational = false;
  function restoreFields() {
    moved.forEach(({node, marker}) => marker.replaceWith(node));
    moved = [];
  }
  function moveField(node) {
    const marker = document.createComment('project modal field position');
    node.before(marker);
    moved.push({node, marker});
    host.append(node);
  }
  function close() { dialog.close(); }
  dialog.addEventListener('close', () => {
    restoreFields();
    document.body.style.overflow = previousOverflow;
    trigger?.focus({preventScroll:true});
  });
  dialog.querySelector('.dialog-close').addEventListener('click', close);
  dialog.querySelector('.dialog-back').addEventListener('click', close);
  // Native dialog provides Escape, focus containment, and an inert background.
  function open(button, info = false) {
    if (dialog.open) return;
    informational = info;
    trigger = button;
    host.replaceChildren();
    feedback.hidden = true;
    title.textContent = button.querySelector('.choice-card-title').textContent;
    const source = button.querySelector('img');
    photo.hidden = !source;
    if (source) {photo.src = source.src;photo.alt = source.alt || title.textContent + ' project example';}
    dialog.querySelector('#project-dialog-step').textContent = info ? 'PROJECT ENQUIRY' : 'STEP 3 / SHOWER CONFIGURATION';
    next.hidden = info;
    if (info) {
      description.textContent = 'This category is not configured for online quotations yet. Contact Bruno to discuss your project, or close this panel to choose an available service.';
      const contact = document.createElement('a');
      contact.href = document.querySelector('.header-contact').href;
      contact.className = 'button button-dark';
      contact.textContent = 'CONTACT BRUNO';
      host.append(contact);
    } else if (serviceSelect.value === 'Shower Doors') {
      description.textContent = 'Choose your enclosure. These project images illustrate the configuration; glass is refined in Options.';
      moveField(productGroup);
    } else {
      dialog.querySelector('#project-dialog-step').textContent = 'STEP 2 / MODEL (OPTIONAL)';
      description.textContent = 'No preset physical model is configured for this service. Continue to Options to select the material separately.';
    }
    previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    dialog.showModal();
    dialog.querySelector('.dialog-close').focus();
  }
  document.querySelectorAll('[data-select="service"]').forEach(button => {
    button.addEventListener('click', () => open(button));
  });
  document.querySelectorAll('[data-category-info]').forEach(button => {
    button.addEventListener('click', () => startCustomQuote(button.dataset.customService || button.querySelector('.choice-card-title').textContent));
  });
  next.addEventListener('click', () => {
    if (informational) return;
    const invalid = [...host.querySelectorAll('[required]')].find(field => !field.checkValidity());
    if (invalid) {
      feedback.textContent = 'Please select an option below to continue.';
      feedback.hidden = false;
      (getChoiceList(invalid)?.querySelector('button') || invalid).focus();
      return;
    }
    restoreFields();
    trigger = null;
    dialog.close();
    showStep(2, false);
    if (stepIsValid()) showStep(3);
  });
  host.addEventListener('change', () => {feedback.hidden = true;});
  // Enter inside modal must not advance the background wizard or submit a quote.
  quoteForm.addEventListener('keydown', event => {
    if (dialog.open && event.key === 'Enter' && event.target.tagName === 'INPUT') {
      event.preventDefault(); next.click();
    }
  });
}

setupQuoteWizard();

document.querySelectorAll('[data-quick-service]').forEach(button => button.addEventListener('click', () => {
  document.querySelector('#request-confirmation').hidden = true;
  quoteForm.hidden = false;
  customQuoteService = '';
  delete document.body.dataset.quoteMode;
  document.querySelector('#custom-quote-selection').hidden = true;
  document.querySelector('.service-options').hidden = false;
  serviceSelect.hidden = false;
  serviceSelect.value = button.dataset.quickService;
  serviceSelect.dispatchEvent(new Event('change', {bubbles:true}));
  if (button.dataset.quickProduct) {
    productSelect.value = button.dataset.quickProduct;
    productSelect.dispatchEvent(new Event('change', {bubbles:true}));
  }
  if (button.dataset.mirrorPlacement) document.querySelector('#mirror-layout').value = button.dataset.mirrorPlacement;
  quoteForm.scrollIntoView({behavior:window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',block:'start'});
}));

document.querySelectorAll('.hardware-count-grid input').forEach((field) => {
  field.addEventListener('input', updateEstimatedPrice);
});
glassTypeSelect?.addEventListener('change', () => { updateCustomOptionFields(); updateEstimatedPrice(); });
hardwareFinishSelect?.addEventListener('change', updateCustomOptionFields);
glassOtherDescription?.addEventListener('input', updateEstimatedPrice);
window.addEventListener('focus', updateEstimatedPrice);

document.querySelector('#enduro-shield').addEventListener('change', updateEstimatedPrice);
