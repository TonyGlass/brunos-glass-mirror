const SUPABASE_URL = 'https://ygcpfehitvhipsncqxdm.supabase.co';

const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_uHHniNJW39sY0x3afdkx1g_53ZJrTHl';

const supabaseClient = window.supabase.createClient(
  SUPABASE_URL,
  SUPABASE_PUBLISHABLE_KEY
);
const menuToggle = document.querySelector('.menu-toggle');
const siteNav = document.querySelector('#site-nav');
const quoteForm = document.querySelector('#quote-form');
const photosInput = document.querySelector('#photos');
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
function calculateEstimatedPrice({
  service,
  glassType,
  hardwareFinish,
  squareFeet,
  quantity
}) {
  const sqft = Number(squareFeet) || 0;
const qty = Number(quantity) || 1;
const serviceName = String(service || '').trim().toLowerCase();
const glassName = String(glassType || '').trim().toLowerCase();
const hardwareName = String(hardwareFinish || '').trim().toLowerCase();

let low = 0;
let high = 0;

  // FRAMLESS SHOWER DOORS
  if (serviceName.includes('frameless')) {
    low = 1200 + (sqft * 55);
    high = 1200 + (sqft * 75);

    // 1/2" glass premium
    if (glassName.includes('1/2')) {
      low *= 1.15;
      high *= 1.15;
    }

    // Premium hardware
    if (
  hardwareFinish &&
  (
    hardwareName.includes('brass') ||
    hardwareName.includes('gold') ||
    hardwareName.includes('matte black')
  )
)
    {
      low += 150;
      high += 400;
    }
  }

  // MIRROR
  else if (serviceName.includes('mirror')) {
    low = 175 + (sqft * 18);
    high = 175 + (sqft * 30);
  }

  // GLASS
 else if (serviceName.includes('glass')) {
    low = 300 + (sqft * 55);
    high = 300 + (sqft * 90);
  }

  // Quantity
  low *= qty;
  high *= qty;

  if (low <= 0 || high <= 0) {
    return null;
  }

  return {
    low: Math.round(low),
    high: Math.round(high)
  };
}
const formStatus = document.querySelector('#form-status');
const currentYear = document.querySelector('#current-year');

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


// =====================================================
// PRODUCTS
// =====================================================

const products = [
  {
    name: "Regular Clear Glass Enclosure",
    service: "Frameless Shower Doors",
    glass: "Clear Tempered Glass",
    doorType: "Shower Enclosure",
    images: [
      "https://localglassandscreen.com/img/s1-2.jpg",
      "https://crystalshowersolutions.com/assets/gallery-4-Da9Syedp.jpg",
      "https://static.wixstatic.com/media/90a441_6f4335ed60444dae9f2109e04f85a46c~mv2.jpg/v1/fill/w_980%2Ch_1306%2Cal_c%2Cq_85%2Cusm_0.66_1.00_0.01%2Cenc_auto/90a441_6f4335ed60444dae9f2109e04f85a46c~mv2.jpg"
    ]
  },

  {
    name: "Low-Iron Glass Enclosure",
    service: "Frameless Shower Doors",
    glass: "Low-Iron Glass",
    doorType: "Shower Enclosure",
    images: [
      "https://static.wixstatic.com/media/90a441_6f4335ed60444dae9f2109e04f85a46c~mv2.jpg/v1/fill/w_980%2Ch_1306%2Cal_c%2Cq_85%2Cusm_0.66_1.00_0.01%2Cenc_auto/90a441_6f4335ed60444dae9f2109e04f85a46c~mv2.jpg",
      "https://localglassandscreen.com/img/s1-2.jpg",
      "https://crystalshowersolutions.com/assets/gallery-4-Da9Syedp.jpg"
    ]
  },

  {
    name: "Regular Clear Glass – Sliding System",
    service: "Frameless Shower Doors",
    glass: "Clear Tempered Glass",
    doorType: "Sliding Shower Door",
    images: [
      "https://crystalshowersolutions.com/assets/gallery-4-Da9Syedp.jpg",
      "https://localglassandscreen.com/img/s1-2.jpg",
      "https://static.wixstatic.com/media/90a441_6f4335ed60444dae9f2109e04f85a46c~mv2.jpg/v1/fill/w_980%2Ch_1306%2Cal_c%2Cq_85%2Cusm_0.66_1.00_0.01%2Cenc_auto/90a441_6f4335ed60444dae9f2109e04f85a46c~mv2.jpg"
    ]
  },

  {
    name: "Low-Iron Glass – Sliding System",
    service: "Frameless Shower Doors",
    glass: "Low-Iron Glass",
    doorType: "Sliding Shower Door",
    images: [
      "https://localglassandscreen.com/img/s1-2.jpg",
      "https://static.wixstatic.com/media/90a441_6f4335ed60444dae9f2109e04f85a46c~mv2.jpg/v1/fill/w_980%2Ch_1306%2Cal_c%2Cq_85%2Cusm_0.66_1.00_0.01%2Cenc_auto/90a441_6f4335ed60444dae9f2109e04f85a46c~mv2.jpg",
      "https://crystalshowersolutions.com/assets/gallery-4-Da9Syedp.jpg"
    ]
  }
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

const glassTypes = {
  "Frameless Shower Doors": [
    "Clear Glass",
    "Low-Iron Glass"
  ],

  "Mirror": [
    "Standard / Clear Mirror",
    "Antique Mirror",
    "Tinted Mirror"
  ],

  "Glass": [
    "Clear Glass",
    "Clear Tempered Glass",
    "Low-Iron Glass",
    "Laminated Glass",
    "Frosted Glass",
    "Tinted Glass",
    "Obscure / Textured Glass"
  ]
};


// =====================================================
// DOOR TYPES
// =====================================================

const doorTypes = {
  "Frameless Shower Doors": [
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

    types.forEach((type) => {

      const option = document.createElement('option');

      option.value = type;
      option.textContent = type;

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


    if (doors.length > 0) {

      doorTypeGroup.hidden = false;
      doorTypeSelect.required = true;

    } else {

      doorTypeGroup.hidden = true;
      doorTypeSelect.required = false;

    }


    // -------------------------------------------------
    // HARDWARE
    // Only for Frameless Shower Doors
    // -------------------------------------------------

    if (selectedService === "Frameless Shower Doors") {

      hardwareGroup.hidden = false;

      hardwareFinishSelect.required = true;
      handleStyleSelect.required = true;

    } else {

      hardwareGroup.hidden = true;

      hardwareFinishSelect.required = false;
      handleStyleSelect.required = false;

      hardwareFinishSelect.value = "";
      handleStyleSelect.value = "";

    }

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

  // Automatically select the correct glass
  glassTypeSelect.value = product.glass;

  // Automatically select the correct door type
  doorTypeSelect.value = product.doorType;

  // Update product gallery
  updateProductGallery(product);

});

}


// =====================================================
// SQUARE FEET CALCULATOR
// =====================================================

const widthInput = document.querySelector('#width');
const heightInput = document.querySelector('#height');
const squareFeetResult = document.querySelector('#square-feet-result');


function calculateSquareFeet() {

  const width = parseFloat(widthInput.value);
  const height = parseFloat(heightInput.value);


  if (width > 0 && height > 0) {

    const squareFeet = (width * height) / 144;

    squareFeetResult.innerHTML =
      `Square Feet: <strong>${squareFeet.toFixed(2)}</strong>`;

  } else {

    squareFeetResult.innerHTML =
      'Square Feet: <strong>0.00</strong>';

  }

}


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

    const width = parseFloat(document.querySelector('#width').value) || null;
    const height = parseFloat(document.querySelector('#height').value) || null;

    const squareFeet =
      width && height ? Number(((width * height) / 144).toFixed(2)) : null;
const estimatedPrice = calculateEstimatedPrice({
  service: serviceSelect.options[serviceSelect.selectedIndex].text.trim(),
  glassType: glassTypeSelect.value,
  hardwareFinish: hardwareFinishSelect.value,
  squareFeet:
  parseFloat(widthInput.value) > 0 &&
  parseFloat(heightInput.value) > 0
    ? (parseFloat(widthInput.value) * parseFloat(heightInput.value)) / 144
    : 0,
  quantity:
    parseInt(document.querySelector('#quantity').value, 10) || 1
});
console.log('ESTIMATED PRICE:', estimatedPrice);
    const quoteData = {
  name: document.querySelector('#name').value.trim(),
  phone: document.querySelector('#phone').value.trim(),
  email: document.querySelector('#email').value.trim(),
  city: document.querySelector('#city').value,

  service: serviceSelect.value,
  product: productSelect.value || null,
  door_type: doorTypeSelect.value || null,
  glass_type: glassTypeSelect.value || null,
  hardware_finish: hardwareFinishSelect.value || null,
  handle_style: handleStyleSelect.value || null,

  quantity:
    parseInt(document.querySelector('#quantity').value, 10) || 1,

  width: width,
  height: height,
  square_feet:
  parseFloat(widthInput.value) > 0 &&
  parseFloat(heightInput.value) > 0
    ? (parseFloat(widthInput.value) * parseFloat(heightInput.value)) / 144
    : null,

  message: document.querySelector('#project').value.trim(),

  estimated_price: estimatedPrice
  ? Math.round((estimatedPrice.low + estimatedPrice.high) / 2)
  : null,

estimated_price_low: estimatedPrice
  ? estimatedPrice.low
  : null,

estimated_price_high: estimatedPrice
  ? estimatedPrice.high
  : null,

final_price: null,

  status: 'New'
};

    formStatus.textContent = 'Sending your quote request...';

    if (submitButton) {
      submitButton.disabled = true;
    }

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
          files: selectedFiles.map((file) => ({
            name: file.name,
            size: file.size,
            type: file.type
          }))
        })
      });

      const createResult = await createResponse.json();

      if (!createResponse.ok) {
        throw new Error(createResult.error || 'Could not create the quote.');
      }

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

      quoteForm.reset();

      serviceSelect.value = '';
      serviceSelect.dispatchEvent(new Event('change'));

      calculateSquareFeet();

    } catch (error) {
  console.error('Quote submission error:', error);

  formStatus.textContent =
    `Sorry, we could not send your request. ${error.message || 'Please try again.'}`;
} finally {
      if (submitButton) {
        submitButton.disabled = false;
      }
    }
  });
}