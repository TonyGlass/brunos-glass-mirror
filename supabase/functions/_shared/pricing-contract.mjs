import { calculateEstimatedPrice } from './pricing-engine.mjs';

export const hardwareKeys = ['hinges', 'handles', 'clips', 'sweeps', 'channels', 'accessories'];
export function normalizePricingConfig(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('Invalid pricing configuration');
  const selling = {};
  if (value.pricingModel != null && value.pricingModel !== 'selling-rates-v1') throw Error('Invalid pricing model');
  if (value.pricingModel === 'selling-rates-v1') {
    const rates = value.finalSellingRates;
    if (!rates || typeof rates !== 'object' || Array.isArray(rates) || Object.keys(rates).length > 500) throw Error('Invalid final selling rates');
    const amount = (n, name) => {
      if (n != null && (!Number.isFinite(n) || n < 0 || n > 1e9)) throw Error(`Invalid ${name}`);
      return n ?? null;
    };
    selling.pricingModel = value.pricingModel;
    selling.finalSellingRates = Object.fromEntries(Object.entries(rates).map(([key,n]) => {
      if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(key) || key.length > 100) throw Error('Invalid material key');
      return [key,amount(n,`finalSellingRates.${key}`)];
    }));
    selling.enduroShieldRate = amount(value.enduroShieldRate,'enduroShieldRate');
  }
  const range = (item, path) => {
    const out = {};
    for (const bound of ['low', 'high']) {
      const n = item?.[bound];
      if (n != null && (!Number.isFinite(n) || n < 0 || n > 1e9)) throw Error(`Invalid ${path}.${bound}`);
      out[bound] = n ?? null;
    }
    if (out.low != null && out.high != null && out.high < out.low) throw Error(`Invalid ${path}.high`);
    return out;
  };
  const table = (items, path) => {
    if (items != null && (typeof items !== 'object' || Array.isArray(items))) throw Error(`Invalid ${path}`);
    const entries = Object.entries(items || {});
    if (entries.length > 500) throw Error('Too many material rates');
    return Object.fromEntries(entries.map(([key, cost]) => {
      if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(key) || key.length > 100) throw Error('Invalid material key');
      return [key, range(cost, `${path}.${key}`)];
    }));
  };
  // Final selling rates do not depend on legacy cost or margin fields.
  if (value.pricingModel === 'selling-rates-v1') return {
    ...selling, profitMargin:null, glassCosts:{}, mirrorCosts:{}, glassLowIron38:{low:null,high:null},
    glassLowIron38SplitPerLite:{value:null}, hardware:Object.fromEntries(hardwareKeys.map(key=>[key,{low:null,high:null}])),
    fabrication:{low:null,high:null}, installationLabor:{low:null,high:null}, consumables:{low:null,high:null}, other:{low:null,high:null}
  };
  if (!Number.isFinite(value.profitMargin) || value.profitMargin < 0 || value.profitMargin >= 1) throw Error('Invalid profitMargin');
  const glassCosts = table(value.glassCosts, 'glassCosts');
  if (!Object.hasOwn(glassCosts, 'low-iron-glass-3-8') && value.glassLowIron38) {
    glassCosts['low-iron-glass-3-8'] = range(value.glassLowIron38, 'glassLowIron38');
  }
  const split = value.glassLowIron38SplitPerLite?.value ?? null;
  if (split !== null && (!Number.isFinite(split) || split < 0 || split > 1e9)) throw Error('Invalid single-split rate');
  return {
    ...selling,
    profitMargin: value.profitMargin, glassCosts, mirrorCosts: table(value.mirrorCosts, 'mirrorCosts'),
    glassLowIron38: glassCosts['low-iron-glass-3-8'] || {low:null, high:null},
    glassLowIron38SplitPerLite: {value:split},
    hardware: Object.fromEntries(hardwareKeys.map(key => [key, range(value.hardware?.[key], `hardware.${key}`)])),
    ...Object.fromEntries(['fabrication','installationLabor','consumables','other'].map(key => [key, range(value[key], key)]))
  };
}

export function normalizeProject(value) {
  if (!value || !['Shower Doors','Mirror','Glass'].includes(value.service)) throw Error('Select an available service');
  if (typeof value.glassType !== 'string' || !value.glassType || value.glassType.length > 100) throw Error('Select a material');
  const materialKey = value.glassType.toLowerCase().replaceAll('"','').replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'');
  const glassMaterials = new Set(['clear-glass-3-8','low-iron-glass-3-8','reeded-moru-3-8','satin-acid-etched-3-8','satin-acid-etched-low-iron-3-8']);
  const mirrorMaterials = new Set(['clear-mirror-1-4','low-iron-mirror-1-4','bronze-mirror-1-4','gray-mirror-1-4']);
  if (value.service === 'Mirror' ? !mirrorMaterials.has(materialKey) : !glassMaterials.has(materialKey)) throw Error('This material is not in the approved automatic-pricing catalog');
  const {width, height, quantity} = value;
  if (![width,height].every(n => Number.isFinite(n) && n > 0 && n <= 10000) || !Number.isSafeInteger(quantity) || quantity < 1 || quantity > 10000) throw Error('Invalid dimensions or quantity');
  const counts = Object.fromEntries(['splitLites',...hardwareKeys].map(key => {
    const n = value.counts?.[key] ?? 0;
    if (!Number.isSafeInteger(n) || n < 0 || n > 10000) throw Error('Invalid hardware quantity');
    return [key,n];
  }));
  if (value.enduroShield != null && typeof value.enduroShield !== 'boolean') throw Error('Invalid EnduroShield selection');
  if (value.enduroShield && value.service === 'Mirror') throw Error('EnduroShield is not configured for mirrors');
  if (value.enduroShield && !['Glass','Shower Doors'].includes(value.service)) throw Error('EnduroShield is only available for approved glass projects');
  if (value.mirrorFrame != null && typeof value.mirrorFrame !== 'boolean') throw Error('Invalid Metal / Frame selection');
  if (value.mirrorFrame && value.service !== 'Mirror') throw Error('Metal / Frame is only available for mirrors');
  return {service:value.service, glassType:value.glassType, width, height, enduroShield:value.enduroShield ?? false,
    mirrorFrame:value.mirrorFrame ?? false, squareFeet:width*height/144, quantity, counts};
}

// Only this public projection may be returned to anonymous callers.
export function publicEstimate(project, record) {
  if (!record) return {complete:false, reason:'pricing_not_configured', revision:0};
  const result = calculateEstimatedPrice(normalizeProject(project), normalizePricingConfig(record.config));
  if (!result?.complete || !Number.isFinite(result.low) || !Number.isFinite(result.high)) {
    return {complete:false, reason:'pricing_unavailable', revision:record.revision};
  }
  const estimateHigh = Math.round((result.low * 1.1 + Number.EPSILON) * 100) / 100;
  return {complete:true, baseLow:result.low, baseHigh:result.low,
    low:result.low, high:estimateHigh, estimateFactor:1.1, revision:record.revision,
    ...(result.breakdown ? {breakdown:result.breakdown} : {})};
}

export function quoteEstimateFields(result) {
  return {estimated_price:result.complete ? result.low : null,
    estimated_price_low:result.complete ? result.low : null,
    estimated_price_high:result.complete ? result.high : null, final_price:null};
}
